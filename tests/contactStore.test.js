const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const store = require("../lib/contactStore");

test("no-op without DATABASE_URL", async () => {
  store._setQuery(null);
  assert.equal(await store.upsertContact({ externalId: "56900000000" }), null);
});

test("upserts WhatsApp contact keyed to existing session_id format", async () => {
  const calls = [];
  store._setQuery(async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 7 }] }; });
  const id = await store.upsertContact({ channel: "whatsapp", externalId: "+56 9 0000 0000", name: "  Ana\nPérez " });
  assert.equal(id, 7);
  assert.deepEqual(calls[0].params, ["whatsapp", "56900000000", "wa:56900000000", "Ana Pérez", "56900000000", null]);
  assert.match(calls[0].sql, /on conflict \(channel, external_id\)/);
  assert.match(calls[0].sql, /\$1/); // parametrizado, sin interpolar datos del usuario
});

test("rejects unknown channel and empty id", async () => {
  let called = false;
  store._setQuery(async () => { called = true; return { rows: [] }; });
  assert.equal(await store.upsertContact({ channel: "sms", externalId: "1" }), null);
  assert.equal(await store.upsertContact({ channel: "whatsapp", externalId: "abc" }), null);
  assert.equal(called, false);
});

test("database errors never throw", async () => {
  store._setQuery(async () => { throw new Error("connection refused"); });
  const orig = console.error; console.error = () => {};
  try {
    assert.equal(await store.upsertContact({ externalId: "56900000000" }), null);
    assert.doesNotThrow(() => store.trackContact({ externalId: "56900000000" }));
    await new Promise((r) => setImmediate(r));
  } finally { console.error = orig; }
});

test("cleanName bounds length and strips control chars", () => {
  assert.equal(store.cleanName("a".repeat(500)).length, 120);
  assert.equal(store.cleanName("\u0000\u0007"), null);
  assert.equal(store.cleanName(42), null);
});

test("migration is idempotent and mirrored in schema.sql", () => {
  const mig = fs.readFileSync(path.join(__dirname, "../db/migrations/003_crm_contacts.sql"), "utf8");
  const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
  for (const stmt of mig.match(/create (table|index)[^\n]*/g)) assert.match(stmt, /if not exists/);
  assert.match(mig, /create or replace view crm_contact_overview/);
  assert.match(schema, /create table if not exists contacts/);
  assert.match(mig, /stage text not null default 'nuevo'/);
});
