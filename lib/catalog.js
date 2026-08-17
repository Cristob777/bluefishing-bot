const fs = require("fs");
const path = require("path");
const { normalizeText, detectBrand, detectProductType } = require("./product-taxonomy");
const { getEnrichmentMap } = require("./enrichment");

const CATALOG_FILES = [
  path.join(__dirname, "..", "catalogo", "catalogo_oficial"),
  path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt"),
];

function tokenize(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function detectLureType(name) {
  const normalized = normalizeText(name);
  if (normalized.includes("floating")) return "floating";
  if (normalized.includes("sinking")) return "sinking";
  if (normalized.includes("jig")) return "jig";
  if (normalized.includes("minnow")) return "minnow";
  if (normalized.includes("popper")) return "popper";
  if (normalized.includes("stickbait")) return "stickbait";
  if (normalized.includes("vinilo") || normalized.includes("soft bait") || normalized.includes("softbait")) {
    return "soft_bait";
  }
  return "unknown";
}

function detectActionType(name) {
  const normalized = normalizeText(name);
  if (normalized.includes("floating")) return "floating";
  if (normalized.includes("suspending")) return "suspending";
  if (normalized.includes("sinking")) return "sinking";
  return "unknown";
}

function detectWaterTags(name, category) {
  const normalized = normalizeText(`${name} ${category}`);
  const tags = [];
  if (/(surf|rock|shore|seabass|jigging|popping|sea|salt|offshore)/.test(normalized)) tags.push("mar");
  if (/(ajing|trucha|trout|river|creek)/.test(normalized)) tags.push("río");
  if (/(lake|lago)/.test(normalized)) tags.push("lago");
  return tags;
}

function extractWeightInfo(name) {
  const normalized = normalizeText(name).replace(/gr\b/g, "g");
  const rangeMatch = normalized.match(/(\d{1,3})\s*-\s*(\d{1,3})\s*g/);
  if (rangeMatch) {
    return {
      weightRange: `${rangeMatch[1]}-${rangeMatch[2]}g`,
      weightGrams: "unknown",
    };
  }

  const singleMatch = normalized.match(/(\d{1,3})\s*g\b/);
  if (singleMatch) {
    return {
      weightRange: "unknown",
      weightGrams: `${singleMatch[1]}g`,
    };
  }

  return {
    weightRange: "unknown",
    weightGrams: "unknown",
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.map((v) => normalizeText(v)).filter(Boolean) : [];
}

// `attrs` es la fila de product_attributes en Supabase (o undefined si el
// producto todavía no fue entrenado desde /admin). Los campos curados tienen
// prioridad sobre la heurística por nombre; cuando no existen, se cae de
// vuelta al comportamiento actual (regex sobre el nombre del producto).
function parseCatalogLine(line, attrs) {
  const parts = line.split("|").map((part) => part.trim());
  const [name = "", price = "", category = "", url = ""] = parts;
  if (!name) return null;

  const productType = detectProductType(name, category);
  const { weightRange, weightGrams } = extractWeightInfo(name);
  const lureType = (attrs?.extra?.lure_type) || detectLureType(name);
  const actionType = (attrs?.extra?.action_type) || detectActionType(name);
  const waterTags = detectWaterTags(name, category);
  const brand = detectBrand(name);

  const curatedSpecies = normalizeArray(attrs?.target_species);
  const curatedWater = normalizeArray(attrs?.water_type);
  const curatedPosition = normalizeArray(attrs?.fishing_position);
  const curatedTechnique = normalizeArray(attrs?.technique);
  const curatedExperience = attrs?.experience_level ? normalizeText(attrs.experience_level) : "unknown";
  const verifiedNotes = (attrs?.verified_notes || "").trim();
  const extra = attrs?.extra || {};
  const isEnriched = Boolean(attrs);

  const searchText = [
    name,
    price,
    category,
    url,
    productType,
    brand,
    lureType,
    actionType,
    weightRange,
    weightGrams,
    waterTags.join(" "),
    curatedSpecies.join(" "),
    curatedWater.join(" "),
    curatedPosition.join(" "),
    curatedTechnique.join(" "),
    verifiedNotes,
    Object.values(extra).join(" "),
  ].join(" ");

  return {
    name,
    price,
    category,
    url,
    productType,
    brand,
    lureType,
    actionType,
    waterTags,
    weightRange,
    weightGrams,
    curatedSpecies,
    curatedWater,
    curatedPosition,
    curatedTechnique,
    curatedExperience,
    verifiedNotes,
    extra,
    isEnriched,
    searchText,
  };
}

function loadCatalogText() {
  for (const filePath of CATALOG_FILES) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      if (!raw.trim()) continue;
      return raw;
    } catch (error) {
      console.warn("[Catalog] No se pudo leer:", filePath, error.message);
    }
  }
  return "";
}

// No cachea el resultado final: parsear 200-300 líneas de texto es
// trivial, y así los cambios cargados desde /admin quedan visibles apenas
// getEnrichmentMap() refresca su propio cache (ver lib/enrichment.js).
async function getCatalogDocuments() {
  const raw = loadCatalogText();
  const enrichmentMap = await getEnrichmentMap();

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const url = line.split("|")[3]?.trim();
      return parseCatalogLine(line, url ? enrichmentMap.get(url) : undefined);
    })
    .filter(Boolean);
}

