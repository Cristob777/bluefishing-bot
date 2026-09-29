const test = require("node:test");
const assert = require("node:assert/strict");
const { heuristicKnowledge } = require("../lib/knowledgeExtractor");

test("heuristicKnowledge extracts fishing context without inventing fields", () => {
  const k = heuristicKnowledge({
    name: "BADFISH Shore Jigging 20-80g",
    category: "Cañas",
    productType: "caña",
    sourceText: "Caña spinning para pesca desde roca y orilla en mar. Rango 20-80g."
  });

  assert.ok(k.technique.includes("spinning"));
  assert.ok(k.water_type.includes("mar"));
  assert.ok(k.fishing_position.includes("roca"));
  assert.ok(k.fishing_position.includes("orilla"));
  assert.equal(k.extra.weight_range, "20-80g");
  assert.equal(k.extraction_method, "heuristic");
});
