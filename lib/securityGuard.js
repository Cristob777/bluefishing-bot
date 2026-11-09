const DIRECT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /ignora\s+(todas\s+)?(las\s+)?instrucciones\s+(anteriores|previas)/i,
  /reveal\s+(the\s+)?(system|developer)\s+prompt/i,
  /show\s+(me\s+)?(your\s+)?(system|developer)\s+(prompt|instructions)/i,
  /muestra(me)?\s+(tu|el)\s+(prompt|mensaje)\s+(del\s+)?sistema/i,
  /revela\s+(tu|el)\s+(prompt|mensaje)\s+(del\s+)?sistema/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /print\s+(your\s+)?environment\s+variables/i,
  /muestra(me)?\s+(tus\s+)?variables\s+de\s+entorno/i,
  /show\s+(your\s+)?api\s+key/i,
  /muestra(me)?\s+(tu\s+)?api\s*key/i,
  /what\s+is\s+your\s+(api\s+key|system\s+prompt)/i,
];

function inspectUserInput(text) {
  const value = String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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
