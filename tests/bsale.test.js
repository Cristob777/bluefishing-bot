const test = require("node:test");
const assert = require("node:assert/strict");
const bsale = require("../lib/bsale");
const { validateResponse } = require("../lib/responseValidator");
const { formatProductsCompactForPrompt } = require("../lib/catalog");

const cfg = (over = {}) => ({ ...bsale.config({ BSALE_ACCESS_TOKEN: "tok_test", ...over }) });

// Respuestas falsas de /v1/stocks.json por SKU.
function fakeFetch(table, calls = []) {
  return async (url, opts) => {
    calls.push({ url: String(url), token: opts?.headers?.access_token });
    const code = new URL(String(url)).searchParams.get("code");
    if (table[code] === "error") return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ items: table[code] || [] }) };
  };
}
const item = (qty, office = 1) => ({ quantityAvailable: qty, office: { id: String(office) } });

function product(name, url, extra = {}) {
  return {
    name, url, price: "$69.990", productType: "caña", brand: "unknown", targetSpecies: [], waterType: [],
    fishingPosition: [], technique: [], extra: {}, verification: "parcial", scoreReasons: [], ...extra,
  };
}

test.beforeEach(() => bsale.clearStockCache());

test("sin token Bsale queda apagado y no toca los productos", async () => {
  assert.equal(bsale.isEnabled({}), false);
  assert.equal(bsale.isEnabled({ BSALE_ACCESS_TOKEN: "CHANGE_ME" }), false);
  const ps = [product("A", "https://bluefishing.cl/producto/a/")];
  const out = await bsale.applyLiveStock(ps, { cfg: bsale.config({}) });
  assert.equal(out, ps);
  assert.equal(out[0].stock, undefined);
});

test("suma quantityAvailable de todas las sucursales y envía el token en el header", async () => {
  const calls = [];
  const s = await bsale.getStockBySku("CAN-270", { cfg: cfg(), fetchImpl: fakeFetch({ "CAN-270": [item(3, 1), item(1, 2)] }, calls) });
  assert.deepEqual(s, { sku: "CAN-270", status: "in_stock", available: 4 });
  assert.equal(calls[0].token, "tok_test");
  assert.match(calls[0].url, /^https:\/\/api\.bsale\.io\/v1\/stocks\.json\?code=CAN-270/);
});

test("BSALE_OFFICE_IDS limita el stock a las sucursales indicadas", async () => {
  const s = await bsale.getStockBySku("X", { cfg: cfg({ BSALE_OFFICE_IDS: "2" }), fetchImpl: fakeFetch({ X: [item(5, 1), item(0, 2)] }) });
  assert.equal(s.status, "out_of_stock");
  assert.equal(s.available, 0);
});

test("SKU inexistente en Bsale = not_found; error de red = unknown (nunca se inventa stock)", async () => {
  assert.equal((await bsale.getStockBySku("NOPE", { cfg: cfg(), fetchImpl: fakeFetch({}) })).status, "not_found");
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await bsale.getStockBySku("DOWN", { cfg: cfg(), fetchImpl: fakeFetch({ DOWN: "error" }) })).status, "unknown");
  } finally { console.warn = warn; }
});

test("si Bsale falla, deja de consultarlo un rato (no suma timeouts a cada respuesta)", async () => {
  const calls = [];
  const f = fakeFetch({ A: "error", B: [item(1)] }, calls);
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await bsale.getStockBySku("A", { cfg: cfg(), fetchImpl: f })).status, "unknown");
    const b = await bsale.getStockBySku("B", { cfg: cfg(), fetchImpl: f });
    assert.equal(b.status, "unknown");
    assert.equal(b.reason, "bsale_down");
    assert.equal(calls.length, 1, "no vuelve a llamar mientras el breaker está abierto");
  } finally { console.warn = warn; }
});

test("la caché evita repetir la consulta del mismo SKU", async () => {
  const calls = [];
  const f = fakeFetch({ A: [item(2)] }, calls);
  await bsale.getStockBySku("A", { cfg: cfg(), fetchImpl: f });
  await bsale.getStockBySku("A", { cfg: cfg(), fetchImpl: f });
  assert.equal(calls.length, 1);
});

test("applyLiveStock oculta solo el stock 0 confirmado y marca sin_verificar lo que no tiene SKU", async () => {
  const skuMap = new Map([
    ["https://bluefishing.cl/producto/con-stock", "S1"],
    ["https://bluefishing.cl/producto/agotado", "S2"],
  ]);
  const ps = [
    product("Con stock", "https://bluefishing.cl/producto/con-stock/"),
    product("Agotado", "https://bluefishing.cl/producto/agotado/"),
    product("Sin SKU", "https://bluefishing.cl/producto/sin-sku/"),
  ];
  const out = await bsale.applyLiveStock(ps, { cfg: cfg(), skuMap, fetchImpl: fakeFetch({ S1: [item(4)], S2: [item(0)] }) });
  assert.deepEqual(out.map((p) => p.name), ["Con stock", "Sin SKU"]);
  assert.equal(out[0].stock.available, 4);
  assert.equal(out[1].stock.status, "unknown");

  const prompt = formatProductsCompactForPrompt(out, {});
  assert.match(prompt, /Con stock .*stock=4/);
  assert.match(prompt, /Sin SKU .*stock=sin_verificar/);
});

test("el validador permite afirmar stock solo con evidencia en vivo de Bsale", () => {
  const p = product("Caña", "https://bluefishing.cl/producto/c/");
  const reply = "Sí, hay stock de la Caña a $69.990: https://bluefishing.cl/producto/c/";
  assert.ok(validateResponse({ response: reply, products: [p] }).violations.includes("unsupported_stock_claim"));
  const live = { ...p, stock: { status: "in_stock", available: 2 } };
  assert.ok(!validateResponse({ response: reply, products: [live] }).violations.includes("unsupported_stock_claim"));
  const unknown = { ...p, stock: { status: "unknown", available: null } };
  assert.ok(validateResponse({ response: reply, products: [unknown] }).violations.includes("unsupported_stock_claim"));
});
