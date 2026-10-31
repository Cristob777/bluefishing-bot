const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.CHATWOOT_ENABLED = "true";
process.env.CHATWOOT_BASE_URL = "https://chat.example.test/";
process.env.CHATWOOT_BOT_TOKEN = "bot-token-not-real";
process.env.CHATWOOT_WEBHOOK_SECRET = "whsec-not-real";
process.env.OPENAI_API_KEY = "test-not-real";

const cw = require("../api/chatwoot");
const contactStore = require("../lib/contactStore");
const contactCalls = [];
contactStore._setQuery(async (sql, params) => { contactCalls.push(params); return { rows: [{ id: 1 }] }; });

function payload(over = {}) {
  const conv = { id: 42, status: "pending", channel: "Channel::WebWidget", labels: ["vip"], meta: { assignee: null }, ...(over.conversation || {}) };
  return { event: "message_created", id: over.id ?? Math.floor(Math.random() * 1e9), message_type: "incoming", private: false,
    content: "Busco caña para corvina", account: { id: 7 }, sender: { id: 99, name: "Ana Ejemplo", phone_number: "+56900000000" },
    ...over, conversation: conv };
}

function signedReq(body, { secret = "whsec-not-real", ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  return { method: "POST", headers: { "x-chatwoot-signature": sig, "x-chatwoot-timestamp": String(ts) }, rawBody: raw, body };
}

function mockRes() {
  const r = { statusCode: 200, body: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; };
  return r;
}

function mockFetch() {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null }); return { ok: true, status: 200, json: async () => ({}) }; };
  fn.calls = calls;
  return fn;
}

function run(body, engineResult = { reply: "Te recomiendo una caña surf 4,2 m.", debug: { next_action: "recommend" } }) {
  const fetch = mockFetch();
  const engineCalls = [];
  return new Promise((resolve) => {
    const handler = cw.makeHandler({
      fetch,
      claimInboundMessage: async () => true,
      handleMessage: async (args) => { engineCalls.push(args); return engineResult; },
      onProcessed: (result) => resolve({ result, fetch, engineCalls, res }),
    });
    const res = mockRes();
    handler(signedReq(body), res).then(() => { if (res.body?.status === "ignored") resolve({ result: "ignored", fetch, engineCalls, res }); });
  });
}

test("pending incoming message: engine reply posted via Chatwoot API, session cw:<id>", async () => {
  const { result, fetch, engineCalls, res } = await run(payload());
  assert.equal(res.statusCode, 200);
  assert.equal(result, "replied");
  assert.equal(engineCalls[0].sessionId, "cw:42");
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, "https://chat.example.test/api/v1/accounts/7/conversations/42/messages");
  assert.equal(fetch.calls[0].headers.api_access_token, "bot-token-not-real");
  assert.deepEqual(fetch.calls[0].body, { content: "Te recomiendo una caña surf 4,2 m.", message_type: "outgoing", private: false });
  await new Promise((r) => setImmediate(r));
  const c = contactCalls.at(-1);
  assert.deepEqual([c[0], c[1], c[2], c[5]], ["chatwoot", "7-99", "cw:42", "web"]);
});

test("engine handoff: reply, labels keep existing + humano, status open", async () => {
  const { result, fetch } = await run(payload(), { reply: "Te derivo con el equipo.", debug: { next_action: "handoff_human", intent: "postventa" } });
  assert.equal(result, "handoff");
  const paths = fetch.calls.map((c) => c.url.replace("https://chat.example.test/api/v1/accounts/7/conversations/42", ""));
  assert.deepEqual(paths, ["/messages", "/labels", "/toggle_status"]);
  assert.deepEqual(fetch.calls[1].body, { labels: ["vip", "humano"] });
  assert.deepEqual(fetch.calls[2].body, { status: "open" });
});

test("explicit human request hands off without calling the engine", async () => {
  const { result, engineCalls, fetch } = await run(payload({ content: "quiero hablar con un vendedor" }));
  assert.equal(result, "handoff");
  assert.equal(engineCalls.length, 0);
  assert.equal(fetch.calls.at(-1).body.status, "open");
});

