const fs = require("fs");
const path = require("path");

const CATALOG_FILES = [
  path.join(__dirname, "..", "catalogo", "catalogo_oficial"),
  path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt"),
];

const KNOWN_BRANDS = [
  "TSURINOYA",
  "YAMAGA BLANKS",
  "YAMAGA",
  "BADFISH",
  "DAIWA",
  "BKK",
  "VARIVAS",
  "SALVIMAR",
  "DECOY",
  "MEIHO",
];

let catalogCache = null;

function normalizeText(text) {
  return (text || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function tokenize(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function detectBrand(name) {
  const upper = (name || "").toUpperCase();
  return KNOWN_BRANDS.find((brand) => upper.includes(brand)) || "unknown";
}

function detectProductType(name, category) {
  const text = `${name} ${category}`;
  const normalized = normalizeText(text);

  if (/canas|cana|rod\b/.test(normalized)) return "caña";
  if (/(carretes|carrete|reel|spool|baitcasting)/.test(normalized)) return "carrete";
  if (/(lineas|linea|fluoro|braid|trenzad|nylon|pe\s*\d)/.test(normalized)) return "línea";
  if (/(anzuelos|anzuelo|hook)/.test(normalized)) return "anzuelo";
  if (normalized.includes("sen") && normalized.includes("uelo")) return "señuelo";
  if (/(minnow|popper|stickbait|crank|vinilo|soft bait|softbait|lure)/.test(normalized)) return "señuelo";
  if (/(jockey|sombrero|chaqueta|guante|shirt|ropa)/.test(normalized)) return "ropa";
  if (/(caja|banano|accesorio|bolso)/.test(normalized)) return "accesorio";
  return "otro";
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

function parseCatalogLine(line) {
  const parts = line.split("|").map((part) => part.trim());
  const [name = "", price = "", category = "", url = ""] = parts;
  if (!name) return null;

  const productType = detectProductType(name, category);
  const { weightRange, weightGrams } = extractWeightInfo(name);
  const lureType = detectLureType(name);
  const actionType = detectActionType(name);
  const waterTags = detectWaterTags(name, category);
  const brand = detectBrand(name);
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

function getCatalogDocuments() {
  if (catalogCache) return catalogCache;

  const raw = loadCatalogText();
  catalogCache = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseCatalogLine)
    .filter(Boolean);

  return catalogCache;
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
  if (context.water_type !== "unknown" && product.waterTags.includes(context.water_type)) {
    score += 8;
  }
  if (context.weight_range !== "unknown" && normalizeText(product.weightRange) === normalizeText(context.weight_range)) {
    score += 12;
  }
  if (context.weight_grams !== "unknown" && normalizeText(product.weightGrams) === normalizeText(context.weight_grams)) {
    score += 12;
  }
  if (context.target_species !== "unknown" && text.includes(normalizeText(context.target_species))) {
    score += 6;
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

function retrieveCatalogProducts({ message, context = {}, limit = 5 }) {
  const products = getCatalogDocuments();
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
      ].filter(Boolean).join(", ");

      return `${index + 1}. ${product.name} | ${product.price} | ${product.category} | ${product.url}${meta ? ` | ${meta}` : ""}`;
    })
    .join("\n");
}

module.exports = {
  getCatalogDocuments,
  retrieveCatalogProducts,
  formatProductsForPrompt,
};
