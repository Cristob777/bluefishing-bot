const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.CREDENTIALS_MASTER_KEY = crypto.randomBytes(32).toString("hex");
process.env.PANEL_SESSION_SECRET = "p".repeat(40);
process.env.PUBLIC_BASE_URL = "https://bot.example.cl";
process.env.META_APP_ID = "123456789";
process.env.META_APP_SECRET = "a".repeat(32);
process.env.OPENAI_API_KEY = "sk-test-not-real-000000000000";
process.env.PHONE_NUMBER_ID = "999999999";
process.env.WHATSAPP_TOKEN = "legacy-token-000000000000";
process.env.VERIFY_TOKEN = "legacy-verify";

const box = require("../lib/secretBox");
const woo = require("../lib/wooAuth");
const meta = require("../lib/metaGraph");
const { hashPassword, verifyPassword } = require("../lib/tenantStore");
const { createPanel, _test: P } = require("../api/panel");
const webhook = require("../api/webhook");

// ---------- helpers ----------
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [re, reply] of routes) {
      if (re.test(String(url))) {
        const r = typeof reply === "function" ? reply(String(url), opts) : reply;
        return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body || {} };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: { code: 404 } }) };
  };
  fn.calls = calls;
  return fn;
}

function memStore() {
  const s = { states: new Map(), woo: {}, wa: {}, verify: new Set(), users: new Map() };
  s.api = {
    async getUser(id) { return s.users.get(id) || null; },
    async bumpSession(id) { s.users.get(id).session_version++; },
    async status() { return {}; },
    async createState({ tenantId, kind, storeUrl }) { const st = crypto.randomBytes(8).toString("hex"); s.states.set(st, { tenant_id: tenantId, kind, store_url: storeUrl, used: false }); return st; },
    async consumeState(state, kind) { const x = s.states.get(state); if (!x || x.used || x.kind !== kind) return null; x.used = true; return x; },
    async saveWoo(t, v) { s.woo[t] = v; },
    async saveWhatsApp(t, v) { s.wa[t] = v; },
    async ensureVerifyTokenHash(t, h) { s.verify.add(h); },
    async hasVerifyTokenHash(h) { return s.verify.has(h); },
    async findWhatsAppByPhoneNumberId(id) { for (const [t, v] of Object.entries(s.wa)) if (v.phoneNumberId === id) return { tenantId: t, phoneNumberId: id, accessToken: v.accessToken, appSecret: v.appSecret }; return null; },
  };
  return s;
}

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b ?? ""; this.ended = true; } };
  return r;
}

function req({ method = "GET", path = "/panel", body, json, cookie, headers = {}, query = {} }) {
  return { method, path, query, headers: { ...(cookie ? { cookie } : {}), ...headers }, rawBody: body ? Buffer.from(new URLSearchParams(body).toString()) : json ? Buffer.from(JSON.stringify(json)) : Buffer.alloc(0), body: json || {}, socket: { remoteAddress: "1.2.3.4" } };
}

function loggedIn(s, tenantId = "t1") {
  const user = { id: "u1", tenant_id: tenantId, email: "dueno@empresa.cl", session_version: 1, tenant_name: "Empresa" };
  s.users.set("u1", user);
  const token = P.sign(user);
  return { cookie: `${P.COOKIE}=${token}`, csrf: P.csrfFor(token) };
}

// ---------- crypto ----------
test("AES-256-GCM roundtrip and AAD binding", () => {
  const enc = box.encrypt("cs_secret", "t1:woo_secret");
  assert.match(enc, /^v1\./);
  assert.ok(!enc.includes("cs_secret"));
  assert.equal(box.decrypt(enc, "t1:woo_secret"), "cs_secret");
  assert.throws(() => box.decrypt(enc, "t2:woo_secret"));
  const parts = enc.split("."); parts[3] = Buffer.from("x").toString("base64url");
  assert.throws(() => box.decrypt(parts.join("."), "t1:woo_secret"));
});

test("passwords are scrypt-hashed and verified", () => {
  const h = hashPassword("una-clave-larga-123");
  assert.ok(verifyPassword("una-clave-larga-123", h));
  assert.ok(!verifyPassword("otra", h));
});

test("panel session rejects tampered tokens", () => {
  const t = P.sign({ id: "u1", session_version: 1 });
  assert.equal(P.readToken(t).uid, "u1");
  assert.equal(P.readToken(t.slice(0, -2) + "xx"), null);
});