test("ignores open, assigned, outgoing, private and non message events", async () => {
  const cases = [
    payload({ conversation: { status: "open" } }),
    payload({ conversation: { meta: { assignee: { id: 3 } } } }),
    payload({ message_type: "outgoing" }),
    payload({ private: true }),
    { ...payload(), event: "conversation_updated" },
  ];
  for (const body of cases) {
    const { result, engineCalls, fetch, res } = await run(body);
    assert.equal(result, "ignored");
    assert.equal(res.statusCode, 200);
    assert.equal(engineCalls.length + fetch.calls.length, 0);
  }
});

test("rejects bad signature, stale timestamp and disabled flag", async () => {
  const h = cw.makeHandler({});
  for (const req of [signedReq(payload(), { secret: "wrong" }), signedReq(payload(), { ts: Math.floor(Date.now() / 1000) - 3600 }),
    { method: "POST", headers: {}, rawBody: Buffer.from("{}"), body: {} }]) {
    const res = mockRes(); await h(req, res);
    assert.equal(res.statusCode, 401);
  }
  process.env.CHATWOOT_ENABLED = "false";
  try { const res = mockRes(); await h(signedReq(payload()), res); assert.equal(res.statusCode, 404); }
  finally { process.env.CHATWOOT_ENABLED = "true"; }
});

test("engine failure opens conversation for humans and never throws", async () => {
  const fetch = mockFetch();
  const ev = cw.classifyEvent(payload());
  const orig = console.error; console.error = () => {};
  try {
    const result = await cw.processEvent(ev, cw.createClient({ baseUrl: "https://chat.example.test", botToken: "t", timeoutMs: 1000 }, fetch),
      { claimInboundMessage: async () => true, handleMessage: async () => { throw new Error("openai down"); } });
    assert.equal(result, "error");
  } finally { console.error = orig; }
  assert.deepEqual(fetch.calls.at(-1).body, { status: "open" });
});

test("duplicate deliveries are processed once", async () => {
  const fetch = mockFetch();
  const ev = cw.classifyEvent(payload());
  const result = await cw.processEvent(ev, cw.createClient({ baseUrl: "https://x", botToken: "t", timeoutMs: 1000 }, fetch),
    { claimInboundMessage: async () => false, handleMessage: async () => ({ reply: "x" }) });
  assert.equal(result, "duplicate");
  assert.equal(fetch.calls.length, 0);
});

test("assignee AgentBot (v4.19) no bloquea; assignee User sí", () => {
  const bot = cw.classifyEvent(payload({ conversation: { meta: { assignee: { id: 1, name: "Matías" }, assignee_type: "AgentBot" } } }));
  assert.equal(bot.skip, undefined);
  const human = cw.classifyEvent(payload({ conversation: { meta: { assignee: { id: 5 }, assignee_type: "User" } } }));
  assert.equal(human.skip, "assigned");
});

test("sin firma HMAC se rechaza aunque venga ?token= (sin fallback)", () => {
  const base = { method: "POST", headers: {}, rawBody: Buffer.from("{}"), body: {} };
  assert.equal(cw.verifySignature({ ...base, query: { token: "whsec-not-real" } }, "whsec-not-real"), false);
  assert.equal(cw.verifySignature(signedReq({ a: 1 }), "whsec-not-real"), true);
  assert.equal(cw.verifyRequest, undefined);
});

test("labels usan CHATWOOT_LABELS_TOKEN si existe; mensajes siguen con el token del bot", async () => {
  const fetch = mockFetch();
  const client = cw.createClient({ baseUrl: "https://x", botToken: "bot-t", labelsToken: "agent-t", timeoutMs: 1000 }, fetch);
  await client.setLabels(1, 2, ["humano"]);
  await client.sendMessage(1, 2, "hola");
  assert.equal(fetch.calls[0].headers.api_access_token, "agent-t");
  assert.equal(fetch.calls[1].headers.api_access_token, "bot-t");
});
