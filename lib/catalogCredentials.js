// Credenciales WooCommerce para el sync de catálogo.
//
// Orden de resolución:
//   1. WC_CONSUMER_KEY / WC_CONSUMER_SECRET del .env (operador, como antes).
//   2. Una tienda conectada con el botón "Conectar tienda" de /panel (flujo wc-auth,
//      solo lectura). Así el dueño aprueba con un clic y nadie copia ni pega claves.
//      - Si WOO_CATALOG_TENANT_ID está definido, se usa esa empresa.
//      - Si no, se usa la única empresa con tienda conectada.
//      - Si hay más de una y no se eligió, se aborta: el catálogo del bot todavía es
//        global (un solo catálogo para todos), y mezclar tiendas sería peor que no
//        sincronizar.
//   3. null → el sync cae al scraping de la tienda pública (comportamiento previo).

const DEFAULT_STORE_URL = "https://bluefishing.cl";

function trimUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

async function resolveCatalogCredentials({ env = process.env, query = null, store = null, boxConfigured = false } = {}) {
  if (env.WC_CONSUMER_KEY && env.WC_CONSUMER_SECRET) {
    return {
      source: "env",
      tenantId: null,
      storeUrl: trimUrl(env.WC_URL || DEFAULT_STORE_URL),
      consumerKey: env.WC_CONSUMER_KEY,
      consumerSecret: env.WC_CONSUMER_SECRET,
    };
  }

  if (!query || !store || !boxConfigured) return null;

  let tenantId = String(env.WOO_CATALOG_TENANT_ID || "").trim();
  if (!tenantId) {
    const { rows } = await query(
      "select tenant_id from tenant_credentials where woo_connected_at is not null and woo_consumer_key_enc is not null order by woo_connected_at"
    );
    if (!rows.length) return null;
    if (rows.length > 1) {
      throw new Error(
        `hay ${rows.length} tiendas conectadas por /panel y el catálogo es único: define WOO_CATALOG_TENANT_ID con la empresa cuyo catálogo usa el bot`
      );
    }
    tenantId = String(rows[0].tenant_id);
  }

  const creds = await store.getWooCredentials(tenantId);
  if (!creds) throw new Error("la empresa elegida para el catálogo no tiene tienda WooCommerce conectada");
  return {
    source: "panel",
    tenantId,
    storeUrl: trimUrl(creds.storeUrl),
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
  };
}

// Conecta las dependencias reales (Postgres + bóveda de credenciales) solo si están configuradas.
async function resolveFromRuntime(env = process.env) {
  if (env.WC_CONSUMER_KEY && env.WC_CONSUMER_SECRET) return resolveCatalogCredentials({ env });
  if (!env.DATABASE_URL) return null;
  const { query } = require("./postgres");
  const box = require("./secretBox");
  const { createStore } = require("./tenantStore");
  return resolveCatalogCredentials({ env, query, store: createStore(), boxConfigured: box.isConfigured() });
}

module.exports = { resolveCatalogCredentials, resolveFromRuntime, DEFAULT_STORE_URL };
