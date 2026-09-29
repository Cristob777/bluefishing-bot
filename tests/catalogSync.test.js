const test = require("node:test");
const assert = require("node:assert/strict");
const { formatPrice, extractProductLinks } = require("../scripts/sync-catalogo");

test("formatPrice formats CLP", () => {
  assert.equal(formatPrice("109990"), "$109.990");
});

test("extractProductLinks deduplicates BlueFishing product links", () => {
  const html = `
    <a href="https://bluefishing.cl/producto/a/">A</a>
    <a href="https://bluefishing.cl/producto/a/?x=1">A2</a>
    <a href="https://bluefishing.cl/producto/b">B</a>
  `;
  const links = extractProductLinks(html).sort();
  assert.deepEqual(links, [
    "https://bluefishing.cl/producto/a/",
    "https://bluefishing.cl/producto/b/"
  ]);
});
