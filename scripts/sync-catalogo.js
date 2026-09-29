const fs = require("node:fs");
const path = require("node:path");
const { detectBrand, detectProductType } = require("../lib/product-taxonomy");
const { fetchProductPage } = require("../lib/productPage");

const WC_URL = (process.env.WC_URL || "https://bluefishing.cl").replace(/\/+$/, "");
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY || "";
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OUT_PATH = path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt");
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

function authHeader() {
  return "Basic " + Buffer.from(WC_CONSUMER_KEY + ":" + WC_CONSUMER_SECRET).toString("base64");
}

async function wcFetch(endpoint, params) {
  const url = new URL(WC_URL + "/wp-json/wc/v3/" + endpoint);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!response.ok) throw new Error("WooCommerce API " + endpoint + ": HTTP " + response.status);
  return response.json();
}

async function fetchAllPages(endpoint, params) {
  const results = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await wcFetch(endpoint, { ...(params || {}), per_page: PER_PAGE, page });
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

async function fetchWooCatalog() {
  if (!WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) throw new Error("credenciales WooCommerce no configuradas");
  const [categories, products] = await Promise.all([
    fetchAllPages("products/categories"),
    fetchAllPages("products", { status: "publish" })
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
    rows = await fetchWooCatalog();
    source = "woocommerce_api";
  } catch (error) {
    console.warn("[Catalog] WooCommerce API no disponible: " + error.message);
    rows = await fetchPublicCatalog();
    source = "public_store";
  }

  const unique = [...new Map(rows.map((row) => [row.url, row])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  if (!unique.length) throw new Error("el sync produjo 0 productos; se conserva el catálogo anterior");

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
  main().catch((error) => {
    console.error("[Catalog] Fatal:", error.message);
    process.exit(1);
  });
}

module.exports = { formatPrice, extractProductLinks, fetchWooCatalog, fetchPublicCatalog };
