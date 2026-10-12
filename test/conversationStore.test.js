// node --test test/
const test = require("node:test");
const assert = require("node:assert");
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const store = require("../lib/conversationStore");

function fakeClient({ failOn } = {}) {
  const calls = [];
  const db = { contacts: [], conversations: [], messages: [] };
  const from = (table) => {
    const q = { table, op: null, row: null };
    const result = () => {
      if (failOn === table) return { data: null, error: new Error("boom " + table) };
      if (q.op === "upsert" || q.op === "insert") {
        const r = { id: table + "-" + (db[table].length + 1), status: "bot", ...q.row };
        db[table].push(r); calls.push([table, q.op, q.row]);
        return { data: r, error: null };
      }
      if (q.op === "select") return { data: db[table].slice(-1), error: null };
      calls.push([table, q.op]); return { data: null, error: null };
    };
    const chain = {
      upsert(row) { q.op = "upsert"; q.row = row; return chain; },
      insert(row) { q.op = "insert"; q.row = row; return chain; },
      update(row) { q.op = "update"; q.row = row; return chain; },
      select() { if (!q.op) q.op = "select"; return chain; },
      eq() { return chain; }, neq() { return chain; }, gte() { return chain; }, order() { return chain; },
      limit() { return Promise.resolve(result()); },
      single() { return Promise.resolve(result()); },
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return chain;
  };
  return { from, calls, db };
}

test("no-op sin env", async () => {
  store._setClient(null);
  assert.strictEqual(store.isEnabled(), false);
  assert.strictEqual(await store.recordExchange({ channel: "web", externalId: "s1", userText: "hola", botReply: "x" }), null);
});

test("recordExchange crea contacto, conversación y 2 mensajes", async () => {
  const c = fakeClient(); store._setClient(c);
  const id = await store.recordExchange({ channel: "whatsapp", externalId: "569", name: "Ana", userText: "hola", botReply: "¡Hola!" });
  assert.ok(id);
  assert.strictEqual(c.db.contacts[0].external_id, "569");
  assert.deepStrictEqual(c.db.messages.map((m) => [m.direction, m.role]), [["in", "user"], ["out", "bot"]]);
});

test("errores de Supabase no lanzan", async () => {
  for (const t of ["contacts", "conversations", "messages"]) {
    store._setClient(fakeClient({ failOn: t }));
    const orig = console.error; console.error = () => {};
    try {
      await assert.doesNotReject(store.recordExchange({ channel: "web", externalId: "s", userText: "a", botReply: "b" }));
    } finally { console.error = orig; }
  }
});
