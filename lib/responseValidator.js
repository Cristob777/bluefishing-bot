const { contracts } = require("./agentContract");

const GENERAL_ALLOWED_URLS = new Set([
  "https://bluefishing.cl",
  "https://www.bluefishing.cl",
]);

function normalizeUrl(value) {
  return String(value || "").replace(/[),.;!?]+$/g, "").replace(/\/$/, "");
}

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => normalizeUrl(m[0]));
}

function extractClpAmounts(text) {
  return [...String(text || "").matchAll(/\$\s*([0-9][0-9\.\s]{2,})/g)]
    .map((m) => Number(m[1].replace(/[^0-9]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parseProductPrice(price) {
  const n = Number(String(price || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hasSecretLeak(text) {
  const value = String(text || "");
  return /(OPENAI_API_KEY|WHATSAPP_TOKEN|META_APP_SECRET|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|system prompt|agent contract)/i.test(value);
}

function hasUnsupportedStockClaim(text) {
  return /\b(hay stock|tenemos stock|queda stock|disponible en stock|stock disponible)\b/i.test(String(text || ""));
}

function validateResponse({ response, products = [], userMessage = "" }) {
  const violations = [];
  const retrievedUrls = new Set(products.map((p) => normalizeUrl(p.url)).filter(Boolean));
  const retrievedPrices = new Set(products.map((p) => parseProductPrice(p.price)).filter(Boolean));
  const userPrices = new Set(extractClpAmounts(userMessage));

  if (contracts.response.validation.secret_or_prompt_leakage_is_forbidden && hasSecretLeak(response)) {
    violations.push("secret_or_prompt_leak");
  }

  for (const url of extractUrls(response)) {
    if (!retrievedUrls.has(url) && !GENERAL_ALLOWED_URLS.has(url)) {
      violations.push(`unretrieved_url:${url}`);
    }
  }

  for (const amount of extractClpAmounts(response)) {
    if (!retrievedPrices.has(amount) && !userPrices.has(amount)) {
      violations.push(`unsupported_price:${amount}`);
    }
  }

  if (contracts.response.validation.stock_claims_require_explicit_live_stock_evidence && hasUnsupportedStockClaim(response)) {
    violations.push("unsupported_stock_claim");
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

function buildDeterministicFallback(products = []) {
  if (!products.length) {
    return "No encontré un producto compatible con suficiente evidencia para recomendarte uno con seguridad. Puedes revisar el catálogo completo en https://bluefishing.cl.";
  }

  const picks = products.slice(0, 2).map((p) => {
    const reason = (p.scoreReasons || []).filter((r) => !["product_type", "name_tokens"].includes(r)).slice(0, 2);
    const reasonText = reason.length ? ` Compatibilidad: ${reason.join(", ")}.` : "";
    return `${p.name} — ${p.price}. ${p.url}.${reasonText}`;
  });

  return picks.join("\n");
}

module.exports = {
  validateResponse,
  buildDeterministicFallback,
  extractUrls,
  extractClpAmounts,
};
