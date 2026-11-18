// Regresión del bug "mal entrenado": el enriquecimiento leía el menú del sitio y marcaba
// todos los productos como mar+río con 4-7 técnicas. Estos tests fallan si vuelve a pasar.
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractProductPage } = require("../lib/productPage");
const { heuristicKnowledge } = require("../lib/knowledgeExtractor");
const { buildProductSource, sourceTextFromRecord } = require("../lib/productSource");
const { qualityReport } = require("../lib/catalogQuality");

const SITE_MENU = `
<nav class="main-navigation"><ul>
  <li><a href="/c/canas-de-mar">Cañas de Mar</a></li>
  <li><a href="/c/canas-de-rio">Cañas de Río</a></li>
  <li><a href="/c/spinning">Spinning</a></li>
  <li><a href="/c/baitcasting">Baitcasting</a></li>
  <li><a href="/c/jigging">Jigging</a></li>
  <li><a href="/c/trolling">Trolling</a></li>
  <li><a href="/c/lago">Pesca en Lago</a></li>
</ul></nav>`;

const PRODUCT_HTML = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"APIA Metal vib Uprizing 59 12 g","offers":{"price":"18990","priceCurrency":"CLP","availability":"https://schema.org/InStock"}}</script>
</head><body>${SITE_MENU}
<h1 class="product_title">APIA Metal vib Uprizing 59 12 g</h1>
<div class="woocommerce-product-details__short-description"><p>Vibración metálica para <strong>lenguado</strong> desde playa.</p></div>
<div class="product_meta"><span class="posted_in">Categorías: <a href="#">Señuelos</a>, <a href="#">Señuelos de Mar</a></span></div>
<div id="tab-description"><div class="inner"><p>Ideal para spinning en la rompiente.</p></div><p>Peso 12 g.</p></div>
<table class="woocommerce-product-attributes shop_attributes"><tr><th>Peso</th><td><p>12 g</p></td></tr></table>
<footer>${SITE_MENU}<p>Todas las marcas</p></footer>
</body></html>`;

test("la ficha HTML ignora el menú y el footer del sitio", () => {
  const page = extractProductPage(PRODUCT_HTML, "https://bluefishing.cl/producto/apia/");
  assert.doesNotMatch(page.sourceText, /Cañas de Río|Trolling|Baitcasting|Pesca en Lago/);
  assert.match(page.sourceText, /CATEGORIAS: Señuelos ; Señuelos de Mar/);
  assert.match(page.sourceText, /spinning en la rompiente/);
  assert.match(page.sourceText, /Peso 12 g/, "lee la descripción completa aunque tenga divs anidados");
  assert.match(page.sourceText, /Peso: 12 g/, "lee la tabla de atributos");
});

test("un señuelo de mar queda solo en mar y con su técnica real", () => {
  const page = extractProductPage(PRODUCT_HTML);
  const k = heuristicKnowledge({ name: page.name, category: page.category, productType: "señuelo", sourceText: page.sourceText });
  assert.deepEqual(k.water_type, ["mar"]);
  assert.deepEqual(k.technique, ["spinning"]);
  assert.ok(k.target_species.includes("lenguado"));
  assert.equal(k.needs_review, false);
});

test("'marca' o 'marcas' no se interpretan como mar", () => {
  const k = heuristicKnowledge({
    name: "Anzuelo Circle 4/0",
    category: "Anzuelos",
    productType: "anzuelo",
    sourceText: "DESCRIPCION:\nAnzuelo de acero de la marca VARIVAS. Primera marca japonesa.",
  });
  assert.deepEqual(k.water_type, []);
});

test("producto listado en mar y río queda marcado para revisión humana", () => {
  const k = heuristicKnowledge({
    name: "Caña Spinning 2.10 m",
    category: "Cañas > Cañas de Mar ; Cañas > Cañas de Río",
    productType: "caña",
    sourceText: "",
  });
  assert.deepEqual(k.water_type.sort(), ["mar", "río"]);
  assert.equal(k.needs_review, true);
  assert.ok(k.confidence <= 0.4);
});

test("la categoría manda sobre una mención secundaria en la descripción", () => {
  const k = heuristicKnowledge({
    name: "Carrete 4000",
    category: "Carretes > Carretes de Mar",
    productType: "carrete",
    sourceText: "DESCRIPCION:\nResistente al agua salada. También lo usan algunos en río.",
  });
  assert.deepEqual(k.water_type, ["mar"]);
});

test("Store API y REST v3 producen la misma ficha limpia", () => {
  const storeApi = buildProductSource({
    name: "Caña &amp; Test",
    permalink: "https://bluefishing.cl/producto/x/",
    categories: [{ id: 1, name: "Cañas de Mar" }],
    tags: [{ name: "Shore" }],
    attributes: [{ name: "Largo", terms: [{ name: "2,70 m" }] }],
    description: "<p>Para corvina desde roca.</p>",
    short_description: "",
  });
  const rest = buildProductSource({
    name: "Caña & Test",
    permalink: "https://bluefishing.cl/producto/x/",
    categories: [{ id: 1, name: "Cañas de Mar" }],
    tags: [{ name: "Shore" }],
    attributes: [{ name: "Largo", options: ["2,70 m"] }],
    description: "<p>Para corvina desde roca.</p>",
    short_description: "",
  });
  assert.deepEqual(storeApi, rest);
  const text = sourceTextFromRecord(storeApi);
  assert.match(text, /CATEGORIAS: Cañas de Mar/);
  assert.match(text, /Largo: 2,70 m/);
});

test("la compuerta de calidad rechaza un catálogo contaminado y acepta uno sano", () => {
  const contaminated = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`u${i}`, { water_type: ["mar", "río"], technique: ["spinning", "baitcasting", "jigging", "trolling"] }])
  );
  const bad = qualityReport(contaminated);
  assert.equal(bad.ok, false);
  assert.equal(bad.failures.length, 2);

  const healthy = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`u${i}`, { water_type: i % 10 === 0 ? ["mar", "río"] : ["mar"], technique: ["spinning"] }])
  );
  assert.equal(qualityReport(healthy).ok, true);
});

test("la 'm' de metros no se lee como potencia de la caña", () => {
  const meters = heuristicKnowledge({ name: "Caña Shore 2,90 m", category: "Cañas", productType: "caña" });
  assert.equal(meters.extra.power, undefined);
  assert.equal(meters.extra.length, "2.90m");
  const code = heuristicKnowledge({ name: "Caña 702MH 2.13 m", category: "Cañas", productType: "caña" });
  assert.equal(code.extra.power, "MH");
});
