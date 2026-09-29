const fs = require("node:fs");
const path = require("node:path");
const { normalizeText, detectBrand, detectProductType } = require("./product-taxonomy");
const { getEnrichmentMap } = require("./enrichment");

const CATALOG_FILES = [
  path.join(__dirname, "..", "catalogo", "catalogo_oficial"),
  path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt"),
];

function tokenize(value) {
  return normalizeText(value || "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function parseCatalogLine(line, attrs) {
  const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 4) return null;

  const url = parts.pop() || "";
  const category = parts.pop() || "";
  const price = parts.pop() || "";
  const name = parts.join(" - ").trim();
  if (!name || !/^https?:\/\//.test(url)) return null;

  const productType = detectProductType(name, category);
  const brand = detectBrand(name);
  const extra = attrs?.extra || {};
  const normalizedName = normalizeText(name);
  const searchText = normalizeText([
    name,
    category,
    brand,
    productType,
    attrs?.use_case,
    attrs?.verified_notes,
    ...(attrs?.target_species || []),
    ...(attrs?.water_type || []),
    ...(attrs?.fishing_position || []),
    ...(attrs?.technique || []),
    ...(attrs?.evidence || []),
    ...Object.values(extra),
  ].filter(Boolean).join(" "));

  return {
    name,
    normalizedName,
    price,
    category,
    url,
    productType,
    brand,
    targetSpecies: attrs?.target_species || [],
    waterType: attrs?.water_type || [],
    fishingPosition: attrs?.fishing_position || [],
    technique: attrs?.technique || [],
    experienceLevel: attrs?.experience_level || "unknown",
    useCase: attrs?.use_case || "",
    verifiedNotes: attrs?.verified_notes || "",
    evidence: attrs?.evidence || [],
    extra,
    confidence: Number(attrs?.extraction_confidence || attrs?.confidence || 0),
    isEnriched: Boolean(attrs),
    searchText,
  };
}

function loadCatalogText() {
  for (const filePath of CATALOG_FILES) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      if (raw.trim()) return raw;
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("[Catalog] " + error.message);
    }
  }
  return "";
}

async function getCatalogDocuments() {
  const raw = loadCatalogText();
  const enrichmentMap = await getEnrichmentMap();

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const pieces = line.split("|").map((part) => part.trim()).filter(Boolean);
      const url = pieces.length >= 4 ? pieces[pieces.length - 1] : "";
      return parseCatalogLine(line, url ? enrichmentMap.get(url) : undefined);
    })
    .filter(Boolean);
}

function parseNumberRange(value) {
  if (!value || value === "unknown") return null;
  const nums = String(value)
    .replace(",", ".")
    .match(/\d+(?:\.\d+)?/g)
    ?.map(Number)
    .filter(Number.isFinite) || [];
  if (!nums.length) return null;
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
}

function overlaps(a, b) {
  return Boolean(a && b && Math.max(a.min, b.min) <= Math.min(a.max, b.max));
}

