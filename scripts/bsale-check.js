#!/usr/bin/env node
// Verificación de setup: ¿el token Bsale funciona y los SKU de la web existen en Bsale?
// Solo lectura. No imprime el token ni datos de clientes.
//   docker compose --env-file .env.production exec -T app node scripts/bsale-check.js
const { config, bsaleGet, getStockBySku, loadSkuMap, mapLimit } = require("../lib/bsale");
const { readPath } = require("../lib/catalogPaths");
const fs = require("node:fs");

(async () => {
  const cfg = config();
  if (!cfg.enabled) {
    console.log("BSALE_ACCESS_TOKEN vacío: Bsale apagado. Matías no afirmará stock en vivo.");
    process.exit(1);
  }

  const offices = await bsaleGet("/offices.json?limit=50", { cfg });
  const list = (offices.items || []).map((o) => `${o.id}=${o.name}${Number(o.state) === 1 ? " (inactiva)" : ""}`);
  console.log(`Token OK. Sucursales: ${list.join(", ") || "ninguna"}`);
  if (cfg.offices.size) console.log(`Stock limitado a BSALE_OFFICE_IDS=${[...cfg.offices].join(",")}`);

  let total = 0;
  try { total = Object.keys(JSON.parse(fs.readFileSync(readPath("product_source.json"), "utf8"))).length; } catch {}
  const skus = [...new Set(loadSkuMap().values())];
  console.log(`Catálogo web: ${total} productos, ${skus.length} con SKU (${total ? Math.round((skus.length / total) * 100) : 0}%).`);
  if (!skus.length) {
    console.log("Ningún producto tiene SKU en WooCommerce: corre primero el sync de catálogo o carga los SKU en la web.");
    process.exit(1);
  }

  const results = await mapLimit(skus, 4, (sku) => getStockBySku(sku, { cfg }));
  const by = (s) => results.filter((r) => r.status === s);
  const found = results.length - by("not_found").length - by("unknown").length;
  console.log(`SKU encontrados en Bsale: ${found}/${results.length} · con stock: ${by("in_stock").length} · en 0: ${by("out_of_stock").length}`);
  if (by("not_found").length) console.log("Ejemplos no encontrados (revisar código de variante en Bsale):", by("not_found").slice(0, 10).map((r) => r.sku).join(", "));
  if (by("unknown").length) console.log(`Errores de consulta: ${by("unknown").length} (reintenta; si persiste revisa el token)`);
  console.log("Productos sin SKU o no encontrados: Matías los ofrece sin afirmar stock (\"te confirmo disponibilidad\").");
  process.exit(found ? 0 : 1);
})().catch((e) => { console.error("[Bsale] verificación falló:", e.message); process.exit(1); });
