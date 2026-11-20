// Bsale: fuente de verdad del STOCK (se descuenta con cada venta web y presencial).
// La web (WooCommerce) sigue mandando en qué se ofrece, precio y link; Bsale solo responde
// "¿cuántas unidades hay ahora?". Cruce por SKU: SKU de WooCommerce = código de variante en Bsale.
//
// Diseño fail-safe: si Bsale no responde o el producto no tiene SKU, el stock queda
// "sin_verificar" y Matías NO lo afirma (contrato: stock_claims_require_explicit_live_stock_evidence).
// Solo se ocultan productos con stock confirmado en 0.
const fs = require("node:fs");
const { readPath } = require("./catalogPaths");
const { safeError } = require("./logSanitizer");

const DEFAULT_API_URL = "https://api.bsale.io/v1";

function config(env = process.env) {
  const token = String(env.BSALE_ACCESS_TOKEN || "").trim();
  const offices = String(env.BSALE_OFFICE_IDS || "")
    .split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  const num = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
  return {
    enabled: Boolean(token) && !/^CHANGE_ME/.test(token),
    token,
    apiUrl: String(env.BSALE_API_URL || DEFAULT_API_URL).replace(/\/+$/, ""),
    offices: new Set(offices),
    cacheMs: num(env.BSALE_STOCK_CACHE_SECONDS, 120, 0, 3600) * 1000,
    timeoutMs: num(env.BSALE_TIMEOUT_MS, 3000, 500, 20000),
  };
}

const isEnabled = (env = process.env) => config(env).enabled;

async function bsaleGet(pathAndQuery, { cfg = config(), fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(cfg.apiUrl + pathAndQuery, {
      headers: { access_token: cfg.token, Accept: "application/json" },
      signal: controller.signal,
      redirect: "error",
    });
    if (!res.ok) throw new Error("bsale_http_" + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Stock en vivo ----------

const stockCache = new Map(); // sku -> { value, exp }
// Circuit breaker: si Bsale falla, no se consulta por BREAKER_MS. Así una caída de Bsale no suma
// timeouts en cadena a cada respuesta de WhatsApp: Matías sigue vendiendo sin afirmar stock.
const BREAKER_MS = 30000;
let downUntil = 0;

function clearStockCache() { stockCache.clear(); downUntil = 0; }

// { sku, status: in_stock | out_of_stock | not_found | unknown, available }
async function getStockBySku(sku, { cfg = config(), fetchImpl = fetch, now = Date.now } = {}) {
  const code = String(sku || "").trim();
  if (!code) return { sku: code, status: "unknown", available: null, reason: "sin_sku" };
  if (!cfg.enabled) return { sku: code, status: "unknown", available: null, reason: "bsale_off" };

  const hit = stockCache.get(code);
  if (hit && hit.exp > now()) return hit.value;
  if (downUntil > now()) return { sku: code, status: "unknown", available: null, reason: "bsale_down" };

  let value;
  try {
    const data = await bsaleGet(`/stocks.json?code=${encodeURIComponent(code)}&limit=50`, { cfg, fetchImpl });
    const items = Array.isArray(data?.items) ? data.items : [];
    const scoped = cfg.offices.size ? items.filter((it) => cfg.offices.has(String(it?.office?.id ?? ""))) : items;
    if (!scoped.length) {
      value = { sku: code, status: "not_found", available: null };
    } else {
      const available = scoped.reduce((sum, it) => sum + Math.max(0, Number(it?.quantityAvailable) || 0), 0);
      value = { sku: code, status: available > 0 ? "in_stock" : "out_of_stock", available: Math.floor(available) };
    }
    stockCache.set(code, { value, exp: now() + cfg.cacheMs });
  } catch (error) {
    console.warn("[Bsale] stock no disponible:", safeError(error));
    value = { sku: code, status: "unknown", available: null, reason: "bsale_error" };
    downUntil = now() + BREAKER_MS;
  }
  return value;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

// ---------- SKU por producto (desde product_source.json del sync de catálogo) ----------

const normUrl = (u) => String(u || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
let skuCache = { key: null, map: new Map() };

function loadSkuMap() {
  const file = readPath("product_source.json");
  let key;
  try { const st = fs.statSync(file); key = file + ":" + st.mtimeMs; } catch { return new Map(); }
  if (skuCache.key === key) return skuCache.map;
  const map = new Map();
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [url, rec] of Object.entries(data || {})) {
      const sku = String(rec?.sku || "").trim();
      if (sku) map.set(normUrl(rec?.url || url), sku);
    }
  } catch (error) {
    console.warn("[Bsale] product_source.json ilegible:", safeError(error));
  }
  skuCache = { key, map };
  return map;
}

// Anota product.stock y quita SOLO los productos con stock confirmado en 0.
// Sin Bsale configurado devuelve los productos tal cual (comportamiento anterior).
async function applyLiveStock(products, { cfg = config(), fetchImpl = fetch, skuMap = null, concurrency = 4 } = {}) {
  if (!cfg.enabled || !Array.isArray(products) || !products.length) return products;
  const skus = skuMap || loadSkuMap();
  const annotated = await mapLimit(products, concurrency, async (p) => {
    const sku = p.sku || skus.get(normUrl(p.url)) || "";
    const stock = await getStockBySku(sku, { cfg, fetchImpl });
    return { ...p, sku: sku || null, stock };
  });
  return annotated.filter((p) => p.stock.status !== "out_of_stock");
}

// Etiqueta para el prompt: el modelo solo puede afirmar stock con "stock=N".
function stockLabel(product) {
  const s = product?.stock;
  if (!s) return null;
  return s.status === "in_stock" ? "stock=" + s.available : "stock=sin_verificar";
}

module.exports = {
  config,
  isEnabled,
  bsaleGet,
  getStockBySku,
  applyLiveStock,
  loadSkuMap,
  stockLabel,
  clearStockCache,
  normUrl,
  mapLimit,
};
