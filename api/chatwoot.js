// POST /chatwoot/webhook — Agent Bot de Chatwoot.
// Verificado contra el código de Chatwoot (lib/webhooks/trigger.rb, app/listeners/agent_bot_listener.rb):
//  - El bot recibe TODOS los message_created del inbox (entrantes, salientes, privados, conversaciones open),
//    por eso se filtra: solo message_type "incoming", no privado, conversación "pending" y sin asignar.
//  - Firma: X-Chatwoot-Signature = "sha256=" + HMAC_SHA256(secret, "<X-Chatwoot-Timestamp>.<raw body>").
//  - Si el webhook falla (o hace timeout) Chatwoot pasa la conversación pending a open, y reintenta en 429/500.
//    Por eso se responde 200 de inmediato y se procesa en segundo plano.
const crypto = require("node:crypto");
const { sanitizeInput, handleMessage } = require("../lib/salesEngine");
const { claimInboundMessage } = require("../lib/sessionStore");
const { createHandoffRequest } = require("../lib/telemetry");
const { pseudonymize, safeError } = require("../lib/logSanitizer");
const { allowMessage } = require("../lib/rateLimiter");
const { trackContact } = require("../lib/contactStore");

const MAX_SKEW_SECONDS = 300;
const HANDOFF_LABEL = "humano";
const HUMAN_REQUEST_RE = /\b(humano|una persona|persona real|vendedor(a)?|ejecutiv[oa]|asesor(a)?|hablar con alguien)\b/i;

const SOURCE_CHANNEL = {
  "Channel::Whatsapp": "whatsapp",
  "Channel::WebWidget": "web",
  "Channel::Instagram": "instagram",
  "Channel::FacebookPage": "facebook",
  "Channel::Api": "api",
  "Channel::Email": "email",
  "Channel::TwilioSms": "sms",
  "Channel::Telegram": "telegram",
};

function config() {
  return {
    enabled: process.env.CHATWOOT_ENABLED === "true",
    baseUrl: String(process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, ""),
    botToken: process.env.CHATWOOT_BOT_TOKEN || "",
    secret: process.env.CHATWOOT_WEBHOOK_SECRET || "",
    timeoutMs: Number(process.env.CHATWOOT_TIMEOUT_MS || 10000),
  };
}

function missingConfig(cfg) {
  const missing = [];
  if (!cfg.baseUrl) missing.push("CHATWOOT_BASE_URL");
  if (!cfg.botToken) missing.push("CHATWOOT_BOT_TOKEN");
  if (!cfg.secret) missing.push("CHATWOOT_WEBHOOK_SECRET");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  return missing;
}

function safeEqual(x, y) {
  const a = Buffer.from(String(x));
  const b = Buffer.from(String(y));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Chatwoot < v4.14 no firma los webhooks del Agent Bot (no existe agent_bots.secret ni X-Chatwoot-Signature).
// Para esas versiones install.sh registra la URL del bot con ?token=<CHATWOOT_WEBHOOK_SECRET> (URL interna,
// red "chatwoot", sin pasar por Traefik). Si llega cabecera de firma, se exige la firma HMAC.
function verifyRequest(req, secret, nowSeconds) {
  if (!secret) return false;
  if (req.headers["x-chatwoot-signature"]) return verifySignature(req, secret, nowSeconds);
  const token = req.query && typeof req.query.token === "string" ? req.query.token : "";
  return token.length > 0 && safeEqual(token, secret);
}

function verifySignature(req, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const signature = String(req.headers["x-chatwoot-signature"] || "");
  const timestamp = String(req.headers["x-chatwoot-timestamp"] || "");
  if (!secret || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody || ""));
  const expected = "sha256=" + crypto.createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Devuelve el evento normalizado si el bot debe responder; si no, { skip: motivo }.
function classifyEvent(payload) {
  if (!payload || payload.event !== "message_created") return { skip: "event" };
  if (payload.message_type !== "incoming" || payload.private) return { skip: "not_incoming" };
  const conv = payload.conversation || {};
  if (conv.status !== "pending") return { skip: "not_pending" };
  if (conv.meta?.assignee) return { skip: "assigned" };
  const accountId = Number(payload.account?.id ?? conv.account?.id);
  const conversationId = Number(conv.id);
  if (!Number.isInteger(accountId) || !Number.isInteger(conversationId)) return { skip: "ids" };
  const text = sanitizeInput(typeof payload.content === "string" ? payload.content : "");
  if (!text) return { skip: "empty" };
  const sender = payload.sender || conv.meta?.sender || {};
  return {
    accountId,
    conversationId,
    messageId: payload.id != null ? String(payload.id) : null,
    text,
    labels: Array.isArray(conv.labels) ? conv.labels.filter((l) => typeof l === "string") : [],
    contactId: sender.id != null ? String(sender.id) : null,
    contactName: typeof sender.name === "string" ? sender.name : null,
    contactPhone: typeof sender.phone_number === "string" ? sender.phone_number : null,
    sourceChannel: SOURCE_CHANNEL[conv.channel] || (typeof conv.channel === "string" ? conv.channel.slice(0, 40) : null),
  };
}

function createClient(cfg, fetchImpl = globalThis.fetch) {
  async function call(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const response = await fetchImpl(`${cfg.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", api_access_token: cfg.botToken },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Chatwoot API ${method} ${path.replace(/\d+/g, ":id")} -> ${response.status}`);
      return response.json().catch(() => ({}));
    } finally {
      clearTimeout(timer);
    }
  }
  const base = (a, c) => `/api/v1/accounts/${a}/conversations/${c}`;
  return {
    sendMessage: (a, c, content) => call("POST", `${base(a, c)}/messages`, { content, message_type: "outgoing", private: false }),
    setStatus: (a, c, status) => call("POST", `${base(a, c)}/toggle_status`, { status }),
    // La API de labels REEMPLAZA la lista completa: se envían las existentes + la nueva.
    setLabels: (a, c, labels) => call("POST", `${base(a, c)}/labels`, { labels }),
  };
}