// ---------- WooCommerce ----------
test("store URL normalization only allows public https", () => {
  assert.equal(woo.normalizeStoreUrl("https://tienda.cl/"), "https://tienda.cl");
  assert.equal(woo.normalizeStoreUrl("http://tienda.cl"), null);
  assert.equal(woo.normalizeStoreUrl("https://localhost"), null);
  assert.equal(woo.normalizeStoreUrl("https://10.0.0.1"), null);
});

test("Conectar tienda redirects to wc-auth with read scope and a state", async () => {
  const s = memStore(); const { cookie, csrf } = loggedIn(s);
  const res = fakeRes();
  await createPanel({ store: s.api })(req({ method: "POST", path: "/panel/woo/connect", cookie, body: { csrf, store_url: "https://tienda.cl" } }), res);
  assert.equal(res.statusCode, 303);
  const u = new URL(res.headers.location);
  assert.equal(u.origin + u.pathname, "https://tienda.cl/wc-auth/v1/authorize");
  assert.equal(u.searchParams.get("scope"), "read");
  assert.equal(u.searchParams.get("callback_url"), "https://bot.example.cl/panel/woo/callback");
  assert.ok(s.states.has(u.searchParams.get("user_id")));
});

test("Conectar tienda requires CSRF token", async () => {
  const s = memStore(); const { cookie } = loggedIn(s);
  const res = fakeRes();
  await createPanel({ store: s.api })(req({ method: "POST", path: "/panel/woo/connect", cookie, body: { csrf: "bad", store_url: "https://tienda.cl" } }), res);
  assert.equal(res.headers.location, "/panel?n=csrf");
  assert.equal(s.states.size, 0);
});

