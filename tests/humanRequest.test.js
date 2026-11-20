const test = require("node:test");
const assert = require("node:assert/strict");
const { HUMAN_REQUEST_RE } = require("../lib/humanRequest");
const { handleMessage } = require("../lib/salesEngine");

test("detecta pedir una persona", () => {
  for (const t of ["quiero hablar con un vendedor", "me atiende una vendedora?", "¿puedo hablar con una persona?",
    "necesito un asesor", "pásame con un humano", "quiero hablar con alguien", "Vendedor por favor"]) {
    assert.ok(HUMAN_REQUEST_RE.test(t), t);
  }
});

test("no confunde asesoría ni palabras parecidas con pedir un humano", () => {
  for (const t of ["necesito asesoría para elegir caña", "busco asesoramiento", "¿qué venden para corvina?",
    "carrete para pejerrey", "personalizado"]) {
    assert.ok(!HUMAN_REQUEST_RE.test(t), t);
  }
});

test("el motor de ventas traspasa sin LLM y sin prometer respuesta 'por aquí' en el chat web", async () => {
  const r = await handleMessage({ sessionId: "web:test-humano", text: "hola, quiero hablar con un vendedor" });
  assert.equal(r.debug.route, "handoff_zero_llm");
  assert.equal(r.debug.next_action, "handoff_human");
  assert.equal(r.debug.intent, "pide_humano");
  assert.doesNotMatch(r.reply, /por aqu[ií]/i);
});
