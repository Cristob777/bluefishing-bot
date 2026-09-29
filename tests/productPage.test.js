const test = require("node:test");
const assert = require("node:assert/strict");
const { extractProductPage, stripHtml } = require("../lib/productPage");

test("stripHtml removes tags and decodes entities", () => {
  assert.equal(stripHtml("<p>Caña &amp; Reel<br>10-30g</p>"), "Caña & Reel\n10-30g");
});

test("extractProductPage reads JSON-LD product data", () => {
  const html = `
  <html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"Caña Test 10-30g","sku":"SKU-1",
     "brand":{"@type":"Brand","name":"TEST"},
     "category":"Cañas",
     "description":"Para spinning de costa.",
     "offers":{"@type":"Offer","price":"99990","priceCurrency":"CLP","availability":"https://schema.org/InStock"}}
    </script>
  </head><body><h1 class="product_title">Fallback</h1></body></html>`;
  const p = extractProductPage(html, "https://bluefishing.cl/producto/test/");
  assert.equal(p.name, "Caña Test 10-30g");
  assert.equal(p.brand, "TEST");
  assert.equal(p.priceRaw, "99990");
  assert.equal(p.availability, "InStock");
  assert.match(p.sourceText, /spinning de costa/i);
  assert.equal(p.sourceHash.length, 64);
});
