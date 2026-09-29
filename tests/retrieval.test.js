const test = require("node:test");
const assert = require("node:assert/strict");
const { parseNumberRange, overlaps, budgetMatch } = require("../lib/catalog");

test("weight ranges overlap when customer grams fit product range", () => {
  assert.equal(overlaps(parseNumberRange("20-80g"), parseNumberRange("40g")), true);
  assert.equal(overlaps(parseNumberRange("5-15g"), parseNumberRange("40g")), false);
});

test("budgetMatch handles CLP ranges and max budget", () => {
  assert.equal(budgetMatch("$109.990", "hasta 120000"), true);
  assert.equal(budgetMatch("$149.990", "80000-120000"), false);
});
