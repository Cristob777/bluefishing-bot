const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchStoreApiCatalog, storeApiPrice, decodeEntities } = require("../scripts/sync-catalogo");

function jsonResponse(body, { status = 200, totalPages } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "x-wp-totalpages" && totalPages ? String(totalPages) : null) },
    json: async () => body,
  };
}

const CATEGORIES = [
  { id: 1, name: "Todos los Productos", parent: 0 },
  { id: 2, name: "Cañas", parent: 1 },
  { id: 3, name: "Cañas de Mar", parent: 2 },
];

function product(overrides) {
  return {
    name: "Caña Shimano FX Spinning 2.10m",
    permalink: "https://bluefishing.cl/producto/cana-fx/",
    is_in_stock: true,
    prices: { price: "59990", regular_price: "59990", currency_minor_unit: 0 },
    categories: [{ id: 3, name: "Cañas de Mar" }],
    ...overrides,
  };
}

function fakeFetch(products, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    if (status !== 200) return jsonResponse({ code: "rest_no_route" }, { status });
    const page = Number(url.searchParams.get("page"));
    if (url.pathname.endsWith("/products/categories")) return jsonResponse(page === 1 ? CATEGORIES : []);
    return jsonResponse(page === 1 ? products : []);
  };
  return { impl, calls };
}

test("Store API: no auth header, full category path, out-of-stock excluded", async () => {
  const seenHeaders = [];
  const { impl, calls } = fakeFetch([
    product({}),
    product({ name: "Caña Agotada 1.80m", permalink: "https://bluefishing.cl/producto/agotada/", is_in_stock: false }),
  ]);
  const rows = await fetchStoreApiCatalog({
    baseUrl: "https://bluefishing.cl",
    fetchImpl: async (url, opts) => { seenHeaders.push(opts.headers); return impl(url); },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, "$59.990");
  assert.equal(rows[0].category, "Cañas > Cañas de Mar");
  assert.equal(rows[0].url, "https://bluefishing.cl/producto/cana-fx/");
  assert.ok(calls.every((u) => u.includes("/wp-json/wc/store/v1/")));
  assert.ok(seenHeaders.every((h) => !("Authorization" in h)));
});

test("Store API: HTTP error propagates so the sync falls back to scraping", async () => {
  const { impl } = fakeFetch([], { status: 404 });
  await assert.rejects(fetchStoreApiCatalog({ baseUrl: "https://x.cl", fetchImpl: impl }), /HTTP 404/);
});

test("Store API: products present but none usable is an error, not an empty catalog", async () => {
  const { impl } = fakeFetch([product({ prices: { price: "0", currency_minor_unit: 0 } })]);
  await assert.rejects(fetchStoreApiCatalog({ baseUrl: "https://x.cl", fetchImpl: impl }), /ninguno utilizable/);
});

test("Store API prices honour currency_minor_unit", () => {
  assert.equal(storeApiPrice({ price: "59990", currency_minor_unit: 0 }), "$59.990");
  assert.equal(storeApiPrice({ price: "5999000", currency_minor_unit: 2 }), "$59.990");
  assert.equal(storeApiPrice({ price: "", regular_price: "12990" }), "$12.990");
  assert.equal(storeApiPrice(null), "");
});

test("HTML entities in Store API names are decoded", () => {
  assert.equal(decodeEntities("Caña 2.10m &#8211; Spinning &amp; Jigging"), "Caña 2.10m – Spinning & Jigging");
  assert.equal(decodeEntities("Señuelo &#x27;Popper&#x27;"), "Señuelo 'Popper'");
});
