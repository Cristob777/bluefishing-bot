const test = require("node:test");
const assert = require("node:assert/strict");
const { extractProductPage } = require("../lib/productPage");

test("extractProductPage reads WooCommerce JSON-LD", () => {
  const html = [
    "<html><head>",
    '<script type="application/ld+json">',
    JSON.stringify({
      "@type": "Product",
      name: "CAÑA TEST 10-50g",
      sku: "ABC123",
      brand: { "@type": "Brand", name: "TEST" },
      category: "Cañas de mar",
      description: "Para spinning desde costa.",
      offers: {
        "@type": "Offer",
        price: "129990",
        priceCurrency: "CLP",
        availability: "https://schema.org/InStock"
      }
    }),
    "</script>",
    "</head><body></body></html>"
  ].join("");

  const result = extractProductPage(html, "https://bluefishing.cl/producto/test/");
  assert.equal(result.name, "CAÑA TEST 10-50g");
  assert.equal(result.brand, "TEST");
  assert.equal(result.priceRaw, "129990");
  assert.equal(result.availability, "InStock");
  assert.match(result.sourceText, /spinning desde costa/i);
  assert.equal(result.sourceHash.length, 64);
});
