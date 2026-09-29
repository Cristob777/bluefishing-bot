const fs = require("node:fs");
const path = require("node:path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_TTL_MS = 5 * 60 * 1000;
const LOCAL_KNOWLEDGE = path.join(__dirname, "..", "catalogo", "product_knowledge.json");

let client = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let cache = { map: null, fetchedAt: 0 };

function loadLocalMap() {
  const map = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_KNOWLEDGE, "utf8"));
    for (const [productUrl, row] of Object.entries(parsed || {})) {
      map.set(productUrl, {
        product_url: productUrl,
        ...row,
        verified_notes: row.verified_notes || row.use_case || "",
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("[Enrichment] No se pudo leer product_knowledge.json:", error.message);
    }
  }
  return map;
}

function mergeRow(base, remote) {
  if (!base) return remote;
  if (!remote) return base;
  return {
    ...base,
    ...remote,
    target_species: remote.target_species?.length ? remote.target_species : base.target_species,
    water_type: remote.water_type?.length ? remote.water_type : base.water_type,
    fishing_position: remote.fishing_position?.length ? remote.fishing_position : base.fishing_position,
    technique: remote.technique?.length ? remote.technique : base.technique,
    verified_notes: remote.verified_notes || base.verified_notes,
    use_case: remote.use_case || base.use_case,
    extra: { ...(base.extra || {}), ...(remote.extra || {}) },
    evidence: remote.evidence?.length ? remote.evidence : base.evidence,
  };
}

async function getEnrichmentMap() {
  const now = Date.now();
  if (cache.map && now - cache.fetchedAt < CACHE_TTL_MS) return cache.map;

  const map = loadLocalMap();
  if (client) {
    try {
      const { data, error } = await client.from("product_attributes").select("*");
      if (error) throw error;
      for (const row of data || []) {
        map.set(row.product_url, mergeRow(map.get(row.product_url), row));
      }
    } catch (error) {
      console.warn("[Enrichment] Supabase no disponible; usando conocimiento local:", error.message);
    }
  }

  cache = { map, fetchedAt: now };
  return map;
}

module.exports = { getEnrichmentMap, loadLocalMap };
