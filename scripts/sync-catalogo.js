const fs = require("node:fs");
const path = require("node:path");
const { detectBrand, detectProductType } = require("../lib/product-taxonomy");
const { fetchProductPage } = require("../lib/productPage");

const { resolveFromRuntime } = require("../lib/catalogCredentials");

const WC_URL = (process.env.WC_URL || "https://bluefishing.cl").replace(/\/+$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const { readPath, writePath } = require("../lib/catalogPaths");
const OUT_PATH = writePath("catalogo_para_bot.txt");
const LAST_GOOD_PATH = readPath("catalogo_para_bot.txt");
const PER_PAGE = 100;
const ALLOWED_TYPES = new Set(["caña", "carrete", "línea", "señuelo", "anzuelo", "combo"]);

const PUBLIC_CATEGORIES = [
  ["Cañas", "/categoria-producto/todos-los-productos/canas/"],
  ["Carretes", "/categoria-producto/todos-los-productos/carretes/"],
  ["Líneas", "/categoria-producto/todos-los-productos/lineas/"],
  ["Señuelos", "/categoria-producto/todos-los-productos/senuelos/"],
  ["Anzuelos", "/categoria-producto/todos-los-productos/anzuelos/"],
  ["Combos de Pesca", "/categoria-producto/todos-los-productos/combos-de-pesca/"]
];

function authHeader(creds) {
  return "Basic " + Buffer.from(creds.consumerKey + ":" + creds.consumerSecret).toString("base64");
}

async function wcFetch(creds, endpoint, params) {
  const url = new URL(creds.storeUrl + "/wp-json/wc/v3/" + endpoint);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: authHeader(creds) } });
  if (!response.ok) throw new Error("WooCommerce API " + endpoint + ": HTTP " + response.status);
  return response.json();
}

async function fetchAllPages(creds, endpoint, params) {
  const results = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await wcFetch(creds, endpoint, { ...(params || {}), per_page: PER_PAGE, page });
    if (!Array.isArray(batch) || !batch.length) break;
    results.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return results;
}

function buildCategoryPathResolver(categories) {
  const byId = new Map(categories.map((cat) => [cat.id, cat]));
  return function resolvePath(id) {
    const chain = [];
    let current = byId.get(id);
    for (let guard = 0; current && guard < 10; guard += 1) {
      chain.unshift(current.name);
      current = current.parent ? byId.get(current.parent) : null;
    }
    return chain.join(" > ").replace(/^Todos los Productos\s*>\s*/i, "");
  };
}

function formatPrice(value) {
  const numeric = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0
    ? "$" + Math.round(numeric).toLocaleString("es-CL")
    : "";
}

function chooseRelevantCategory(product, resolveCategoryPath) {
  const paths = (product.categories || []).map((cat) => resolveCategoryPath(cat.id)).filter(Boolean);
  for (const category of paths) {
    if (ALLOWED_TYPES.has(detectProductType(product.name || "", category))) return category;
  }
  return paths[0] || "";
}

async function fetchWooCatalog(creds) {
  if (!creds) throw new Error("credenciales WooCommerce no configuradas (ni .env ni tienda conectada en /panel)");
  const [categories, products] = await Promise.all([
    fetchAllPages(creds, "products/categories"),
    fetchAllPages(creds, "products", { status: "publish" })
  ]);
  const resolveCategoryPath = buildCategoryPathResolver(categories);
  const rows = [];
  for (const product of products) {
    if (product.stock_status === "outofstock") continue;
    const name = String(product.name || "").trim().replace(/\|/g, "-");
    const category = chooseRelevantCategory(product, resolveCategoryPath);
    const productType = detectProductType(name, category);
    if (!name || !ALLOWED_TYPES.has(productType)) continue;
    const price = formatPrice(product.price || product.regular_price);
    const url = product.permalink || "";
    if (!price || !url) continue;
    rows.push({
      url,
      name,
      price,
      category,
      product_type: productType,
      brand: detectBrand(name),
      updated_at: new Date().toISOString()
    });
  }
  return rows;
}

