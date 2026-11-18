const test = require("node:test");
const assert = require("node:assert/strict");
const { syncAllStores } = require("../lib/wooOrders");

const T1 = "11111111-1111-1111-1111-111111111111"; // BlueFishing, conectada por /panel
const T2 = "22222222-2222-2222-2222-222222222222"; // otra empresa

const CREDS = {
  [T1]: { storeUrl: "https://bluefishing.cl", consumerKey: "ck_1", consumerSecret: "cs_1" },
  [T2]: { storeUrl: "https://otra.cl", consumerKey: "ck_2", consumerSecret: "cs_2" },
};

function harness({ connected = [T1, T2] } = {}) {
  const inserts = []; // [tenant_id, order_id] por pedido guardado
  const lookups = []; // tenant_id usado al buscar el contacto
  const query = async (sql, params = []) => {
    if (/from tenant_credentials/.test(sql)) return { rows: connected.map((id) => ({ tenant_id: id })) };
    if (/select id, session_id from contacts/.test(sql)) {
      lookups.push({ scoped: /tenant_id = \$1/.test(sql), tenantId: params[0] });
      return { rows: [{ id: 7, session_id: "wa:56911111111" }] };
    }
    if (/insert into woo_orders/.test(sql)) { inserts.push({ tenantId: params[0], orderId: params[1] }); return { rows: [] }; }
    if (/update contacts/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
  const store = { getWooCredentials: async (id) => CREDS[id] || null };
  const fetchImpl = async (url) => {
    const host = new URL(url).hostname;
    const id = host === "bluefishing.cl" ? 1001 : 2002;
    return {
      ok: true,
      status: 200,
      json: async () => [{ id, status: "completed", total: "59990", currency: "CLP", date_created_gmt: new Date().toISOString().slice(0, 19), billing: { phone: "+56 9 1111 1111", email: "" } }],
    };
  };
  return { query, store, fetchImpl, inserts, lookups };
}

test("store connected via /panel is synced as the operator (tenant_id null), not as its tenant", async () => {
  const h = harness();
  const resolveOperator = async () => ({ source: "panel", tenantId: T1, ...CREDS[T1] });
  const results = await syncAllStores(h.query, { store: h.store, resolveOperator, fetchImpl: h.fetchImpl });

  const bf = h.inserts.filter((i) => i.orderId === 1001);
  assert.equal(bf.length, 1, "el pedido de BlueFishing se guarda una sola vez");
  assert.equal(bf[0].tenantId, null, "en el ámbito del operador, donde viven sus contactos de WhatsApp");

  const other = h.inserts.filter((i) => i.orderId === 2002);
  assert.equal(other.length, 1);
  assert.equal(other[0].tenantId, T2, "las demás empresas siguen en su propio ámbito");

  assert.equal(h.lookups[0].scoped, false, "operador: busca contactos con tenant_id is null");
  assert.deepEqual(results.map((r) => r.scope), ["operator", "tenant"]);
});

test(".env operator keys keep working and every connected tenant syncs in its own scope", async () => {
  const h = harness({ connected: [T2] });
  const resolveOperator = async () => ({ source: "env", tenantId: null, ...CREDS[T1] });
  await syncAllStores(h.query, { store: h.store, resolveOperator, fetchImpl: h.fetchImpl });
  assert.deepEqual(h.inserts.map((i) => i.tenantId), [null, T2]);
});

test("an unresolvable operator does not block the other tenants", async () => {
  const h = harness({ connected: [T2] });
  const resolveOperator = async () => { throw new Error("varias tiendas"); };
  const logs = [];
  const results = await syncAllStores(h.query, { store: h.store, resolveOperator, fetchImpl: h.fetchImpl, log: (...a) => logs.push(a.join(" ")) });
  assert.deepEqual(results.map((r) => r.scope), ["tenant"]);
  assert.ok(logs.some((l) => /operador no resuelta/.test(l)));
});

test("no connected store at all → nothing synced", async () => {
  const h = harness({ connected: [] });
  const results = await syncAllStores(h.query, { store: h.store, resolveOperator: async () => null, fetchImpl: h.fetchImpl });
  assert.equal(results.length, 0);
  assert.equal(h.inserts.length, 0);
});