test("Woo callback stores keys for the state's tenant, once", async () => {
  const s = memStore();
  const state = await s.api.createState({ tenantId: "t1", kind: "woo", storeUrl: "https://tienda.cl" });
  const f = mockFetch([[/tienda\.cl\/wp-json\/wc\/v3\/products/, { body: [{ id: 1 }] }]]);
  const panel = createPanel({ store: s.api, fetchImpl: f });
  const payload = { key_id: 7, user_id: state, consumer_key: "ck_" + "a".repeat(40), consumer_secret: "cs_" + "b".repeat(40), key_permissions: "read" };
  let res = fakeRes();
  await panel(req({ method: "POST", path: "/panel/woo/callback", json: payload }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(s.woo.t1.consumerSecret, payload.consumer_secret);
  assert.match(f.calls[0].opts.headers.Authorization, /^Basic /);
  res = fakeRes();
  await panel(req({ method: "POST", path: "/panel/woo/callback", json: payload }), res);
  assert.equal(res.statusCode, 400, "state reuse must fail");
});

test("Woo callback rejects unknown state and write scope", async () => {
  const s = memStore();
  const panel = createPanel({ store: s.api, fetchImpl: mockFetch([]) });
  let res = fakeRes();
  await panel(req({ method: "POST", path: "/panel/woo/callback", json: { user_id: "nope", consumer_key: "ck_" + "a".repeat(40), consumer_secret: "cs_" + "b".repeat(40) } }), res);
  assert.equal(res.statusCode, 400);
  const state = await s.api.createState({ tenantId: "t1", kind: "woo", storeUrl: "https://tienda.cl" });
  res = fakeRes();
  await panel(req({ method: "POST", path: "/panel/woo/callback", json: { user_id: state, consumer_key: "ck_" + "a".repeat(40), consumer_secret: "cs_" + "b".repeat(40), key_permissions: "read_write" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(s.woo.t1, undefined);
});

// ---------- WhatsApp fase 1 ----------
const graphOk = () => mockFetch([
  [/\/v\d+\.\d+\/111111111\?/, { body: { id: "111111111", display_phone_number: "+56 9 1234 5678" } }],
  [/\/222222222\/phone_numbers/, { body: { data: [{ id: "111111111" }] } }],
  [/\/222222222\/subscribed_apps/, { body: { success: true } }],
  [/oauth\/access_token/, { body: { access_token: "EAAG-business-token-0000000000" } }],
  [/\/111111111\/register/, { body: { success: true } }],
]);

test("Phase 1 connect validates with Graph, subscribes webhook and stores encrypted-at-rest data", async () => {
  const s = memStore(); const { cookie, csrf } = loggedIn(s);
  const f = graphOk();
  const res = fakeRes();
  await createPanel({ store: s.api, fetchImpl: f })(req({ method: "POST", path: "/panel/whatsapp/connect", cookie, body: { csrf, access_token: "EAAG" + "x".repeat(40), phone_number_id: "111111111", waba_id: "222222222", app_secret: "c".repeat(32) } }), res);
  assert.equal(res.headers.location, "/panel?n=wa_ok");
  assert.equal(s.wa.t1.mode, "own_app");
  assert.equal(s.wa.t1.displayPhone, "+56 9 1234 5678");
  assert.ok(f.calls.some((c) => /subscribed_apps/.test(c.url) && c.opts.method === "POST"));
  assert.ok(f.calls.every((c) => !c.url.includes("EAAG")), "token must go in header, not URL");
  const expectedProof = crypto.createHmac("sha256", "c".repeat(32)).update("EAAG" + "x".repeat(40)).digest("hex");
  assert.ok(f.calls[0].url.includes("appsecret_proof=" + expectedProof), "app secret validated via appsecret_proof");
});

test("Phase 1 rejects phone that is not in the WABA", async () => {
  const s = memStore(); const { cookie, csrf } = loggedIn(s);
  const f = mockFetch([[/111111111\?/, { body: { id: "111111111" } }], [/phone_numbers/, { body: { data: [{ id: "333333333" }] } }]]);
  const res = fakeRes();
  await createPanel({ store: s.api, fetchImpl: f })(req({ method: "POST", path: "/panel/whatsapp/connect", cookie, body: { csrf, access_token: "EAAG" + "x".repeat(40), phone_number_id: "111111111", waba_id: "222222222", app_secret: "c".repeat(32) } }), res);
  assert.equal(res.headers.location, "/panel?n=wa_err");
  assert.equal(s.wa.t1, undefined);
});

// ---------- WhatsApp fase 2 ----------
test("Embedded Signup is off by default", async () => {
  delete process.env.WA_EMBEDDED_SIGNUP_ENABLED;
  const s = memStore(); const { cookie, csrf } = loggedIn(s);
  const res = fakeRes();
  await createPanel({ store: s.api })(req({ method: "POST", path: "/panel/whatsapp/embedded/start", cookie, headers: { "x-csrf-token": csrf } }), res);
  assert.equal(res.statusCode, 404);
});

test("Embedded Signup exchanges code, subscribes and registers phone when enabled", async () => {
  process.env.WA_EMBEDDED_SIGNUP_ENABLED = "true";
  try {
    const s = memStore(); const { cookie, csrf } = loggedIn(s);
    const f = graphOk(); const panel = createPanel({ store: s.api, fetchImpl: f });
    let res = fakeRes();
    await panel(req({ method: "POST", path: "/panel/whatsapp/embedded/start", cookie, headers: { "x-csrf-token": csrf } }), res);
    const { state } = JSON.parse(res.body);
    res = fakeRes();
    await panel(req({ method: "POST", path: "/panel/whatsapp/embedded/complete", cookie, headers: { "x-csrf-token": csrf }, json: { state, code: "AQD-code", waba_id: "222222222", phone_number_id: "111111111" } }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(s.wa.t1.mode, "embedded_signup");
    assert.equal(s.wa.t1.accessToken, "EAAG-business-token-0000000000");
    assert.match(s.wa.t1.pin, /^\d{6}$/);
    assert.ok(f.calls.some((c) => /oauth\/access_token\?.*client_id=123456789/.test(c.url)));
    assert.ok(f.calls.some((c) => /register/.test(c.url)));
  } finally { delete process.env.WA_EMBEDDED_SIGNUP_ENABLED; }
});

// ---------- Webhook routing ----------
function signed(body, secret) {
  const raw = Buffer.from(JSON.stringify(body));
  return { raw, sig: "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex") };
}
function waBody(phoneNumberId, text = "hola") {
  return { entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: "wamid." + Math.random(), from: "56911112222", type: "text", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text } }] } }] }] };
}
function webhookRes() {
  return { code: 200, out: null, status(c) { this.code = c; return this; }, json(p) { this.out = p; }, send(p) { this.out = p; } };
}

