#!/usr/bin/env node
// Job de sincronización bot -> Atomic CRM. Uso: node scripts/atomic-crm-sync.js [--once]
// Requiere ATOMIC_CRM_ENABLED=true, DATABASE_URL, ATOMIC_CRM_SUPABASE_URL y ATOMIC_CRM_SUPABASE_SECRET_KEY.
const postgres = require("../lib/postgres");
const { createAtomicClient, runSync } = require("../lib/atomicCrmSync");
const { safeError } = require("../lib/logSanitizer");

function cfg() {
  return {
    enabled: process.env.ATOMIC_CRM_ENABLED === "true",
    url: process.env.ATOMIC_CRM_SUPABASE_URL || "",
    key: process.env.ATOMIC_CRM_SUPABASE_SECRET_KEY || "",
    intervalSeconds: Math.max(60, Number(process.env.ATOMIC_CRM_SYNC_INTERVAL_SECONDS || 300)),
    lookbackDays: Number(process.env.ATOMIC_CRM_SYNC_LOOKBACK_DAYS || 30),
    batchSize: Math.min(1000, Number(process.env.ATOMIC_CRM_SYNC_BATCH || 200)),
    defaultSalesId: process.env.ATOMIC_CRM_DEFAULT_SALES_ID ? Number(process.env.ATOMIC_CRM_DEFAULT_SALES_ID) : null,
  };
}

async function once(c) {
  const atomic = createAtomicClient({ url: c.url, key: c.key });
  const stats = await runSync({ query: postgres.query, atomic, lookbackDays: c.lookbackDays, batchSize: c.batchSize, defaultSalesId: c.defaultSalesId });
  console.log("[AtomicCRM] Sync OK", JSON.stringify(stats));
}

async function main() {
  const c = cfg();
  if (!c.enabled) { console.log("[AtomicCRM] ATOMIC_CRM_ENABLED != true; nada que hacer."); return; }
  const missing = [!postgres.isConfigured && "DATABASE_URL", !c.url && "ATOMIC_CRM_SUPABASE_URL", !c.key && "ATOMIC_CRM_SUPABASE_SECRET_KEY"].filter(Boolean);
  if (missing.length) { console.error("[AtomicCRM] Falta configuración:", missing.join(", ")); process.exitCode = 1; return; }
  const loop = !process.argv.includes("--once");
  do {
    try { await once(c); } catch (e) { console.error("[AtomicCRM] Sync falló:", safeError(e)); }
    if (loop) await new Promise((r) => setTimeout(r, c.intervalSeconds * 1000));
  } while (loop);
  await postgres.getPool()?.end();
}

main();
