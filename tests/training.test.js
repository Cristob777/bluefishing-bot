const test = require("node:test");
const assert = require("node:assert/strict");
const training = require("../lib/training");
const { selectRelevantExamples } = require("../lib/learnedExamples");

function fakeQuery() {
  const calls = [];
  const fn = async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: "f1" }], rowCount: 1 }; };
  fn.calls = calls;
  return fn;
}

test("la ficha verificada solo acepta valores permitidos y limpia especies", async () => {
  const q = fakeQuery();
  const row = await training.saveProductSheet(q, {
    url: "https://bluefishing.cl/producto/x/",
    water: ["mar", "hack<script>"], position: "roca", technique: ["spinning", "nope"],
    species: "Corvina,  lenguado, corvina", notes: "  Ideal para roquerío \u0007 ", actor: "admin:owner",
  });
  assert.deepEqual(row.water_type, ["mar"]);
  assert.deepEqual(row.fishing_position, ["roca"]);
  assert.deepEqual(row.technique, ["spinning"]);
  assert.deepEqual(row.target_species, ["corvina", "lenguado"]);
  assert.equal(row.verified_notes, "Ideal para roquerío");
  assert.match(q.calls[0].sql, /on conflict \(product_url\)/);
  assert.equal(q.calls[0].params.at(-1), "admin:owner");
});

test("no se aprueba una corrección vacía", async () => {
  const q = fakeQuery();
  assert.equal(await training.resolveFeedback(q, { id: "f1", correction: "   ", actor: "admin:owner" }), false);
  assert.equal(q.calls.length, 0);
  assert.equal(await training.resolveFeedback(q, { id: "f1", correction: "Responde así", actor: "admin:owner" }), true);
});

test("Matías usa las correcciones más parecidas a lo que pregunta el cliente", () => {
  const examples = [
    { userMessage: "carrete para trucha en río", correction: "A" },
    { userMessage: "envío a Punta Arenas", correction: "B" },
    { userMessage: "caña para corvina desde roquerío", correction: "C" },
  ];
  const picked = selectRelevantExamples(examples, "¿Qué caña sirve para corvina en el roquerío?", 2);
  assert.equal(picked[0].correction, "C");
  assert.equal(picked.length, 2);
  assert.deepEqual(selectRelevantExamples(examples, "hola", 1).map((e) => e.correction), ["A"], "sin parecido: la más reciente");
});

test("una ficha verificada ya no está por revisar", () => {
  assert.equal(training.needsReview({ verification: "parcial", needsReview: false, waterType: [] }), true);
  assert.equal(training.needsReview({ verification: "verificada", needsReview: false, waterType: [] }), false);
});
