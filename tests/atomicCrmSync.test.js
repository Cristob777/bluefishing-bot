const test = require("node:test");
const assert = require("node:assert/strict");
const s = require("../lib/atomicCrmSync");

test("stage mapping and forward-only advance", () => {
  assert.deepEqual(s.STAGES, ["nuevo", "interesado", "cotizado", "compro", "perdido"]);
  assert.equal(s.STAGE_LABELS.compro, "Compró");
  assert.equal(s.normalizeStage("Compró"), "compro");
  assert.equal(s.normalizeStage("???"), "nuevo");
  assert.equal(s.advanceStage("nuevo", "cotizado"), "cotizado");
  assert.equal(s.advanceStage("cotizado", "interesado"), "cotizado");
  assert.equal(s.advanceStage("perdido", "cotizado"), "perdido");
  assert.equal(s.advanceStage("compro", "interesado"), "compro");
});

test("inferStage from bot data", () => {
  assert.equal(s.inferStage({ quotes: 2 }), "cotizado");
  assert.equal(s.inferStage({ handoffs: 1 }), "interesado");
  assert.equal(s.inferStage({ intent_level: "high" }), "interesado");
  assert.equal(s.inferStage({}), "nuevo");
});

test("contact payload maps name/phone and never includes raw secrets", () => {
  const p = s.contactPayload({ name: "Ana María Pérez", phone: "56900000000", channel: "whatsapp", session_id: "wa:56900000000", message_count: 3 }, 5);
  assert.equal(p.first_name, "Ana");
  assert.equal(p.last_name, "María Pérez");
  assert.deepEqual(p.phone_jsonb, [{ number: "+56900000000", type: "Other" }]);
  assert.equal(p.sales_id, 5);
  const anon = s.contactPayload({ channel: "web", session_id: "web:x" });
  assert.equal(anon.first_name, "Cliente");
  assert.equal(anon.last_name, "Web");
});

// Fake del Postgres del bot con estado de atomic_crm_sync.
function fakeDb(rows, handoffs = []) {
  const map = new Map();
  const updates = [];
  const query = async (sql, params) => {
    if (sql.startsWith("select c.id")) return { rows };
    if (sql.startsWith("select source_id")) {
      return { rows: params[1].filter((id) => map.has(`${params[0]}:${id}`)).map((id) => ({ source_id: id, ...map.get(`${params[0]}:${id}`) })) };
    }
    if (sql.startsWith("insert into atomic_crm_sync")) { map.set(`${params[0]}:${params[1]}`, { target_id: params[2], payload_hash: params[3] }); return { rows: [] }; }
    if (sql.startsWith("update contacts")) { updates.push(params); return { rows: [] }; }
    if (sql.startsWith("select id, intent")) return { rows: handoffs };
    throw new Error("unexpected sql " + sql.slice(0, 40));
  };
  return { query, map, updates };
}

function fakeAtomic({ dealStage } = {}) {
  let next = 100;
  const calls = [];
  return {
    calls,
    insert: async (table, row) => { calls.push(["insert", table, row]); return { id: next++ }; },
    update: async (table, id, row) => { calls.push(["update", table, id, row]); return { id }; },
    get: async (table, id) => { calls.push(["get", table, id]); return { id, stage: dealStage }; },
    salesByEmail: async () => new Map([["vendedor@bluefishing.cl", 9]]),
  };
}

const ROW = { id: 1, channel: "whatsapp", session_id: "wa:569", name: "Ana", phone: "569", stage: "nuevo", assigned_to: "Vendedor@bluefishing.cl",
  message_count: 4, quotes: 1, handoffs: 1, handoff_open: true, recent_products: ["Caña Surf 4,2"], first_seen_at: "2026-10-01", last_seen_at: "2026-10-12" };

test("first run creates contact, deal (cotizado), handoff note and advances bot stage; second run is a no-op", async () => {
  const db = fakeDb([ROW], [{ id: 77, intent: "postventa", last_message: "ayuda", created_at: "2026-10-12" }]);
  const atomic = fakeAtomic();
  const log = { warn() {}, error() {} };
  const st1 = await s.runSync({ query: db.query, atomic, log });
  assert.deepEqual([st1.contacts, st1.deals, st1.notes, st1.stageAdvanced, st1.errors], [1, 1, 1, 1, 0]);
  const deal = atomic.calls.find((c) => c[1] === "deals")[2];
  assert.equal(deal.stage, "cotizado");
  assert.equal(deal.sales_id, 9);
  assert.deepEqual(deal.contact_ids, [100]);
  assert.deepEqual(db.updates[0], ["cotizado", 1, "nuevo"]);

  const before = atomic.calls.length;
  const st2 = await s.runSync({ query: db.query, atomic: Object.assign(atomic, {}), log });
  assert.equal(st2.contactsSkipped, 1);
  assert.equal(atomic.calls.slice(before).filter((c) => c[0] !== "get").length, 0);
});

test("does not move back a deal the team moved to compró in the kanban", async () => {
  const db = fakeDb([{ ...ROW, quotes: 0, handoffs: 0, handoff_open: false, intent_level: "high" }]);
  const atomic = fakeAtomic({ dealStage: "compro" });
  const log = { warn() {}, error() {} };
  await s.runSync({ query: db.query, atomic, log }); // crea deal en 'interesado'
  db.map.set("deal:1", { target_id: 101, payload_hash: "interesado" });
  const changed = fakeDb([{ ...ROW, stage: "interesado", handoffs: 0, handoff_open: false }]);
  for (const [k, v] of db.map) changed.map.set(k, v);
  await s.runSync({ query: changed.query, atomic, log });
  assert.equal(atomic.calls.filter((c) => c[0] === "update" && c[1] === "deals").length, 0);
});

test("row errors are counted and do not stop the batch", async () => {
  const db = fakeDb([ROW, { ...ROW, id: 2, session_id: "wa:570", handoffs: 0 }]);
  const atomic = fakeAtomic();
  let n = 0;
  atomic.insert = async (table) => { if (table === "contacts" && n++ === 0) throw new Error("503"); return { id: 200 + n }; };
  const st = await s.runSync({ query: db.query, atomic, log: { warn() {}, error() {} } });
  assert.equal(st.errors, 1);
  assert.ok(st.contacts >= 1);
});

test("PostgREST client sends secret key headers and filters by id", async () => {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, text: async () => '[{"id":5}]' }; };
  const c = s.createAtomicClient({ url: "https://abc.supabase.co/", key: "sb_secret_test" }, fetch);
  assert.equal((await c.insert("contacts", { first_name: "A" })).id, 5);
  await assert.rejects(c.update("deals", "7; drop", { stage: "cotizado" }), /invalid id/);
  await c.update("deals", 7, { stage: "cotizado" });
  assert.equal(calls[0].url, "https://abc.supabase.co/rest/v1/contacts");
  assert.equal(calls[0].opts.headers.apikey, "sb_secret_test");
  assert.equal(calls[1].url, "https://abc.supabase.co/rest/v1/deals?id=eq.7");
  assert.equal(calls[1].opts.method, "PATCH");
});
