const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Stub del motor de ventas para no llamar a OpenAI.
const enginePath = path.join(__dirname, "../lib/salesEngine.js");
const calls = [];
require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    sanitizeInput: (t) => (typeof t === "string" ? t.trim().slice(0, 1000) : ""),
    handleMessage: async (args) => { calls.push(args); return { reply: "¡Hola! ¿Qué pescas?" }; },
  },
};
const contactCalls = [];
const contactStore = require("../lib/contactStore");
contactStore._setQuery(async (sql, params) => { contactCalls.push(params); return { rows: [{ id: 1 }] }; });

process.env.ALLOWED_ORIGIN = "https://bluefishing.cl, https://www.bluefishing.cl";
process.env.OPENAI_API_KEY = "test-not-real";
process.env.RATE_LIMIT_MAX_MESSAGES = process.env.RATE_LIMIT_MAX_MESSAGES || "30";
const chat = require("../api/chat");
const widget = require("../api/widget");

function mockRes() {
  const r = { statusCode: 200, headers: {}, body: undefined, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.ended = true; };
  r.send = (b) => { r.body = b; r.ended = true; };
  r.end = () => { r.ended = true; };
  return r;
}
const req = (o = {}) => ({ method: "POST", headers: { origin: "https://bluefishing.cl", ...(o.headers || {}) }, body: o.body, socket: { remoteAddress: o.ip || "10.0.0.1" }, ...(o.method ? { method: o.method } : {}) });
const SID = "3f2b9c1e-aaaa-4bbb-8ccc-123456789abc";

test("allowed origin gets reply via shared engine with web: session", async () => {
  const res = mockRes();
  await chat(req({ body: { sessionId: SID, message: "hola" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, "¡Hola! ¿Qué pescas?");
  assert.equal(res.headers["access-control-allow-origin"], "https://bluefishing.cl");
  assert.deepEqual(calls.at(-1), { sessionId: `web:${SID}`, text: "hola" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(contactCalls.at(-1).slice(0, 3), ["web", SID, `web:${SID}`]);
});

test("disallowed or missing origin is rejected without CORS header", async () => {
  for (const origin of ["https://evil.example", undefined]) {
    const res = mockRes();
    await chat(req({ headers: { origin }, body: { sessionId: SID, message: "hola" } }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  }
});

test("preflight: 204 for allowed, 403 otherwise", async () => {
  const ok = mockRes(); await chat(req({ method: "OPTIONS" }), ok);
  assert.equal(ok.statusCode, 204);
  const bad = mockRes(); await chat(req({ method: "OPTIONS", headers: { origin: "https://x.y" } }), bad);
  assert.equal(bad.statusCode, 403);
});

test("validates session id, message and method", async () => {
  for (const sessionId of ["", "short", "a".repeat(101), "../../etc", "web:inject"]) {
    const res = mockRes(); await chat(req({ body: { sessionId, message: "hola" } }), res);
    assert.equal(res.statusCode, 400, sessionId);
  }
  const empty = mockRes(); await chat(req({ body: { sessionId: SID, message: "   " } }), empty);
  assert.equal(empty.statusCode, 400);
  const get = mockRes(); await chat(req({ method: "GET" }), get);
  assert.equal(get.statusCode, 405);
});

test("rate limits per IP across rotating session ids", async () => {
  const max = Number(process.env.RATE_LIMIT_MAX_MESSAGES);
  let last;
  const orig = console.warn; console.warn = () => {};
  try {
    for (let i = 0; i <= max; i++) {
      last = mockRes();
      await chat(req({ ip: "203.0.113.9", body: { sessionId: `rotating-session-${i}`, message: "hola" } }), last);
    }
  } finally { console.warn = orig; }
  assert.equal(last.statusCode, 429);
});

test("clientIp uses proxy-appended (last) X-Forwarded-For entry", () => {
  assert.equal(chat.clientIp({ headers: { "x-forwarded-for": "1.1.1.1, 198.51.100.7" }, socket: {} }), "198.51.100.7");
  assert.equal(chat.clientIp({ headers: {}, socket: { remoteAddress: "10.1.1.1" } }), "10.1.1.1");
});

test("widget.js served as nosniff javascript, GET only", async () => {
  const res = mockRes(); await widget({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /javascript/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.match(res.body, /\/chat/);
  const post = mockRes(); await widget({ method: "POST", headers: {} }, post);
  assert.equal(post.statusCode, 405);
});