test("webhook routes by phone_number_id to tenant token and checks tenant app secret", async () => {
  const s = memStore();
  s.wa.t9 = { phoneNumberId: "111111111", accessToken: "tenant-token-xyz-000000", appSecret: "d".repeat(32) };
  const f = mockFetch([[/\/messages$/, { body: { messages: [{ id: "x" }] } }]]);
  const d = webhook._test.deps;
  Object.assign(d, { store: s.api, fetchImpl: f, claimInboundMessage: async () => true, releaseInboundMessage: async () => {}, handleMessage: async (a) => ({ reply: "ok:" + a.sessionId }) });

  const body = waBody("111111111");
  const { raw, sig } = signed(body, "d".repeat(32));
  const res = webhookRes();
  await webhook({ method: "POST", query: {}, headers: { "x-hub-signature-256": sig }, rawBody: raw, body }, res);
  assert.equal(res.code, 200);
  const call = f.calls.find((c) => /111111111\/messages/.test(c.url));
  assert.ok(call);
  assert.equal(call.opts.headers.Authorization, "Bearer tenant-token-xyz-000000");
  assert.match(JSON.parse(call.opts.body).text.body, /^ok:wa:t9:/);

  const bad = signed(waBody("111111111"), "a".repeat(32)); // firma con el secreto global, no el del tenant
  const res2 = webhookRes();
  await webhook({ method: "POST", query: {}, headers: { "x-hub-signature-256": bad.sig }, rawBody: bad.raw, body: JSON.parse(bad.raw) }, res2);
  assert.equal(res2.code, 403);
});

test("webhook keeps legacy env number working and ignores unknown numbers", async () => {
  const s = memStore();
  const f = mockFetch([[/\/messages$/, { body: {} }]]);
  Object.assign(webhook._test.deps, { store: s.api, fetchImpl: f, claimInboundMessage: async () => true, handleMessage: async () => ({ reply: "hola" }) });
  const legacy = signed(waBody("999999999"), "a".repeat(32));
  const res = webhookRes();
  await webhook({ method: "POST", query: {}, headers: { "x-hub-signature-256": legacy.sig }, rawBody: legacy.raw, body: JSON.parse(legacy.raw) }, res);
  assert.equal(res.code, 200);
  assert.equal(f.calls[0].opts.headers.Authorization, "Bearer legacy-token-000000000000");

  const unk = signed(waBody("555555555"), "a".repeat(32));
  const res2 = webhookRes();
  await webhook({ method: "POST", query: {}, headers: { "x-hub-signature-256": unk.sig }, rawBody: unk.raw, body: JSON.parse(unk.raw) }, res2);
  assert.equal(res2.out.status, "ignored");
  assert.equal(f.calls.length, 1);
});

test("webhook GET verification accepts legacy and per-tenant verify tokens", async () => {
  const s = memStore();
  const tok = P.verifyTokenFor("t1");
  await s.api.ensureVerifyTokenHash("t1", box.sha256(tok));
  webhook._test.deps.store = s.api;
  for (const [token, code] of [["legacy-verify", 200], [tok, 200], ["wrong", 403]]) {
    const res = webhookRes();
    await webhook({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "42" }, headers: {} }, res);
    assert.equal(res.code, code, token);
  }
});

test("Graph client errors never include the token", async () => {
  const f = mockFetch([[/./, { status: 401, body: { error: { code: 190, message: "bad EAAGsecret" } } }]]);
  await assert.rejects(meta.validateAndSubscribe({ accessToken: "EAAGsecret" + "x".repeat(20), phoneNumberId: "111111111", wabaId: "222222222" }, { fetchImpl: f }), (e) => !e.message.includes("EAAG"));
});

test("panel is off (404) when onboarding env is not configured, without breaking", async () => {
  const saved = process.env.CREDENTIALS_MASTER_KEY;
  delete process.env.CREDENTIALS_MASTER_KEY;
  try {
    const res = fakeRes();
    await createPanel({ store: memStore().api })(req({ path: "/panel" }), res);
    assert.equal(res.statusCode, 404);
  } finally { process.env.CREDENTIALS_MASTER_KEY = saved; }
});

test("PUBLIC_BASE_URL falls back to https://BOT_DOMAIN", () => {
  const saved = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL; process.env.BOT_DOMAIN = "bot.bluefishing.cl";
  try { assert.equal(P.configured(), true); } finally { process.env.PUBLIC_BASE_URL = saved; delete process.env.BOT_DOMAIN; }
});
