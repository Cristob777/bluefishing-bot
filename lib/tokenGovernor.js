const { KNOWN_BRANDS, normalizeText, detectBrand } = require("./product-taxonomy");

const SPECIES = {
  corvina: /\bcorvina\b/,
  lenguado: /\blenguad[oa]\b/,
  "róbalo": /\brobalo\b|\bseabass\b|\bsea bass\b/,
  trucha: /\btrucha\b|\btrout\b/,
  "salmón": /\bsalmon\b/,
  "atún": /\batun\b|\btuna\b/,
  dorado: /\bdorado\b/,
  albacora: /\balbacora\b/,
  hiramasa: /\bhiramasa\b/,
  pejerrey: /\bpejerrey\b/,
  congrio: /\bcongrio\b/,
  merluza: /\bmerluza\b/,
};

const STOPWORDS = new Set([
  "hola","buenas","quiero","busco","necesito","para","con","una","uno","unos","unas",
  "que","qué","me","mi","de","del","la","el","los","las","por","favor","tienen","tiene",
  "precio","cuanto","cuánto","cuesta","vale","link","enlace","stock","disponible",
]);

function firstMatch(map, text) {
  for (const [value, re] of Object.entries(map)) if (re.test(text)) return value;
  return "unknown";
}

function extractWeight(text) {
  const range = text.match(/\b(\d{1,3})\s*(?:-|–|a)\s*(\d{1,3})\s*(?:g|gr)\b/);
  if (range) return { weight_range: `${range[1]}-${range[2]}g`, weight_grams: "unknown" };
  const single = text.match(/\b(\d{1,3})\s*(?:g|gr)\b/);
  return single
    ? { weight_range: "unknown", weight_grams: `${single[1]}g` }
    : { weight_range: "unknown", weight_grams: "unknown" };
}

function extractBudget(text) {
  const patterns = [
    /(?:presupuesto|hasta|maximo|max)\D{0,12}\$?\s*([0-9][0-9.\s]{3,})/,
    /\$\s*([0-9][0-9.\s]{3,})\s*(?:de presupuesto|maximo|max)?/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return String(Number(m[1].replace(/[^0-9]/g, "")));
  }
  return "unknown";
}

function extractProductType(text) {
  if (/\b(cana|canas|rod)\b/.test(text)) return "caña";
  if (/\b(carrete|carretes|reel)\b/.test(text)) return "carrete";
  if (/\b(linea|lineas|fluorocarbon|trenzado|braid)\b/.test(text)) return "línea";
  if (/\b(anzuelo|anzuelos|hook)\b/.test(text)) return "anzuelo";
  if (/\b(senuelo|senuelos|lure|minnow|popper|stickbait|vinilo|jig)\b/.test(text)) return "señuelo";
  if (/\bcombo\b/.test(text)) return "combo";
  return "unknown";
}

function extractRequestedAttribute(text) {
  if (/\b(precio|cuanto cuesta|cuanto vale|valor)\b/.test(text)) return "precio";
  if (/\b(stock|disponible|disponibilidad)\b/.test(text)) return "stock";
  if (/\b(ratio|gear ratio|relacion)\b/.test(text)) return "gear_ratio";
  if (/\b(drag|freno|max drag)\b/.test(text)) return "max_drag";
  if (/\b(largo|longitud|mide|medida)\b/.test(text)) return "length";
  if (/\b(peso|gramaje|gramos|rango de lanzamiento)\b/.test(text)) return "weight";
  return "unknown";
}

