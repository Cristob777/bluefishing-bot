const test = require("node:test");
const assert = require("node:assert/strict");
const { extractDeterministicSignals } = require("../lib/tokenGovernor");
const budget = (m) => extractDeterministicSignals(m).context.budget_range;

test("presupuesto en forma chilena se guarda en la memoria del cliente", () => {
  assert.equal(budget("busco caña para roca, hasta 80 mil"), "80000");
  assert.equal(budget("tengo 80 lucas"), "80000");
  assert.equal(budget("presupuesto 120k"), "120000");
  assert.equal(budget("120 mil pesos máximo"), "120000");
  assert.equal(budget("como $80.000"), "80000");
});

test("medidas no se confunden con presupuesto", () => {
  for (const m of ["caña de 3 metros", "señuelo 30g", "línea de 300m", "2 mil metros de línea", "carrete 4000", "multifilamento 30 lbs"]) {
    assert.equal(budget(m), "unknown", m);
  }
});
