const test = require("node:test");
const assert = require("node:assert/strict");
const crm = require("../lib/crm");
const W = require("../lib/wooOrders");

const T = "11111111-2222-3333-4444-555555555555";

test("moveStage is scoped to the company and validates input", async () => {
  const calls = [];
  const q = async (sql, p) => { calls.push({ sql, p }); return { rows: sql.startsWith("update") ? [{ id: 5, tenant_id: T, old: "nuevo" }] : [] }; };
  assert.equal(await crm.moveStage(q, { tenantId: T, contactId: "5", stage: "cotizado", actor: "x" }), true);
  assert.match(calls[0].sql, /c\.tenant_id = \$3/);
  assert.deepEqual(calls[0].p, [5, "cotizado", T]);
  assert.match(calls[1].sql, /contact_stage_events/);
  assert.equal(await crm.moveStage(q, { tenantId: T, contactId: "5;drop", stage: "cotizado" }), false);
  assert.equal(await crm.moveStage(q, { tenantId: T, contactId: "5", stage: "hackeado" }), false);
});

test("listContacts never interpolates sort/filter values", async () => {
  let got;
  const q = async (sql, p) => { got = { sql, p }; return { rows: [] }; };
  await crm.listContacts(q, { tenantId: T, q: "ana'; drop", stage: "nuevo", sort: "x; drop table", dir: "asc" });
  assert.ok(!got.sql.includes("drop"));
  assert.match(got.sql, /order by c\.last_seen_at asc/);
  assert.ok(got.p.includes("%ana'; drop%"));
});

test("safeBack only allows same-area relative redirects", () => {
  assert.equal(crm.safeBack("/panel/embudo", "/panel/"), "/panel/embudo");
  assert.equal(crm.safeBack("https://evil.test", "/panel/"), "/panel/");
  assert.equal(crm.safeBack("//evil.test", "/panel/"), "/panel/");
});

test("woo order sync attributes by phone within window and marks contact as Compró", async () => {
  const calls = [];
  const q = async (sql, p) => {
    calls.push({ sql, p });
    if (sql.includes("from contacts")) return { rows: p[1] === "977778888" ? [{ id: 42, session_id: `wa:${T}:56977778888` }] : [] };
    if (sql.startsWith("update contacts")) return { rows: [{ id: 42 }] };
    return { rows: [] };
  };
  const orders = [
    { id: 1, status: "completed", total: "45990", currency: "CLP", date_created_gmt: "2026-10-19T12:00:00", billing: { phone: "+56 9 7777 8888", email: "" } },
    { id: 2, status: "completed", total: "10000", currency: "CLP", date_created_gmt: "2026-10-19T12:00:00", billing: { phone: "+56 9 1234 0000" } },
  ];
  const fetchImpl = async (url, opt) => {
    assert.match(url, /\/wp-json\/wc\/v3\/orders\?/);
    assert.match(opt.headers.Authorization, /^Basic /);
    return { ok: true, json: async () => orders };
  };
  const r = await W.syncOrders(q, { tenantId: T, creds: { storeUrl: "https://t.cl", consumerKey: "ck", consumerSecret: "cs" }, fetchImpl });
  assert.deepEqual(r, { ok: true, orders: 2, attributed: 1 });
  const inserts = calls.filter((c) => c.sql.includes("insert into woo_orders"));
  assert.equal(inserts[0].p[8], 42);
  assert.equal(inserts[1].p[8], null);
  assert.ok(calls.some((c) => c.sql.includes("stage='compro'")));
  assert.ok(calls.some((c) => c.sql.includes("tenant_id = $1")));
});

test("woo sync failure is reported, never invents data", async () => {
  const q = async () => ({ rows: [] });
  const r = await W.syncOrders(q, { tenantId: T, creds: { storeUrl: "https://t.cl", consumerKey: "a", consumerSecret: "b" }, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(r.ok, false);
});