// Store API pública de WooCommerce (/wp-json/wc/store/v1): la misma que usa el carrito/bloques
// del sitio. No requiere claves; trae 100 productos por request con precio, stock y categorías.
// Si la tienda no la expone (WooCommerce antiguo o bloqueada), se cae al scraping.
async function storeApiFetchAllPages(baseUrl, endpoint, params, fetchImpl) {
  const results = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(baseUrl + "/wp-json/wc/store/v1/" + endpoint);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "BlueFishingCatalogBot/1.0 (+https://bluefishing.cl)" }
    });
    if (!response.ok) throw new Error("Store API " + endpoint + ": HTTP " + response.status);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("Store API " + endpoint + ": respuesta no es una lista");
    if (!batch.length) break;
    results.push(...batch);
    const totalPages = Number(response.headers?.get?.("x-wp-totalpages") || 0);
    if (batch.length < PER_PAGE || (totalPages && page >= totalPages)) break;
  }
  return results;
}

// Precios de la Store API vienen en unidades menores (CLP suele tener minor_unit 0).
function storeApiPrice(prices) {
  if (!prices) return "";
  const raw = Number(prices.price || prices.regular_price || 0);
  const minor = Number.isInteger(prices.currency_minor_unit) ? prices.currency_minor_unit : 0;
  return formatPrice(raw / Math.pow(10, minor));
}

async function fetchStoreApiCatalog({ baseUrl = WC_URL, fetchImpl = fetch } = {}) {
  const [categories, products] = await Promise.all([
    storeApiFetchAllPages(baseUrl, "products/categories", {}, fetchImpl),
    storeApiFetchAllPages(baseUrl, "products", {}, fetchImpl)
  ]);
  const resolveCategoryPath = buildCategoryPathResolver(categories);
  const rows = [];
  for (const product of products) {
    if (product.is_in_stock === false) continue;
    const name = decodeEntities(String(product.name || "")).trim().replace(/\|/g, "-");
    const category = chooseRelevantCategory(product, resolveCategoryPath);
    const productType = detectProductType(name, category);
    if (!name || !ALLOWED_TYPES.has(productType)) continue;
    const price = storeApiPrice(product.prices);
    const url = product.permalink || "";
    if (!price || !url) continue;
    rows.push({ url, name, price, category, product_type: productType, brand: detectBrand(name), updated_at: new Date().toISOString() });
  }
  if (products.length && !rows.length) throw new Error("Store API devolvió productos pero ninguno utilizable");
  return rows;
}

