const crypto = require("node:crypto");

const SECRET_ENV_NAMES = [
  "OPENAI_API_KEY","WHATSAPP_TOKEN","META_APP_SECRET","VERIFY_TOKEN","WEBHOOK_INGRESS_SECRET",
  "DATABASE_URL","POSTGRES_PASSWORD","WC_CONSUMER_KEY","WC_CONSUMER_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY","HEALTHCHECK_TOKEN","LOG_HASH_KEY",
];

function redactSecrets(value) {
  let text = String(value ?? "");
  for (const name of SECRET_ENV_NAMES) {
    const secret = process.env[name];
    if (secret && secret.length >= 4) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi, "Bearer [REDACTED]")
    .replace(/(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]");
}

function safeError(error) {
  if (!error) return "unknown_error";
  return redactSecrets(error.message || String(error)).slice(0, 500);
}

function pseudonymize(value) {
  const key = process.env.LOG_HASH_KEY;
  if (!key) return "anonymous";
  return crypto.createHmac("sha256", key).update(String(value || "")).digest("hex").slice(0, 16);
}

module.exports = { redactSecrets, safeError, pseudonymize, SECRET_ENV_NAMES };
