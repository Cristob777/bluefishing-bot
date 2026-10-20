#!/usr/bin/env node
// Sincroniza pedidos de todas las empresas con tienda conectada + la tienda del operador (WC_*).
// Uso (cron diario): docker compose --env-file .env.production exec -T app node scripts/woo-orders-sync.js
const { query } = require("../lib/postgres");
const { syncOrders, operatorCreds } = require("../lib/wooOrders");
const { createStore } = require("../lib/tenantStore");
(async () => {
  const store = createStore();
  const op = operatorCreds();
  if (op) console.log("[Woo] operador:", await syncOrders(query, { tenantId: null, creds: op }));
  const t = await query("select tenant_id from tenant_credentials where woo_connected_at is not null");
  for (const { tenant_id } of t.rows) {
    const creds = await store.getWooCredentials(tenant_id);
    if (creds) console.log("[Woo] empresa", tenant_id.slice(0, 8), await syncOrders(query, { tenantId: tenant_id, creds }));
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
