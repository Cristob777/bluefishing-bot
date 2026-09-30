const test = require("node:test");
const assert = require("node:assert/strict");
const { validateResponse, buildDeterministicFallback, extractTechnicalTokens } = require("../lib/responseValidator");

const product = {
  name: "Caña BADFISH Shore Cast 20-80g",
  price: "$109.990",
  url: "https://bluefishing.cl/producto/badfish-shore-cast/",
  category: "Cañas",
  brand: "BADFISH",
  useCase: "Spinning desde roca",
  verifiedNotes: "Rango de lanzamiento 20-80g",
  targetSpecies: ["corvina"],
  waterType: ["mar"],
  fishingPosition: ["roca"],
  technique: ["spinning"],
  evidence: ["Rango 20-80g"],
  extra: { weight_range: "20-80g" },
  scoreReasons: ["product_type", "weight", "position"],
};

test("valid grounded product response passes", () => {
  const result = validateResponse({
    response: "La BADFISH te sirve en ese rango 20-80g. $109.990 https://bluefishing.cl/producto/badfish-shore-cast/",
    products: [product],
    userMessage: "Busco una caña para 40g"
  });
  assert.equal(result.valid, true);
});

test("invented URL is blocked", () => {
  const result = validateResponse({
    response: "Mírala aquí https://bluefishing.cl/producto/inventado/",
    products: [product],
    userMessage: ""
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.startsWith("unretrieved_url:")));
});

test("invented price is blocked", () => {
  const result = validateResponse({
    response: "Cuesta $199.990.",
    products: [product],
    userMessage: ""
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((v) => v.startsWith("unsupported_price:")));
});

test("unverified stock claim is blocked", () => {
  const result = validateResponse({
    response: "Tenemos stock de esta caña.",
    products: [product],
    userMessage: ""
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.includes("unsupported_stock_claim"));
});

test("invented technical number is blocked", () => {
  const result = validateResponse({
    response: "Trabaja hasta 120g.",
    products: [product],
    userMessage: ""
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.includes("unsupported_technical_number:120g"));
});

test("fallback uses only retrieved product facts", () => {
  const text = buildDeterministicFallback([product]);
  assert.match(text, /BADFISH Shore Cast/);
  assert.match(text, /109\.990/);
  assert.match(text, /badfish-shore-cast/);
});

test("technical token parser normalizes units", () => {
  assert.deepEqual(extractTechnicalTokens("20 g, 10kg, PE 1.5 y 5.2:1"), ["20g","10kg","pe1.5","5.2:1"]);
});

test("real configured secret value is blocked from model output", () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-bluefishing-super-secret-value";
  try {
    const result = validateResponse({
      response: "La clave es sk-test-bluefishing-super-secret-value",
      products: [],
      userMessage: ""
    });
    assert.equal(result.valid, false);
    assert.ok(result.violations.includes("secret_or_prompt_leak"));
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
