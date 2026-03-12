const fs = require("fs");
const path = require("path");

const EXTRACTOR_PROMPT = fs.readFileSync(
  path.join(__dirname, "..", "prompts", "intent-slot-extractor.xml"),
  "utf8"
);

const CONTEXT_FIELDS = [
  "product_type",
  "subcategory",
  "water_type",
  "fishing_position",
  "target_species",
  "technique",
  "lure_type",
  "action_type",
  "weight_range",
  "weight_grams",
  "rod_setup",
  "budget_range",
  "brand_preference",
  "experience_level",
  "purchase_intent_level",
  "requested_attribute",
];

function emptyContext() {
  return CONTEXT_FIELDS.reduce((acc, field) => {
    acc[field] = "unknown";
    return acc;
  }, {});
}

function decodeXml(text) {
  return (text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeXml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getTagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function getSection(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1] : "";
}

function getListValues(xml, sectionTag) {
  const section = getSection(xml, sectionTag);
  if (!section) return [];
  return [...section.matchAll(/<field>([\s\S]*?)<\/field>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter(Boolean);
}

function normalizeFieldValue(value) {
  return value && value.trim() ? value.trim() : "unknown";
}

function normalizeConfidence(value) {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeBoolean(value) {
  return String(value).trim().toLowerCase() === "true";
}

function mergeContext(previousContext = {}, newContext = {}) {
  const merged = emptyContext();
  for (const field of CONTEXT_FIELDS) {
    const currentValue = normalizeFieldValue(newContext[field] || "");
    const previousValue = normalizeFieldValue(previousContext[field] || "");
    merged[field] = currentValue !== "unknown" ? currentValue : previousValue;
  }
  return merged;
}

function computeMissingFields(intent, context) {
  const missingCritical = [];
  const missingSecondary = [];

  if (intent === "postventa") {
    return { missingCritical, missingSecondary };
  }

  if (context.product_type === "unknown" && (intent === "pedir_recomendacion" || intent === "consulta_ambigua")) {
    missingCritical.push("product_type");
  }

  if (context.product_type === "señuelo") {
    if (context.water_type === "unknown") missingCritical.push("water_type");
    if (context.fishing_position === "unknown") missingCritical.push("fishing_position");
  }

  const secondaryCandidates = [
    "target_species",
    "lure_type",
    "weight_range",
    "weight_grams",
    "rod_setup",
    "budget_range",
    "brand_preference",
    "experience_level",
  ];

  for (const field of secondaryCandidates) {
    if (context[field] === "unknown") {
      missingSecondary.push(field);
    }
  }

  return { missingCritical, missingSecondary };
}

function chooseQuestion(intent, context, missingCritical, fallbackQuestion) {
  if (!missingCritical.length) return "";

  if (context.product_type === "señuelo" && context.water_type === "unknown") {
    return "¿Es para mar, río o lago?";
  }

  if (context.product_type === "señuelo" && context.fishing_position === "unknown") {
    return "¿Vas a pescar desde orilla, roca, playa o bote?";
  }

  if (missingCritical.includes("product_type")) {
    return "¿Buscas señuelo, caña, carrete o línea?";
  }

  return fallbackQuestion || "¿Qué dato te falta por definir para recomendarte bien?";
}

function decideNextAction(intent, ambiguityFlag, missingCritical) {
  if (intent === "postventa") return "handoff_human";
  if (missingCritical.length > 0) return "ask_one_critical_question";
  if (ambiguityFlag && intent === "consulta_ambigua") return "ask_one_critical_question";
  return "recommend_now";
}

function parseClassificationXml(xml, previousContext = {}) {
  const extractedSection = getSection(xml, "extracted_context");
  const extractedContext = {};

  for (const field of CONTEXT_FIELDS) {
    extractedContext[field] = normalizeFieldValue(getTagValue(extractedSection, field));
  }

  const mergedContext = mergeContext(previousContext, extractedContext);
  const intent = getTagValue(xml, "intent") || "consulta_ambigua";
  const confidence = normalizeConfidence(getTagValue(xml, "confidence"));
  const ambiguityFlag = normalizeBoolean(getTagValue(xml, "ambiguity_flag"));
  const reasoningSummary = getTagValue(xml, "reasoning_summary");
  const fallbackQuestion = getTagValue(xml, "next_best_question");

  const { missingCritical, missingSecondary } = computeMissingFields(intent, mergedContext);
  const nextAction = decideNextAction(intent, ambiguityFlag, missingCritical);
  const nextBestQuestion = nextAction === "ask_one_critical_question"
    ? chooseQuestion(intent, mergedContext, missingCritical, fallbackQuestion)
    : "";

  return {
    intent,
    confidence,
    ambiguity_flag: ambiguityFlag,
    extracted_context: mergedContext,
    missing_critical_fields: missingCritical,
    missing_secondary_fields: missingSecondary,
    next_action: nextAction,
    next_best_question: nextBestQuestion,
    reasoning_summary: reasoningSummary,
    raw_xml: xml,
  };
}

function buildKnownContextXml(context = {}) {
  const lines = CONTEXT_FIELDS
    .map((field) => `    <${field}>${escapeXml(context[field] || "unknown")}</${field}>`)
    .join("\n");

  return `<known_context>\n${lines}\n  </known_context>`;
}

function buildHistoryXml(history = []) {
  if (!history.length) return "<recent_history></recent_history>";

  const items = history
    .slice(-6)
    .map((entry) => {
      const role = entry.role === "assistant" ? "assistant" : "user";
      return `    <message role="${role}">${escapeXml(entry.content)}</message>`;
    })
    .join("\n");

  return `<recent_history>\n${items}\n  </recent_history>`;
}

async function classifyIntentAndContext({ message, knownContext, history = [], generateAIText }) {
  const runtimeInput = [
    "<runtime_input>",
    "  Analiza el mensaje actual considerando el contexto previo conocido.",
    "  Devuelve solo XML valido con la estructura de <classification_result>.",
    buildKnownContextXml(knownContext || emptyContext()),
    buildHistoryXml(history),
    `  <current_message>${escapeXml(message)}</current_message>`,
    "</runtime_input>",
  ].join("\n");

  const xml = await generateAIText({
    systemPrompt: "Clasifica la consulta y devuelve solo XML valido con la estructura pedida.",
    userMessage: `${EXTRACTOR_PROMPT}\n\n${runtimeInput}`,
    maxTokens: 900,
  });

  return parseClassificationXml(xml, knownContext);
}

module.exports = {
  emptyContext,
  classifyIntentAndContext,
};
