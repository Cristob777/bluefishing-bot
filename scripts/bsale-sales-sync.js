#!/usr/bin/env node
// Sincroniza ventas Bsale (web + tienda) y las atribuye a conversaciones con Matías.
// Lo ejecuta catalog-sync en cada ciclo. Sin BSALE_ACCESS_TOKEN termina sin hacer nada.
// Manual: docker compose --env-file .env.production exec -T app node scripts/bsale-sales-sync.js
const { query } = require("../lib/postgres");
const { syncBsaleSales } = require("../lib/bsaleSales");
(async () => {
  const r = await syncBsaleSales(query);
  if (r.skipped) console.log("[Bsale] sin BSALE_ACCESS_TOKEN: ventas no se sincronizan");
  else console.log("[Bsale] ventas:", r);
  process.exit(r.ok === false ? 1 : 0);
})().catch((e) => { console.error("[Bsale]", e.message); process.exit(1); });
