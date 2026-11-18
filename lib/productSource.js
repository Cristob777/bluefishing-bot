// Ficha "limpia" de un producto, construida SOLO con datos del producto que entrega
// WooCommerce (REST v3 o Store API): nombre, categorías, etiquetas, atributos y descripciones.
//
// Por qué existe: antes el enriquecimiento leía la página HTML completa, incluido el menú
// del sitio ("Cañas de Mar", "Cañas de Río", "Spinning", "Trolling"...). Resultado: todos los
// productos quedaban marcados mar+río y con 4-7 técnicas. Esta ficha nunca incluye navegación.

const { createHash } = require("node:crypto");
const { stripHtml, decodeHtml } = require("./productPage");

const MAX_DESCRIPTION_CHARS = 6000;

function clean(text) {
  return decodeHtml(String(text || "")).replace(/\s+/g, " ").trim();
}

function uniq(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

// WC REST v3: attributes = [{ name, options: [] }]
// Store API:  attributes = [{ name, terms: [{ name }] }]
function normalizeAttributes(attributes) {
  const out = {};
  for (const attr of attributes || []) {
    const name = clean(attr?.name);
    if (!name) continue;
    const values = Array.isArray(attr.options)
      ? attr.options
      : (attr.terms || []).map((term) => term?.name);
    const list = uniq(values || []);
    if (list.length) out[name] = list;
  }
  return out;
}

function buildProductSource(product, { resolveCategoryPath } = {}) {
  const categories = uniq(
    (product.categories || []).map((cat) =>
      (resolveCategoryPath && resolveCategoryPath(cat.id)) || cat.name
    )
  );
  const description = stripHtml(product.description || "").slice(0, MAX_DESCRIPTION_CHARS);
  const shortDescription = stripHtml(product.short_description || "").slice(0, 2000);

  return {
    url: product.permalink || "",
    name: clean(product.name),
    sku: clean(product.sku),
    categories,
    tags: uniq((product.tags || []).map((tag) => tag?.name)),
    attributes: normalizeAttributes(product.attributes),
    short_description: shortDescription,
    description,
  };
}

function sourceTextFromRecord(record) {
  const attributes = Object.entries(record.attributes || {})
    .map(([name, values]) => `${name}: ${values.join(", ")}`)
    .join("\n");
  return [
    record.name ? `NOMBRE: ${record.name}` : "",
    record.sku ? `SKU: ${record.sku}` : "",
    record.categories?.length ? `CATEGORIAS: ${record.categories.join(" ; ")}` : "",
    record.tags?.length ? `ETIQUETAS: ${record.tags.join(", ")}` : "",
    attributes ? `ATRIBUTOS:\n${attributes}` : "",
    record.short_description ? `RESUMEN:\n${record.short_description}` : "",
    record.description ? `DESCRIPCION:\n${record.description}` : "",
  ].filter(Boolean).join("\n\n");
}

function hashSourceText(sourceText) {
  return createHash("sha256").update(String(sourceText || "")).digest("hex");
}

module.exports = {
  buildProductSource,
  normalizeAttributes,
  sourceTextFromRecord,
  hashSourceText,
};
