const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractDeterministicSignals,
  staticConversationReply,
  deterministicCommerceReply,
  getTokenPlan,
  compactHistory,
  summarizeUsage,
} = require("../lib/tokenGovernor");

test("simple greeting is handled without an LLM", () => {
  assert.match(staticConversationReply("Hola"), /Matías/);
  assert.equal(staticConversationReply("Busco una caña"), null);
});

test("deterministic parser extracts fishing context", () => {
  const result = extractDeterministicSignals("Busco caña Daiwa para corvina desde roca, uso 40g");
  assert.equal(result.context.product_type, "caña");
  assert.equal(result.context.brand_preference, "DAIWA");
  assert.equal(result.context.target_species, "corvina");
  assert.equal(result.context.fishing_position, "roca");
  assert.equal(result.context.weight_grams, "40g");
  assert.equal(result.canSkipClassifier, true);
});

test("recommendation wording is recognized deterministically", () => {
  const result = extractDeterministicSignals("Recomiéndame una caña para corvina");
  assert.equal(result.intent, "pedir_recomendacion");
  assert.equal(result.canSkipClassifier, true);
});

test("price lookup can use deterministic commerce response", () => {
  const products = [{
    name: "DAIWA CARRETE FUEGO LT 5000D-C",
    normalizedName: "daiwa carrete fuego lt 5000d-c",
    price: "$189.990",
    url: "https://bluefishing.cl/producto/daiwa-carrete-fuego-lt-5000d-c/",
    score: 21,
    scoreReasons: ["brand", "name_tokens"],
  }];
  const reply = deterministicCommerceReply({
    message: "precio Daiwa Fuego 5000",
    classification: { intent: "stock_precio" },
    products,
  });
  assert.match(reply, /189\.990/);
  assert.match(reply, /bluefishing\.cl/);
});

test("token plan caps context for specific technical query", () => {
  const plan = getTokenPlan({
    intent: "pedir_recomendacion",
    extracted_context: {
      target_species: "corvina",
      water_type: "mar",
      fishing_position: "roca",
      technique: "spinning",
      weight_range: "20-50g",
    },
  }, "caña para corvina");
  assert.equal(plan.maxProducts, 2);
  assert.equal(plan.historyMessages, 2);
  assert.ok(plan.salesMaxOutputTokens <= 240);
});

test("history is compacted before model calls", () => {
  const history = [
    { role: "user", content: "a".repeat(500) },
    { role: "assistant", content: "b".repeat(500) },
    { role: "user", content: "c".repeat(500) },
  ];
  const compact = compactHistory(history, 2, 100);
  assert.equal(compact.length, 2);
  assert.equal(compact[0].content.length, 100);
});

test("real API usage is summarized per turn", () => {
  const result = summarizeUsage([
    { input_tokens: 100, cached_input_tokens: 50, cache_write_tokens: 25, output_tokens: 20, total_tokens: 120 },
    { input_tokens: 200, cached_input_tokens: 0, cache_write_tokens: 0, output_tokens: 30, total_tokens: 230 },
  ]);
  assert.deepEqual(result, {
    llm_calls: 2,
    input_tokens: 300,
    cached_input_tokens: 50,
    cache_write_tokens: 25,
    output_tokens: 50,
    total_tokens: 350,
  });
});