function contextTokens(context) {
  const values = Object.values(context || {}).filter((value) => value && value !== "unknown");
  return tokenize(values.join(" "));
}

function scoreProduct(product, context, messageTokens) {
  let score = 0;
  const text = normalizeText(product.searchText);

  if (context.product_type !== "unknown" && product.productType === context.product_type) {
    score += 20;
  }
  if (context.brand_preference !== "unknown" && normalizeText(product.brand).includes(normalizeText(context.brand_preference))) {
    score += 10;
  }
  if (context.lure_type !== "unknown" && product.lureType === context.lure_type) {
    score += 14;
  }
  if (context.action_type !== "unknown" && product.actionType === context.action_type) {
    score += 10;
  }
  if (context.water_type !== "unknown") {
    if (product.curatedWater.length) {
      if (product.curatedWater.includes(normalizeText(context.water_type))) score += 10;
    } else if (product.waterTags.includes(context.water_type)) {
      score += 8;
    }
  }
  if (context.fishing_position !== "unknown" && product.curatedPosition.includes(normalizeText(context.fishing_position))) {
    score += 8;
  }
  if (context.technique !== "unknown" && product.curatedTechnique.includes(normalizeText(context.technique))) {
    score += 8;
  }
  if (context.weight_range !== "unknown" && normalizeText(product.weightRange) === normalizeText(context.weight_range)) {
    score += 12;
  }
  if (context.weight_grams !== "unknown" && normalizeText(product.weightGrams) === normalizeText(context.weight_grams)) {
    score += 12;
  }
  if (context.target_species !== "unknown") {
    if (product.curatedSpecies.length) {
      if (product.curatedSpecies.includes(normalizeText(context.target_species))) score += 10;
    } else if (text.includes(normalizeText(context.target_species))) {
      score += 6;
    }
  }
  if (context.experience_level !== "unknown" && product.curatedExperience !== "unknown") {
    if (product.curatedExperience === normalizeText(context.experience_level) || product.curatedExperience === "cualquiera") {
      score += 4;
    }
  }
  if (context.requested_attribute !== "unknown" && text.includes(normalizeText(context.requested_attribute))) {
    score += 4;
  }

  for (const token of messageTokens) {
    if (token.length < 3) continue;
    if (text.includes(token)) {
      score += 1;
    }
  }

  return score;
}

async function retrieveCatalogProducts({ message, context = {}, limit = 5 }) {
  const products = await getCatalogDocuments();
  const messageTokens = [...new Set([...tokenize(message), ...contextTokens(context)])];
  let candidateProducts = products;

  if (context.product_type && context.product_type !== "unknown") {
    candidateProducts = products.filter((product) => product.productType === context.product_type);
  }

  const scored = candidateProducts
    .map((product) => ({
      ...product,
      score: scoreProduct(product, context, messageTokens),
    }))
    .filter((product) => product.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length > 0) return scored;

  if (candidateProducts.length > 0) {
    return candidateProducts.slice(0, limit);
  }

  return context.product_type && context.product_type !== "unknown"
    ? []
    : products.slice(0, limit);
}

function formatProductsForPrompt(products) {
  if (!products.length) {
    return "Sin productos recuperados.";
  }

  return products
    .map((product, index) => {
      const meta = [
        `tipo=${product.productType}`,
        product.brand !== "unknown" ? `marca=${product.brand}` : null,
        product.lureType !== "unknown" ? `lure_type=${product.lureType}` : null,
        product.actionType !== "unknown" ? `action=${product.actionType}` : null,
        product.weightRange !== "unknown" ? `peso_rango=${product.weightRange}` : null,
        product.weightGrams !== "unknown" ? `peso=${product.weightGrams}` : null,
        product.curatedSpecies.length ? `especies_verificadas=${product.curatedSpecies.join("/")}` : null,
        product.curatedWater.length ? `agua_verificada=${product.curatedWater.join("/")}` : null,
        product.curatedPosition.length ? `posicion_verificada=${product.curatedPosition.join("/")}` : null,
        product.curatedTechnique.length ? `tecnica_verificada=${product.curatedTechnique.join("/")}` : null,
        product.curatedExperience !== "unknown" ? `nivel=${product.curatedExperience}` : null,
        ...Object.entries(product.extra || {}).map(([key, value]) => (value ? `${key}=${value}` : null)),
      ].filter(Boolean).join(", ");

      const notes = product.verifiedNotes ? ` | notas_verificadas: ${product.verifiedNotes}` : "";
      const flag = product.isEnriched ? "" : " | [sin ficha técnica verificada]";

      return `${index + 1}. ${product.name} | ${product.price} | ${product.category} | ${product.url}${meta ? ` | ${meta}` : ""}${notes}${flag}`;
    })
    .join("\n");
}

module.exports = {
  getCatalogDocuments,
  retrieveCatalogProducts,
  formatProductsForPrompt,
};
