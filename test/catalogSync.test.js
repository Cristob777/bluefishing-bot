const test = require("node:test");
const assert = require("node:assert/strict");
const { formatPrice, extractProductLinks } = require("../scripts/sync-catalogo");

test("formatPrice uses CLP formatting", () => {
  assert.equal(formatPrice("129990"), "$129.990");
  assert.equal(formatPrice(""), "");
});

test("extractProductLinks deduplicates BlueFishing products", () => {
  const html = [
    '<a href="https://bluefishing.cl/producto/uno/">Uno</a>',
    '<a href="https://bluefishing.cl/producto/uno/?x=1">Uno otra vez</a>',
    '<a href="https://bluefishing.cl/producto/dos/">Dos</a>'
  ].join("");
  assert.deepEqual(extractProductLinks(html).sort(), [
    "https://bluefishing.cl/producto/dos/",
    "https://bluefishing.cl/producto/uno/"
  ]);
});
