const fs = require("node:fs");
const path = require("node:path");
const { fetchProductPage } = require("../lib/productPage");
const { TECHNICAL_TYPES, extractAIKnowledge, heuristicKnowledge } = require("../lib/knowledgeExtractor");
const { detectProductType, detectBrand } = require("../lib/product-taxonomy");

const CATALOG_PATH = path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt");
const KNOWLEDGE_PATH = path.join(__dirname, "..", "catalogo", "product_knowledge.json");
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 0);
const ENRICH_DELAY_MS = Number(process.env.ENRICH_DELAY_MS || 150);
const ENRICH_FORCE = String(process.env.ENRICH_FORCE || "").toLowerCase() === "true";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCatalogLine(line) {
  const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 4) return null;
  const url = parts.pop();
  const category = parts.pop();
  const price = parts.pop();
  const name = parts.join(" - ").trim();
  if (!name || !/^https?:\/\//.test(url || "")) return null;
  return { name, price, category, url };
}

function loadCatalog() {
  return fs
    .readFileSync(CATALOG_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseCatalogLine)
    .filter(Boolean);
}

function loadKnowledge() {
  try {
    const parsed = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistKnowledge(knowledge) {
  const sorted = Object.fromEntries(
    Object.entries(knowledge).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

async function syncToSupabase(records) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !records.length) return;
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = records.map((r) => ({
    product_url: r.product_url,
    target_species: r.target_species,
    water_type: r.water_type,
    fishing_position: r.fishing_position,
    technique: r.technique,
    experience_level: r.experience_level,
    verified_notes: r.verified_notes,
    use_case: r.use_case,
    extra: r.extra,
    source_url: r.source_url,
    source_hash: r.source_hash,
    extraction_method: r.extraction_method,
    extraction_confidence: r.extraction_confidence,
    evidence: r.evidence,
    updated_by: "auto-enrichment",
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("product_attributes").upsert(rows, {
    onConflict: "product_url",
  });
  if (error) throw new Error(`Supabase enrichment upsert: ${error.message}`);
}

async function main() {
  const catalog = loadCatalog();
  const knowledge = loadKnowledge();
  let processed = 0;
  let changed = 0;
  let failed = 0;
  const changedRecords = [];

  for (const product of catalog) {
    const productType = detectProductType(product.name, product.category);
    if (!TECHNICAL_TYPES.has(productType)) continue;
    if (ENRICH_LIMIT > 0 && processed >= ENRICH_LIMIT) break;

    processed += 1;
    try {
      const page = await fetchProductPage(product.url);
      const existing = knowledge[product.url];
      if (!ENRICH_FORCE && existing?.source_hash === page.sourceHash) {
        continue;
      }

      const base = {
        name: page.name || product.name,
        category: page.category || product.category,
        productType,
        url: product.url,
        sourceText: page.sourceText,
      };

      const extracted = process.env.OPENAI_API_KEY
        ? await extractAIKnowledge(base)
        : heuristicKnowledge(base);

      const record = {
        product_url: product.url,
        product_name: base.name,
        product_type: productType,
        brand: page.brand || detectBrand(base.name),
        price: product.price,
        target_species: extracted.target_species || [],
        water_type: extracted.water_type || [],
        fishing_position: extracted.fishing_position || [],
        technique: extracted.technique || [],
        experience_level: extracted.experience_level || "unknown",
        use_case: extracted.use_case || "",
        verified_notes: extracted.verified_notes || "",
        extra: extracted.extra || {},
        evidence: extracted.evidence || [],
        extraction_confidence: Number(extracted.confidence || 0),
        extraction_method: extracted.extraction_method || "heuristic",
        source_url: product.url,
        source_hash: page.sourceHash,
        updated_at: new Date().toISOString(),
      };

      knowledge[product.url] = record;
      changedRecords.push(record);
      changed += 1;

      if (changed % 10 === 0) persistKnowledge(knowledge);
      await sleep(ENRICH_DELAY_MS);
    } catch (error) {
      failed += 1;
      console.warn(`[Enrich] ${product.name}: ${error.message}`);
    }
  }

  persistKnowledge(knowledge);

  try {
    await syncToSupabase(changedRecords);
  } catch (error) {
    console.warn("[Enrich] Supabase no disponible:", error.message);
  }

  console.log(JSON.stringify({
    catalog_products: catalog.length,
    technical_processed: processed,
    changed,
    failed,
    knowledge_total: Object.keys(knowledge).length,
    method: process.env.OPENAI_API_KEY ? "openai+heuristic-fallback" : "heuristic-only",
  }));
}

main().catch((error) => {
  console.error("[Enrich] Fatal:", error);
  process.exit(1);
});
