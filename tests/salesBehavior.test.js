const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDeterministicFallback } = require("../lib/responseValidator");
const { formatProductsCompactForPrompt } = require("../lib/catalog");

function product(overrides = {}) {
  return {
    name: "Caña Test",
    price: "$59.990",
    url: "https://bluefishing.cl/producto/test/",
    productType: "caña",
    brand: "unknown",
    targetSpecies: [],
    waterType: ["mar", "río"],
    fishingPosition: [],
    technique: [],
    extra: {},
    needsReview: true,
    verification: "parcial",
    scoreReasons: [],
    ...overrides,
  };
}

test("el fallback cierra con un paso concreto de compra", () => {
  const one = buildDeterministicFallback([product()]);
  assert.match(one, /comprar/);
  const two = buildDeterministicFallback([product(), product({ name: "Caña B", url: "https://bluefishing.cl/producto/b/" })]);
  assert.match(two, /¿Cuál prefieres\?/);
});

test("sin productos, el agente califica en vez de mandar a la web", () => {
  const reply = buildDeterministicFallback([]);
  assert.doesNotMatch(reply, /https?:\/\//);
  assert.match(reply, /especie/);
});

test("el prompt no presenta fichas heurísticas como verificadas", () => {
  const text = formatProductsCompactForPrompt([product()], { water_type: "mar" });
  assert.match(text, /ficha=parcial/);
  assert.match(text, /agua=por_confirmar/);
  assert.doesNotMatch(text, /verificado=sí/);
});

test("la nota del vendedor llega al prompt de ventas", () => {
  const text = formatProductsCompactForPrompt([product({ verifiedNotes: "El más vendido para lenguado en playa", verification: "verificada", needsReview: false, waterType: ["mar"] })], {});
  assert.match(text, /nota_vendedor=El más vendido para lenguado en playa/);
});
