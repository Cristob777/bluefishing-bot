const test = require("node:test");
const assert = require("node:assert/strict");
const { refreshStage } = require("../lib/crmStages");

// query falso: devuelve la fila del contacto y registra updates / eventos.
function harness(row, { updateHits = true } = {}) {
  const updates = [], events = [];
  const query = async (sql, params) => {
    if (/from contacts c left join bot_sessions/.test(sql)) return { rows: row ? [row] : [] };
    if (/update contacts set stage/.test(sql)) { updates.push(params); return { rows: updateHits ? [{ id: params[1] }] : [] }; }
    if (/insert into contact_stage_events/.test(sql)) { events.push(params); return { rows: [] }; }
    throw new Error("sql inesperado");
  };
  return { query, updates, events };
}
const base = { id: 7, tenant_id: null, stage: "nuevo", intent_level: null, quotes: 0, handoffs: 0, handoff_open: false };

test("Matías recomendó productos → Cotizado, con evento de historial actor=bot", async () => {
  const h = harness({ ...base, quotes: 1 });
  assert.deepEqual(await refreshStage(h.query, "wa:569"), [{ contactId: 7, from: "nuevo", to: "cotizado" }]);
  assert.deepEqual(h.updates[0], ["cotizado", 7, "nuevo"]);
  assert.deepEqual(h.events[0], [7, null, "nuevo", "cotizado"]);
});

test("intención media/alta o pedir una persona → Interesado", async () => {
  for (const extra of [{ intent_level: "media" }, { intent_level: "high" }, { handoffs: 1 }]) {
    const h = harness({ ...base, ...extra });
    assert.equal((await refreshStage(h.query, "wa:569"))[0].to, "interesado", JSON.stringify(extra));
  }
});

test("nunca retrocede ni toca etapas finales", async () => {
  for (const stage of ["cotizado", "compro", "perdido"]) {
    const h = harness({ ...base, stage, handoffs: 1 });
    assert.deepEqual(await refreshStage(h.query, "wa:569"), [], stage);
    assert.equal(h.updates.length, 0);
  }
});

test("sin señales de compra se queda en Nuevo (no escribe nada)", async () => {
  const h = harness({ ...base, intent_level: "baja" });
  assert.deepEqual(await refreshStage(h.query, "wa:569"), []);
  assert.equal(h.updates.length, 0);
});

test("si un humano movió la etapa entre medio, no se pisa ni se registra evento", async () => {
  const h = harness({ ...base, quotes: 2 }, { updateHits: false });
  assert.deepEqual(await refreshStage(h.query, "wa:569"), []);
  assert.equal(h.events.length, 0);
});

test("contacto aún no creado o error de BD: no rompe la respuesta al cliente", async () => {
  assert.deepEqual(await refreshStage(harness(null).query, "wa:569"), []);
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(await refreshStage(async () => { throw new Error("db down"); }, "wa:569"), []);
  } finally { console.warn = warn; }
});