async function handOff(client, ev, intent, alreadyQueued) {
  if (!alreadyQueued) {
    await createHandoffRequest({
      sessionId: `cw:${ev.conversationId}`,
      phone: ev.contactPhone,
      intent,
      message: ev.text,
    });
  }
  const labels = Array.from(new Set([...ev.labels, HANDOFF_LABEL]));
  await client.setLabels(ev.accountId, ev.conversationId, labels).catch((e) =>
    console.warn("[Chatwoot] No se pudo etiquetar:", safeError(e)));
  await client.setStatus(ev.accountId, ev.conversationId, "open");
}

async function processEvent(ev, client, deps = {}) {
  const engine = deps.handleMessage || handleMessage;
  const claim = deps.claimInboundMessage || claimInboundMessage;
  const conv = pseudonymize(ev.conversationId);
  try {
    if (ev.messageId && !(await claim(`cw:${ev.accountId}:${ev.messageId}`, null))) {
      console.log("[Chatwoot] Duplicate ignored", { conversation: conv });
      return "duplicate";
    }
    if (!allowMessage(`cw:${ev.conversationId}`) || (ev.contactId && !allowMessage(`cwc:${ev.contactId}`))) {
      console.warn("[SEC] Chatwoot rate limit exceeded", { conversation: conv });
      return "rate_limited";
    }
    if (ev.contactId) {
      trackContact({
        channel: "chatwoot",
        externalId: `${ev.accountId}-${ev.contactId}`,
        sessionId: `cw:${ev.conversationId}`,
        name: ev.contactName,
        phone: ev.contactPhone,
        sourceChannel: ev.sourceChannel,
      });
    }

    if (HUMAN_REQUEST_RE.test(ev.text)) {
      await client.sendMessage(ev.accountId, ev.conversationId,
        "¡Claro! Te comunico con una persona del equipo BlueFishing. En breve te responden por aquí.");
      await handOff(client, ev, "pide_humano", false);
      console.log("[Chatwoot] Handoff (explicit request)", { conversation: conv });
      return "handoff";
    }

    const { reply, debug } = await engine({ sessionId: `cw:${ev.conversationId}`, text: ev.text, phone: ev.contactPhone });
    if (reply) await client.sendMessage(ev.accountId, ev.conversationId, reply);
    if (debug?.next_action === "handoff_human") {
      // salesEngine ya insertó handoff_requests en este caso.
      await handOff(client, ev, debug.intent, true);
      console.log("[Chatwoot] Handoff (engine)", { conversation: conv });
      return "handoff";
    }
    return "replied";
  } catch (error) {
    console.error("[Chatwoot] Error procesando evento:", safeError(error), { conversation: conv });
    // Si el bot no pudo responder, la conversación pasa a humanos para no dejar al cliente sin respuesta.
    try { await client.setStatus(ev.accountId, ev.conversationId, "open"); } catch { /* noop */ }
    return "error";
  }
}

function makeHandler(deps = {}) {
  return async (req, res) => {
    const cfg = config();
    if (!cfg.enabled) return res.status(404).json({ error: "not_found" });
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

    const missing = missingConfig(cfg);
    if (missing.length) {
      console.error("[Chatwoot] Configuración incompleta:", missing.join(", "));
      return res.status(503).json({ error: "chatwoot_not_configured" });
    }
    if (!verifyRequest(req, cfg.secret)) {
      console.warn("[SEC] Invalid Chatwoot signature");
      return res.status(401).json({ error: "invalid_signature" });
    }

    const ev = classifyEvent(req.body);
    // Siempre 200 rápido: un error/timeout haría que Chatwoot abra la conversación o reintente.
    res.status(200).json({ status: ev.skip ? "ignored" : "accepted" });
    if (ev.skip) return undefined;

    const client = deps.client || createClient(cfg, deps.fetch);
    const job = processEvent(ev, client, deps);
    if (deps.onProcessed) job.then(deps.onProcessed);
    return undefined;
  };
}

module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
module.exports.verifySignature = verifySignature;
module.exports.verifyRequest = verifyRequest;
module.exports.classifyEvent = classifyEvent;
module.exports.createClient = createClient;
module.exports.processEvent = processEvent;
module.exports.HUMAN_REQUEST_RE = HUMAN_REQUEST_RE;
