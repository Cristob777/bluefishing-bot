const { createHash } = require("node:crypto");

function decodeHtml(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(html = "") {
  return decodeHtml(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>|<\/li>|<\/tr>|<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function flattenJsonLd(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
    return out;
  }
  if (typeof value !== "object") return out;

  out.push(value);
  if (Array.isArray(value["@graph"])) {
    for (const item of value["@graph"]) flattenJsonLd(item, out);
  }
  return out;
}

function extractJsonLd(html = "") {
  const nodes = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html).matchAll(re)) {
    const raw = decodeHtml(match[1].trim());
    if (!raw) continue;
    try {
      flattenJsonLd(JSON.parse(raw), nodes);
    } catch {
      // Hay plugins de WordPress que generan JSON-LD inválido; se ignora ese bloque.
    }
  }
  return nodes;
}

function hasType(node, type) {
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return types.filter(Boolean).some((t) => String(t).toLowerCase() === type.toLowerCase());
}

function firstOffer(offers) {
  if (Array.isArray(offers)) return offers[0] || {};
  return offers && typeof offers === "object" ? offers : {};
}

function pickMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["'][^>]*>`, "i"),
  ];
  for (const re of patterns) {
    const match = String(html).match(re);
    if (match) return decodeHtml(match[1]).trim();
  }
  return "";
}

function extractProductPage(html, url = "") {
  const nodes = extractJsonLd(html);
  const product = nodes.find((node) => hasType(node, "Product")) || {};
  const offer = firstOffer(product.offers);

  const titleFallback =
    String(html).match(/<h1\b[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    pickMeta(html, "og:title");

  const shortDescription =
    String(html).match(/<div\b[^>]*class=["'][^"']*woocommerce-product-details__short-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    "";

  const mainDescription =
    String(html).match(/<div\b[^>]*id=["']tab-description["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    "";

  const breadcrumb =
    String(html).match(/<nav\b[^>]*class=["'][^"']*woocommerce-breadcrumb[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] ||
    "";

  const brand =
    typeof product.brand === "string"
      ? product.brand
      : product.brand?.name || "";

  const name = decodeHtml(product.name || stripHtml(titleFallback || "")).trim();
  const description = stripHtml(
    [product.description || "", shortDescription, mainDescription].filter(Boolean).join("\n")
  );
  const category = decodeHtml(product.category || stripHtml(breadcrumb)).trim();
  const priceRaw = offer.price ?? product.offers?.lowPrice ?? "";
  const priceCurrency = offer.priceCurrency || "CLP";
  const availability = String(offer.availability || "").split("/").pop() || "";
  const sku = String(product.sku || "").trim();
  const visibleText = stripHtml(html).slice(0, 16000);

  const sourceText = [
    name ? `NOMBRE: ${name}` : "",
    brand ? `MARCA: ${brand}` : "",
    category ? `CATEGORIA: ${category}` : "",
    sku ? `SKU: ${sku}` : "",
    priceRaw ? `PRECIO: ${priceRaw} ${priceCurrency}` : "",
    availability ? `DISPONIBILIDAD: ${availability}` : "",
    description ? `DESCRIPCION:\n${description}` : "",
    visibleText ? `TEXTO_DE_FICHA:\n${visibleText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 24000);

  return {
    url,
    name,
    brand,
    category,
    sku,
    priceRaw: String(priceRaw || ""),
    priceCurrency,
    availability,
    description,
    sourceText,
    sourceHash: createHash("sha256").update(sourceText).digest("hex"),
  };
}

async function fetchProductPage(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "BlueFishingCatalogBot/1.0 (+https://bluefishing.cl)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al leer ${url}`);
    }
    const html = await response.text();
    return extractProductPage(html, url);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  decodeHtml,
  stripHtml,
  extractJsonLd,
  extractProductPage,
  fetchProductPage,
};
