// POST /chat — chat web del widget. Usa el mismo motor que WhatsApp
// (salesEngine: securityGuard, bot_sessions, bot_events, handoff, OpenAI).
const { sanitizeInput, handleMessage } = require("../lib/salesEngine");
const { pseudonymize, safeError } = require("../lib/logSanitizer");
const { allowMessage } = require("../lib/rateLimiter");
const { trackContact } = require("../lib/contactStore");

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;

// Orígenes permitidos (coma-separados). Sin ALLOWED_ORIGIN, el chat web queda deshabilitado.
function allowedOrigins() {
  return (process.env.ALLOWED_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
}

// Empresa del widget: /chat?k=<widget_key>. Sin clave = cuenta del operador (ALLOWED_ORIGIN).
const KEY_RE = /^[a-f0-9]{24}$/;
const tenantCache = new Map();
async function tenantForKey(key) {
  if (!key || !KEY_RE.test(key)) return null;
  const hit = tenantCache.get(key);
  if (hit && hit.t > Date.now() - 60000) return hit.v;
  let v = null;
  try {
    const { query, isConfigured } = require("../lib/postgres");
    if (isConfigured) {
      const r = await query("select id, widget_origins from tenants where widget_key=$1", [key]);
      v = r.rows[0] ? { id: r.rows[0].id, origins: r.rows[0].widget_origins || [] } : null;
    }
  } catch (error) { console.error("[Chat] tenant lookup failed:", safeError(error)); }
  tenantCache.set(key, { v, t: Date.now() });
  return v;
}

function applyCors(req, res, tenant = null) {
  const origin = req.headers.origin;
  const list = tenant ? tenant.origins : allowedOrigins();
  const allowed = Boolean(origin) && list.includes(origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  res.setHeader("Vary", "Origin");
  return allowed;
}

// IP del cliente: el proxy (Caddy/Traefik) agrega la IP real al final de X-Forwarded-For.
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff[xff.length - 1] || req.socket?.remoteAddress || "unknown";
}

module.exports = async (req, res) => {
  const key = String(req.query?.k || "");
  const tenant = key ? await tenantForKey(key) : null;
  if (key && !tenant) { applyCors(req, res, { origins: [] }); return res.status(403).json({ error: "unknown_widget" }); }
  const originAllowed = applyCors(req, res, tenant);

  if (req.method === "OPTIONS") {
    res.statusCode = originAllowed ? 204 : 403;
    return res.end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // Solo navegadores desde dominios autorizados.
  if (!originAllowed) return res.status(403).json({ error: "forbidden_origin" });
  if (!process.env.OPENAI_API_KEY) {
    console.error("[Chat] Configuración incompleta: OPENAI_API_KEY");
    return res.status(503).json({ error: "bot_unavailable" });
  }

  const body = req.body || {};
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: "invalid_session" });

  const ip = clientIp(req);
  if (!allowMessage(`webip:${ip}`) || !allowMessage(`web:${sessionId}`)) {
    console.warn("[SEC] Web rate limit exceeded", { ip: pseudonymize(ip), session: pseudonymize(sessionId) });
    return res.status(429).json({ error: "rate_limited" });
  }

  const text = sanitizeInput(typeof body.message === "string" ? body.message : "");
  if (!text) return res.status(400).json({ error: "empty_message" });

  try {
    console.log("[Chat] Message received", { session: pseudonymize(sessionId), chars: text.length });
    trackContact({ channel: "web", externalId: sessionId, tenantId: tenant?.id || null });
    const { reply } = await handleMessage(tenant ? { sessionId: `web:${tenant.id}:${sessionId}`, tenantId: tenant.id, text } : { sessionId: `web:${sessionId}`, text });
    return res.status(200).json({ reply });
  } catch (error) {
    console.error("[Chat] Error:", safeError(error));
    return res.status(500).json({ error: "internal_error" });
  }
};

module.exports.clientIp = clientIp;
module.exports.SESSION_ID_RE = SESSION_ID_RE;
module.exports._tenantCache = tenantCache;