function parseClp(value) {
  const n = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function budgetMatch(price, budget) {
  if (!budget || budget === "unknown") return false;
  const p = parseClp(price);
  if (!p) return false;
  const nums = String(budget)
    .match(/\d[\d.\s]*/g)
    ?.map((v) => Number(v.replace(/[^0-9]/g, "")))
    .filter((v) => Number.isFinite(v) && v > 0) || [];
  if (!nums.length) return false;
  if (nums.length === 1) return p <= nums[0];
  return p >= Math.min(nums[0], nums[1]) && p <= Math.max(nums[0], nums[1]);
}

function normalizedArray(values) {
  return (values || []).map((value) => normalizeText(value));
}

function exactOrContained(values, requested) {
  if (!requested || requested === "unknown") return false;
  const q = normalizeText(requested);
  return normalizedArray(values).some((value) => value === q || value.includes(q) || q.includes(value));
}

function scoreProduct(product, context, message) {
  let score = 0;
  const reasons = [];
  const messageText = normalizeText(message || "");
  const messageTokens = [...new Set(tokenize(message))];

  if (context.product_type && context.product_type !== "unknown") {
    if (product.productType !== context.product_type) return { score: 0, reasons: ["wrong_product_type"] };
    score += 20;
    reasons.push("product_type");
  }

  if (context.brand_preference && context.brand_preference !== "unknown") {
    const requestedBrand = normalizeText(context.brand_preference);
    if (normalizeText(product.brand).includes(requestedBrand) || product.normalizedName.includes(requestedBrand)) {
      score += 12;
      reasons.push("brand");
    }
  }

  if (context.target_species && context.target_species !== "unknown" && exactOrContained(product.targetSpecies, context.target_species)) {
    score += 16;
    reasons.push("species");
  }

  if (context.water_type && context.water_type !== "unknown" && exactOrContained(product.waterType, context.water_type)) {
    score += 12;
    reasons.push("water");
  }

  if (context.fishing_position && context.fishing_position !== "unknown" && exactOrContained(product.fishingPosition, context.fishing_position)) {
    score += 10;
    reasons.push("position");
  }

  if (context.technique && context.technique !== "unknown" && exactOrContained(product.technique, context.technique)) {
    score += 12;
    reasons.push("technique");
  }

  const productWeight = parseNumberRange(product.extra.weight_range || product.extra.weight_grams);
  const requestedWeight = parseNumberRange(context.weight_range || context.weight_grams);
  if (productWeight && requestedWeight && overlaps(productWeight, requestedWeight)) {
    score += 15;
    reasons.push("weight");
  }

  if (context.budget_range && context.budget_range !== "unknown" && budgetMatch(product.price, context.budget_range)) {
    score += 8;
    reasons.push("budget");
  }

  if (context.requested_attribute && context.requested_attribute !== "unknown" &&
      product.searchText.includes(normalizeText(context.requested_attribute))) {
    score += 6;
    reasons.push("attribute");
  }

  const nameMatches = messageTokens.filter((token) => product.normalizedName.includes(token));
  if (nameMatches.length) {
    score += Math.min(18, nameMatches.length * 3);
    reasons.push("name_tokens");
  }

  if (messageText && product.normalizedName && messageText.includes(product.normalizedName)) {
    score += 40;
    reasons.push("exact_product_name");
  }

  if (product.isEnriched) score += 2;
  if (product.confidence >= 0.8) score += 2;

  return { score, reasons };
}

async function retrieveCatalogProducts({ message, context = {}, limit = 5 }) {
  const products = await getCatalogDocuments();

  return products
    .map((product) => {
      const ranked = scoreProduct(product, context, message);
      return { ...product, score: ranked.score, scoreReasons: ranked.reasons };
    })
    .filter((product) => product.score > 0)
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .slice(0, limit);
}

function formatProductsForPrompt(products) {
  if (!products.length) return "Sin productos compatibles recuperados.";

  return products.map((product, index) => {
    const facts = [
      "tipo=" + product.productType,
      product.brand && product.brand !== "unknown" ? "marca=" + product.brand : null,
      product.targetSpecies.length ? "especies=" + product.targetSpecies.join("/") : null,
      product.waterType.length ? "agua=" + product.waterType.join("/") : null,
      product.fishingPosition.length ? "posición=" + product.fishingPosition.join("/") : null,
      product.technique.length ? "técnica=" + product.technique.join("/") : null,
      product.useCase ? "uso=" + product.useCase : null,
      product.verifiedNotes ? "notas=" + product.verifiedNotes : null,
      Object.keys(product.extra).length ? "specs=" + JSON.stringify(product.extra) : null,
      product.evidence.length ? "evidencia=" + product.evidence.join(" / ") : null,
      "score=" + product.score,
    ].filter(Boolean);

    return [
      (index + 1) + ". " + product.name,
      product.price,
      product.url,
      facts.join(" | "),
      product.isEnriched ? "ficha_técnica=verificada" : "ficha_técnica=no_enriquecida",
    ].join(" | ");
  }).join("\n");
}

function formatProductsCompactForPrompt(products, context = {}) {
  if (!products.length) return "Sin productos compatibles recuperados.";

  const wants = new Set(
    Object.entries(context)
      .filter(([, value]) => value && value !== "unknown")
      .map(([key]) => key)
  );

  return products.map((product, index) => {
    const facts = [
      "tipo=" + product.productType,
      product.brand && product.brand !== "unknown" ? "marca=" + product.brand : null,
      wants.has("target_species") && product.targetSpecies.length ? "especies=" + product.targetSpecies.join("/") : null,
      wants.has("water_type") && product.waterType.length ? "agua=" + product.waterType.join("/") : null,
      wants.has("fishing_position") && product.fishingPosition.length ? "posición=" + product.fishingPosition.join("/") : null,
      wants.has("technique") && product.technique.length ? "técnica=" + product.technique.join("/") : null,
      (wants.has("weight_range") || wants.has("weight_grams")) && (product.extra.weight_range || product.extra.weight_grams)
        ? "gramaje=" + (product.extra.weight_range || product.extra.weight_grams)
        : null,
      wants.has("requested_attribute") && context.requested_attribute === "gear_ratio" && product.extra.gear_ratio
        ? "ratio=" + product.extra.gear_ratio
        : null,
      wants.has("requested_attribute") && context.requested_attribute === "max_drag" && product.extra.max_drag_kg
        ? "drag=" + product.extra.max_drag_kg + "kg"
        : null,
      wants.has("requested_attribute") && context.requested_attribute === "length" && product.extra.length
        ? "largo=" + product.extra.length
        : null,
      product.isEnriched ? "verificado=sí" : "verificado=no",
    ].filter(Boolean);

    return [
      `P${index + 1}`,
      product.name,
      product.price,
      product.url,
      facts.join("|"),
    ].join(" | ");
  }).join("\n");
}

module.exports = {
  getCatalogDocuments,
  retrieveCatalogProducts,
  formatProductsForPrompt,
  formatProductsCompactForPrompt,
  parseNumberRange,
  overlaps,
  budgetMatch,
};
