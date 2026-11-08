#!/usr/bin/env node
// Sincroniza pedidos de la tienda del operador (WC_* del .env o tienda conectada en /panel)
// y de las demás empresas con tienda conectada. Lo ejecuta catalog-sync cada 6 h.
// Manual: docker compose --env-file .env.production exec -T app node scripts/woo-orders-sync.js
const { query } = require("../lib/postgres");
const { syncAllStores } = require("../lib/wooOrders");
const { createStore } = require("../lib/tenantStore");
const { resolveFromRuntime } = require("../lib/catalogCredentials");
(async () => {
  const results = await syncAllStores(query, { store: createStore(), resolveOperator: () => resolveFromRuntime(), log: console.log });
  if (!results.length) console.log("[Woo] sin tiendas conectadas: nada que sincronizar");
  process.exit(results.some((r) => r.ok === false) ? 1 : 0);
})().catch((e) => { console.error("[Woo]", e.message); process.exit(1); });
