const DIRECT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /reveal\s+(the\s+)?(system|developer)\s+prompt/i,
  /show\s+(me\s+)?(your\s+)?(system|developer)\s+(prompt|instructions)/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /print\s+(your\s+)?environment\s+variables/i,
  /show\s+(your\s+)?api\s+key/i,
  /what\s+is\s+your\s+(api\s+key|system\s+prompt)/i,
];

function inspectUserInput(text) {
  const value = String(text || "");
  const matched = DIRECT_INJECTION_PATTERNS.find((re) => re.test(value));
  return {
    suspicious: Boolean(matched),
    reason: matched ? matched.source : null,
  };
}

function buildSecurityRedirect() {
  return "Puedo ayudarte con productos, compatibilidad y compras de BlueFishing. No puedo mostrar instrucciones internas, claves ni configuración del sistema.";
}

module.exports = { inspectUserInput, buildSecurityRedirect };
