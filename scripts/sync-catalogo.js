const fs = require("fs");
const path = require("path");
const { detectBrand, detectProductType } = require("../lib/product-taxonomy");

const WC_URL = (process.env.WC_URL || "").replace(/\/+$/, "");
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY || "";
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OUT_PATH = path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt");
const PER_PAGE = 100;

const ALLOWED_CATS = ["Cañas", "Carretes", "Líneas", "Combos", "Señuelos"];

function authHeader() {
  const token = Buffer.from(`${WC_CONSUMER_KEY}:${WC_CONSUMER_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

async function wcFetch(endpoint, params = {}) {
  const url = new URL(`${WC_URL}/wp-json/wc/v3/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) {
    throw new Error(`WooCommerce API ${endpoint} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchAllPages(endpoint, params = {}) {
  const results = [];
  let page = 1;
  while (true) {
    const batch = await wcFetch(endpoint, { ...params, per_page: PER_PAGE, page });
    if (!Array.isArray(batch) || batch.length === 0) break;
    results.push(...batch);
    if (batch.length < PER_PAGE) break;
    page += 1;
  }
  return results;
}

// Product category objects only carry {id, name, slug}. To reproduce
// "Marcas > BADFISH"-style paths we resolve each id against the full
// category list (which includes `parent`) and walk up the chain.
function buildCategoryPathResolver(categories) {
  const byId = new Map(categories.map((cat) => [cat.id, cat]));
  return function resolvePath(id) {
    const chain = [];
    let current = byId.get(id);
    let guard = 0;
    while (current && guard < 10) {
      chain.unshift(current.name);
      current = current.parent ? byId.get(current.parent) : null;
      guard += 1;
    }
    return chain.join(" > ").replace(/^Todos los Productos\s*>\s*/i, "");
  };
}

// Mantiene la tabla `products` de Supabase como espejo exacto del catálogo
// generado: hace upsert de los vigentes y borra los que ya no calzan
// (descontinuados, sin stock, o categoría filtrada) para que /admin nunca
// muestre productos fantasma al equipo.
async function syncToSupabase(rows) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("Supabase no configurado (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) — se omite el sync a la tabla products.");
    return;
  }

  if (rows.length === 0) {
    // Nunca borrar todo por un resultado vacío accidental (hiccup de la API de WooCommerce).
    console.warn("Supabase: 0 productos para sincronizar, se omite por seguridad (no se borra la tabla products).");
    return;
  }

  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { error: upsertError } = await supabase.from("products").upsert(rows, { onConflict: "url" });
  if (upsertError) throw new Error(`Supabase upsert products → ${upsertError.message}`);

  const currentUrls = rows.map((row) => row.url);
  const { error: deleteError } = await supabase
    .from("products")
    .delete()
    .not("url", "in", `(${currentUrls.map((u) => `"${u}"`).join(",")})`);
  if (deleteError) throw new Error(`Supabase delete stale products → ${deleteError.message}`);

  console.log(`Supabase: ${rows.length} productos sincronizados en la tabla products.`);
}

async function main() {
  if (!WC_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
    console.error("Faltan WC_URL, WC_CONSUMER_KEY o WC_CONSUMER_SECRET en el entorno.");
    process.exit(1);
  }

  const categories = await fetchAllPages("products/categories");
  const resolveCategoryPath = buildCategoryPathResolver(categories);
  const products = await fetchAllPages("products", { status: "publish" });

  const lines = [];
  const supabaseRows = [];

  for (const product of products) {
    if (product.stock_status === "outofstock") continue;

    // Product names occasionally contain a literal "|" (e.g. "... | 150g"),
    // which collides with the field delimiter used below and breaks parsing.
    const nombre = (product.name || "").trim().replace(/\|/g, "-");
    const precioRaw = product.regular_price || product.price;
    if (!nombre || !precioRaw) continue;

    const precioStr = `$${Number(precioRaw).toLocaleString("es-CL")}`;
    const catShort = product.categories?.length ? resolveCategoryPath(product.categories[0].id) : "";

    const isAllowed = ALLOWED_CATS.some((c) => catShort.includes(c)) || catShort.includes("Marcas");
    if (!isAllowed) continue;

    const url = product.permalink || "";
    lines.push(`${nombre} | ${precioStr} | ${catShort} | ${url}`);

    if (url) {
      supabaseRows.push({
        url,
        name: nombre,
        price: precioStr,
        category: catShort,
        product_type: detectProductType(nombre, catShort),
        brand: detectBrand(nombre),
        updated_at: new Date().toISOString(),
      });
    }
  }

  const header = `# Catálogo Bluefishing.cl\n# Formato: Nombre | Precio | Categoría | URL\n# Sincronizado automáticamente desde WooCommerce (scripts/sync-catalogo.js)\n\n`;
  fs.writeFileSync(OUT_PATH, header + lines.join("\n"), "utf8");
  console.log(`Listo: ${lines.length} productos → ${OUT_PATH}`);

  await syncToSupabase(supabaseRows);
}

main().catch((error) => {
  console.error("Error sincronizando catálogo:", error.message);
  process.exit(1);
});