function detectIntent(text, context) {
  if (/\b(mayorista|por mayor|al por mayor|distribuidor|distribuir|revender|reventa)\b/.test(text)) {
    return { intent: "consulta_mayorista", confidence: 0.99 };
  }
  if (/\b(mi pedido|mi compra|devolucion|garantia|cambio de producto|postventa|reclamo)\b/.test(text)) {
    return { intent: "postventa", confidence: 0.97 };
  }
  if (/\b(compara|comparar|versus|\bvs\b)\b/.test(text)) {
    return { intent: "comparar_productos", confidence: 0.93 };
  }
  if (/\b(precio|cuanto cuesta|cuanto vale|stock|disponible|disponibilidad)\b/.test(text)) {
    return { intent: "stock_precio", confidence: 0.96 };
  }
  if (/\b(pasame|mandame|dame|enviame)\b.*\b(link|enlace)\b|\b(lo quiero|quiero comprar|comprarlo)\b/.test(text)) {
    return { intent: "seguimiento_compra", confidence: 0.96 };
  }
  if (/\b(recomiend|recomendacion|cual me sirve|que me sirve|cual elegir|que elegir)\b/.test(text)) {
    return { intent: "pedir_recomendacion", confidence: 0.96 };
  }
  if (/\b(sirve para|compatible|compatibilidad|le sirve|me sirve)\b/.test(text)) {
    return { intent: "compatibilidad", confidence: 0.94 };
  }

  const hasAnchor =
    context.product_type !== "unknown" ||
    context.brand_preference !== "unknown" ||
    context.target_species !== "unknown" ||
    /\b\d{3,5}[a-z-]*\b/.test(text);

  if (hasAnchor) return { intent: "buscar_producto", confidence: 0.84 };
  return { intent: "consulta_ambigua", confidence: 0.45 };
}

function extractDeterministicSignals(message) {
  const text = normalizeText(message || "");
  const brand = detectBrand(message || "");
  const weight = extractWeight(text);

  const context = {
    product_type: extractProductType(text),
    subcategory: "unknown",
    water_type: firstMatch({ mar: /\bmar\b/, "río": /\brio\b/, lago: /\blago\b/ }, text),
    fishing_position: firstMatch({
      roca: /\broca|roquerio|roquerios\b/,
      playa: /\bplaya|surf\b/,
      bote: /\bbote\b/,
      "embarcación": /\bembarcacion|offshore\b/,
      muelle: /\bmuelle|pier\b/,
      orilla: /\borilla|shore\b/,
    }, text),
    target_species: firstMatch(SPECIES, text),
    technique: firstMatch({
      "shore jigging": /\bshore jig/,
      jigging: /\bjigging|slow jig|vertical jig\b/,
      surfcasting: /\bsurfcasting|surf casting|surfcast\b/,
      spinning: /\bspinning\b/,
      baitcasting: /\bbaitcast|baitcasting\b/,
      popping: /\bpopping\b/,
      trolling: /\btrolling\b/,
      "ajing/light game": /\bajing|light game\b/,
    }, text),
    lure_type: firstMatch({
      jig: /\bjig\b/,
      minnow: /\bminnow\b/,
      popper: /\bpopper\b/,
      stickbait: /\bstickbait|stick bait\b/,
      soft_bait: /\bvinilo|softbait|soft bait\b/,
    }, text),
    action_type: firstMatch({
      floating: /\bfloating\b/,
      suspending: /\bsuspending\b/,
      sinking: /\bsinking\b/,
    }, text),
    weight_range: weight.weight_range,
    weight_grams: weight.weight_grams,
    rod_setup: firstMatch({
      spinning: /\bspinning\b/,
      baitcasting: /\bbaitcast|baitcasting\b/,
      jigging: /\bjigging\b/,
      surf: /\bsurf\b/,
    }, text),
    budget_range: extractBudget(text),
    brand_preference: brand === "unknown" ? "unknown" : brand,
    experience_level: firstMatch({
      beginner: /\bprincipiante|novato|empezando\b/,
      advanced: /\bavanzado|experto\b/,
    }, text),
    purchase_intent_level: /\b(comprar|lo quiero|comprarlo)\b/.test(text) ? "high" : "unknown",
    requested_attribute: extractRequestedAttribute(text),
  };

  const intentResult = detectIntent(text, context);
  const populated = Object.values(context).filter((v) => v && v !== "unknown").length;
  const currentMessageHasProductAnchor =
    context.product_type !== "unknown" ||
    context.brand_preference !== "unknown" ||
    context.target_species !== "unknown" ||
    /\b\d{3,5}[a-z-]*\b/.test(text);

  const canSkipClassifier =
    intentResult.confidence >= 0.93 ||
    (intentResult.intent === "buscar_producto" && populated >= 2);

  return {
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    context,
    populated,
    canSkipClassifier,
    currentMessageHasProductAnchor,
  };
}

