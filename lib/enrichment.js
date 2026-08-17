// Carga los atributos "entrenados" por el equipo desde /admin (tabla
// product_attributes en Supabase) para que lib/catalog.js los mezcle con el
// catálogo base. Corre server-side dentro del webhook, así que usa la
// service role key (bypassa RLS) — nunca se expone al navegador.
//
// Si Supabase no está configurado, o la consulta falla, retorna un mapa
// vacío y el catálogo sigue funcionando solo con la heurística por nombre
// (comportamiento actual, sin romper nada).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_TTL_MS = 5 * 60 * 1000;

let client = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

let cache = { map: new Map(), fetchedAt: 0 };

async function getEnrichmentMap() {
  if (!client) return new Map();

  const now = Date.now();
  if (now - cache.fetchedAt < CACHE_TTL_MS) return cache.map;

  try {
    const { data, error } = await client.from("product_attributes").select("*");
    if (error) throw error;

    const map = new Map();
    for (const row of data || []) {
      map.set(row.product_url, row);
    }
    cache = { map, fetchedAt: now };
    return map;
  } catch (error) {
    console.warn("[Enrichment] No se pudo cargar atributos desde Supabase:", error.message);
    return cache.map;
  }
}

module.exports = { getEnrichmentMap };
