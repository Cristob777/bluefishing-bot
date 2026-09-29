const test = require("node:test");
const assert = require("node:assert/strict");
const { heuristicKnowledge } = require("../lib/knowledgeExtractor");

test("heuristicKnowledge extracts grounded rod use", () => {
  const result = heuristicKnowledge({
    name: "BADFISH SHORE CAST 3m 20-80g",
    category: "Cañas de mar",
    productType: "caña",
    sourceText: "Caña spinning para pesca desde orilla y roca. Rango de señuelo 20-80g."
  });

  assert.ok(result.water_type.includes("mar"));
  assert.ok(result.fishing_position.includes("orilla"));
  assert.ok(result.fishing_position.includes("roca"));
  assert.ok(result.technique.includes("spinning"));
  assert.equal(result.extra.weight_range, "20-80g");
  assert.equal(result.extraction_method, "heuristic");
});

test("heuristicKnowledge does not invent species", () => {
  const result = heuristicKnowledge({
    name: "Caña genérica 10-30g",
    category: "Cañas",
    productType: "caña",
    sourceText: "Caña para spinning."
  });
  assert.deepEqual(result.target_species, []);
});