function staticConversationReply(message) {
  const text = normalizeText(message || "").trim();
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hol+)([!. ]*)$/.test(text)) {
    return "Hola. Soy Matías de BlueFishing. ¿Qué estás buscando para tu pesca?";
  }
  if (/^(gracias|muchas gracias|vale gracias|perfecto gracias|bacan gracias)([!. ]*)$/.test(text)) {
    return "De nada. Si necesitas comparar otro producto, dime qué estás buscando.";
  }
  return null;
}

function significantTokens(message) {
  return normalizeText(message || "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function strongProductMatch(products, message) {
  if (!products?.length) return null;
  const top = products[0];
  const second = products[1];
  const gap = top.score - (second?.score || 0);
  const reasons = new Set(top.scoreReasons || []);
  const queryTokens = significantTokens(message);
  const matchedTokens = queryTokens.filter((t) => top.normalizedName?.includes(t));

  const strong =
    reasons.has("exact_product_name") ||
    (
      top.score >= 24 &&
      gap >= 6 &&
      matchedTokens.length >= 2 &&
      (reasons.has("brand") || reasons.has("name_tokens"))
    );

  return strong ? top : null;
}

function deterministicCommerceReply({ message, classification, products }) {
  if (!["stock_precio", "seguimiento_compra", "buscar_producto"].includes(classification?.intent)) return null;
  const product = strongProductMatch(products, message);
  if (!product) return null;

  const text = normalizeText(message || "");
  const asksPrice = /\b(precio|cuanto cuesta|cuanto vale|valor)\b/.test(text);
  const asksLink = /\b(link|enlace|comprar|comprarlo|lo quiero)\b/.test(text);
  const asksStock = /\b(stock|disponible|disponibilidad)\b/.test(text);

  const parts = [];
  if (asksPrice) parts.push(`${product.name} — ${product.price}.`);
  else parts.push(product.name + ".");

  if (asksStock) parts.push("No tengo stock en tiempo real verificado en este turno.");
  if (asksPrice || asksLink || asksStock) parts.push(product.url);

  return (asksPrice || asksLink || asksStock) ? parts.join(" ") : null;
}

function getTokenPlan(classification, message) {
  const c = classification?.extracted_context || {};
  const technicalSignals = [
    c.target_species, c.water_type, c.fishing_position, c.technique,
    c.weight_range, c.weight_grams, c.requested_attribute,
  ].filter((v) => v && v !== "unknown").length;

  const broad = classification?.intent === "pedir_recomendacion" && technicalSignals <= 1;
  return {
    maxProducts: broad ? 4 : (technicalSignals >= 2 ? 2 : 3),
    historyMessages: 2,
    historyCharsPerMessage: 280,
    learnedExamples: 2,
    salesMaxOutputTokens: 240,
    classifierMaxOutputTokens: 460,
  };
}

function compactHistory(history = [], limit = 2, maxChars = 280) {
  return history.slice(-limit).map((entry) => ({
    role: entry.role === "assistant" ? "assistant" : "user",
    content: String(entry.content || "").slice(0, maxChars),
  }));
}

function summarizeUsage(calls = []) {
  return calls.reduce((acc, item) => {
    acc.llm_calls += 1;
    acc.input_tokens += Number(item.input_tokens || 0);
    acc.cached_input_tokens += Number(item.cached_input_tokens || 0);
    acc.output_tokens += Number(item.output_tokens || 0);
    acc.total_tokens += Number(item.total_tokens || 0);
    return acc;
  }, { llm_calls: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 });
}

module.exports = {
  extractDeterministicSignals,
  staticConversationReply,
  deterministicCommerceReply,
  getTokenPlan,
  compactHistory,
  summarizeUsage,
  significantTokens,
  strongProductMatch,
};
