// Detección de marca/tipo de producto a partir del nombre+categoría.
// Usado tanto por lib/catalog.js (retrieval en el webhook) como por
// scripts/sync-catalogo.js (para guardar product_type/brand en Supabase).

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
  "ZENAQ",
  "XESTA",
  "ATOM",
  "FISHBITES",
  "GOMEXUS",
];

function normalizeText(text) {
  return (text || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
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
  if (/(combo)/.test(normalized)) return "combo";
  return "otro";
}

module.exports = {
  KNOWN_BRANDS,
  normalizeText,
  detectBrand,
  detectProductType,
};
