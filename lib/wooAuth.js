// WooCommerce "wc-auth" (https://woocommerce.github.io/woocommerce-rest-api-docs/#rest-api-keys).
// Solo para pruebas locales: permite http://127.0.0.1 si NO es producción.
function allowLocalTestStore(u) {
  return process.env.NODE_ENV !== "production" && ["1", "true"].includes(String(process.env.WOO_ALLOW_LOCAL_TEST_STORE || "")) &&
    u.protocol === "http:" && u.hostname === "127.0.0.1";
}

function normalizeStoreUrl(input) {
  let u;
  try { u = new URL(String(input || "").trim()); } catch { return null; }
  if (allowLocalTestStore(u)) return `http://${u.host}${u.pathname.replace(/\/+$/, "")}`;
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || /^(\d+\.){3}\d+$/.test(host) || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return null;
  return `https://${u.host}${u.pathname.replace(/\/+$/, "")}`;
}

function buildAuthorizeUrl({ storeUrl, state, publicBaseUrl, appName = "BlueFishing Bot" }) {
  const u = new URL(`${storeUrl}/wc-auth/v1/authorize`);
  u.searchParams.set("app_name", appName);
  u.searchParams.set("scope", "read");
  u.searchParams.set("user_id", state);
  u.searchParams.set("return_url", `${publicBaseUrl}/panel?woo=return`);
  u.searchParams.set("callback_url", `${publicBaseUrl}/panel/woo/callback`);
  return u.toString();
}

// Comprueba que las claves recibidas funcionan (lectura) contra la tienda.
async function verifyKeys({ storeUrl, consumerKey, consumerSecret }, { fetchImpl = fetch } = {}) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await fetchImpl(`${storeUrl}/wp-json/wc/v3/products?per_page=1&_fields=id`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    redirect: "error",
  });
  return res.ok;
}

module.exports = { normalizeStoreUrl, buildAuthorizeUrl, verifyKeys };