// La Store API devuelve nombres con entidades HTML (&#8211;, &amp;...).
function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractProductLinks(html) {
  const urls = new Set();
  const re = /href=["']([^"']*\/producto\/[^"'?#]+\/?)(?:[?#][^"']*)?["']/gi;
  for (const match of String(html).matchAll(re)) {
    try {
      const resolved = new URL(match[1], WC_URL);
      if (resolved.hostname !== "bluefishing.cl" && resolved.hostname !== "www.bluefishing.cl") continue;
      const clean = (resolved.origin + resolved.pathname).replace(/\/$/, "") + "/";
      urls.add(clean);
    } catch {
      // Ignore malformed links emitted by third-party WordPress plugins.
    }
  }
  return [...urls];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "BlueFishingCatalogBot/1.0 (+https://bluefishing.cl)",
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error("HTTP " + response.status + ": " + url);
  return response.text();
}

async function discoverPublicProducts() {
  const discovered = new Map();
  for (const [category, pathname] of PUBLIC_CATEGORIES) {
    let stalePages = 0;
    for (let page = 1; page <= 30; page += 1) {
      const url = new URL(pathname, WC_URL);
      if (page > 1) url.searchParams.set("product-page", String(page));
      let html;
      try {
        html = await fetchText(url.toString());
      } catch (error) {
        if (page === 1) console.warn("[Catalog] " + category + ": " + error.message);
        break;
      }
      const links = extractProductLinks(html);
      const before = discovered.size;
      for (const productUrl of links) if (!discovered.has(productUrl)) discovered.set(productUrl, category);
      stalePages = (!links.length || discovered.size === before) ? stalePages + 1 : 0;
      if (stalePages >= 2) break;
    }
  }
  return discovered;
}

async function mapWithConcurrency(entries, concurrency, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < entries.length) {
      const current = entries[index];
      index += 1;
      const result = await fn(current);
      if (result) results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return results;
}

async function fetchPublicCatalog() {
  const discovered = await discoverPublicProducts();
  if (!discovered.size) throw new Error("no se encontraron productos en las categorías públicas");
  return mapWithConcurrency([...discovered.entries()], 6, async ([url, fallbackCategory]) => {
    try {
      const page = await fetchProductPage(url);
      if (/outofstock/i.test(page.availability)) return null;
      const name = String(page.name || "").trim().replace(/\|/g, "-");
      const category = page.category || fallbackCategory;
      const productType = detectProductType(name, category);
      if (!name || !ALLOWED_TYPES.has(productType)) return null;
      const price = formatPrice(page.priceRaw);
      if (!price) return null;
      return {
        url,
        name,
        price,
        category,
        product_type: productType,
        brand: page.brand || detectBrand(name),
        updated_at: new Date().toISOString()
      };
    } catch (error) {
      console.warn("[Catalog] Ficha omitida " + url + ": " + error.message);
      return null;
    }
  });
}

async function syncToSupabase(rows) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !rows.length) return;
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { error } = await supabase.from("products").upsert(rows, { onConflict: "url" });
  if (error) throw new Error("Supabase products upsert: " + error.message);
}

async function main() {
  let rows;
  let source;
  try {
    const creds = await resolveFromRuntime();
    rows = await fetchWooCatalog(creds);
    source = creds.source === "panel" ? "woocommerce_api_panel" : "woocommerce_api";
  } catch (error) {
    console.warn("[Catalog] WooCommerce API no disponible: " + error.message);
    try {
      rows = await fetchStoreApiCatalog();
      source = "woocommerce_store_api";
    } catch (storeError) {
      console.warn("[Catalog] Store API pública no disponible: " + storeError.message);
      rows = await fetchPublicCatalog();
      source = "public_store";
    }
  }

  const unique = [...new Map(rows.map((row) => [row.url, row])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  if (!unique.length) {
    if (fs.existsSync(LAST_GOOD_PATH) && fs.readFileSync(LAST_GOOD_PATH, "utf8").trim()) {
      console.warn("[Catalog] El refresh remoto produjo 0 productos. Se conserva el último catálogo válido.");
      console.log(JSON.stringify({ source: "preserved_last_known_good", products: 0, output: OUT_PATH }));
      return;
    }
    throw new Error("el sync produjo 0 productos y no existe un catálogo previo válido");
  }

  const header = [
    "# Catálogo Bluefishing.cl",
    "# Formato: Nombre | Precio | Categoría | URL",
    "# Fuente automática: " + source,
    "# Actualizado: " + new Date().toISOString(),
    ""
  ].join("\n");

  const lines = unique.map((row) => row.name + " | " + row.price + " | " + row.category + " | " + row.url);
  fs.writeFileSync(OUT_PATH, header + lines.join("\n") + "\n", "utf8");

  try {
    await syncToSupabase(unique);
  } catch (error) {
    console.warn("[Catalog] Supabase no disponible; catálogo versionado igualmente: " + error.message);
  }

  console.log(JSON.stringify({ source, products: unique.length, output: OUT_PATH }));
}

if (require.main === module) {
  // exit explícito: el pool de Postgres (si se usó para credenciales) mantendría vivo el proceso.
  main().then(() => process.exit(0)).catch((error) => {
    console.error("[Catalog] Fatal:", error.message);
    process.exit(1);
  });
}

module.exports = { formatPrice, extractProductLinks, fetchWooCatalog, fetchPublicCatalog, fetchStoreApiCatalog, storeApiPrice, decodeEntities };
