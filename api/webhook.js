const crypto = require("node:crypto");
const { sanitizeInput, handleMessage } = require("../lib/salesEngine");
const { claimInboundMessage, releaseInboundMessage, hasPersistentStore } = require("../lib/sessionStore");
const { pseudonymize, safeError } = require("../lib/logSanitizer");
const { allowMessage } = require("../lib/rateLimiter");
const { isConfigured: hasDatabase } = require("../lib/postgres");
const secretBox = require("../lib/secretBox");

// Dependencias inyectables para tests (routing multi-tenant por phone_number_id).
const deps = {
  store: null,
  fetchImpl: (...args) => fetch(...args),
  handleMessage,
  claimInboundMessage,
  releaseInboundMessage,
};
function getStore() {
  if (deps.store) return deps.store;
  if (!hasDatabase || !secretBox.isConfigured()) return null;
  deps.store = require("../lib/tenantStore").createStore();
  return deps.store;
}
const { trackContact } = require("../lib/contactStore");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v24.0";
const HAS_AI = Boolean(process.env.OPENAI_API_KEY);
const WEBHOOK_INGRESS_SECRET = process.env.WEBHOOK_INGRESS_SECRET;
const META_APP_SECRET = process.env.META_APP_SECRET;

const MAX_WHATSAPP_MESSAGE = 4096;
const MAX_MESSAGE_AGE_SECONDS = Number(process.env.MAX_MESSAGE_AGE_SECONDS || 300);

function assertProductionConfig(target) {
  const missing = [];
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!target.accessToken) missing.push(target.tenantId ? "tenant.access_token" : "WHATSAPP_TOKEN");
  if (!target.phoneNumberId) missing.push("PHONE_NUMBER_ID");
  return missing;
}

// Resuelve a qué tenant pertenece el mensaje según metadata.phone_number_id.
// Si no hay tenant, cae al número legado configurado por env (Blue Fishing actual).
async function resolveTarget(phoneNumberId) {
  const store = getStore();
  if (store && phoneNumberId) {
    const tenant = await store.findWhatsAppByPhoneNumberId(phoneNumberId);
    if (tenant) {
      return { tenantId: tenant.tenantId, phoneNumberId: tenant.phoneNumberId, accessToken: tenant.accessToken, appSecret: tenant.appSecret || META_APP_SECRET };
    }
  }
  if (PHONE_NUMBER_ID && (!phoneNumberId || String(phoneNumberId) === String(PHONE_NUMBER_ID))) {
    return { tenantId: null, phoneNumberId: PHONE_NUMBER_ID, accessToken: WHATSAPP_TOKEN, appSecret: META_APP_SECRET };
  }
  return null;
}

async function sendWhatsAppMessage(to, message, target) {
  const body = message.length > MAX_WHATSAPP_MESSAGE
    ? message.substring(0, MAX_WHATSAPP_MESSAGE - 20) + "\n\n(Respuesta recortada)"
    : message;

  const graphBase = String(process.env.GRAPH_API_BASE_URL || "https://graph.facebook.com").replace(/\/+$/, "");
  const url = `${graphBase}/${GRAPH_API_VERSION}/${target.phoneNumberId}/messages`;
  const response = await deps.fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "text",
      text: { body, preview_url: false },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[Webhook] WhatsApp API error:", response.status, data?.error?.code || "");
    throw new Error(data?.error?.message || `WhatsApp API HTTP ${response.status}`);
  }
  return data;
}

function verifyMetaSignature(req, appSecret) {
  if (!appSecret || !req.rawBody) return false;
  const signature = String(req.headers?.["x-hub-signature-256"] || "");
  if (!signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", appSecret)
    .update(req.rawBody)
    .digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  const ingress = req.query?.ingress;
  if (WEBHOOK_INGRESS_SECRET && ingress && ingress !== WEBHOOK_INGRESS_SECRET) {
    return res.status(403).send("Forbidden");
  }

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token) {
      if (VERIFY_TOKEN && token === VERIFY_TOKEN) return res.status(200).send(challenge);
      const store = getStore();
      try {
        if (store && await store.hasVerifyTokenHash(secretBox.sha256(token))) return res.status(200).send(challenge);
      } catch (error) {
        console.error("[Webhook] Verify lookup error:", safeError(error));
      }
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const body = req.body || {};
  const value =
    body.entry?.[0]?.changes?.[0]?.value ||
    (body.field === "messages" ? body.value : null);

  let target;
  try {
    target = await resolveTarget(value?.metadata?.phone_number_id);
  } catch (error) {
    console.error("[Webhook] Tenant lookup error:", safeError(error));
    return res.status(500).json({ error: "internal_error" });
  }

  if (!target) {
    // Número desconocido: no podemos validar la firma con ningún secreto conocido.
    // Se responde 200 sin procesar nada para que Meta no reintente.
    console.warn("[Webhook] phone_number_id sin tenant, ignorado");
    return res.status(200).json({ status: "ignored" });
  }

  if (!verifyMetaSignature(req, target.appSecret)) {
    console.warn("[SEC] Invalid Meta signature");
    return res.status(403).send("Forbidden");
  }

  const missing = assertProductionConfig(target);
  if (missing.length) {
    console.error("[Webhook] Configuración incompleta:", missing.join(", "));
    return res.status(500).json({ error: "Bot no configurado" });
  }

  let messageId = null;
  let claimed = false;

  try {
    const messages = value?.messages;

    // Meta también envía statuses/read/delivery events. Siempre responder 200.
    if (!messages?.[0]) {
      return res.status(200).json({ status: "ok" });
    }

    const message = messages[0];
    const from = message.from;
    messageId = message.id || null;

    const messageTimestamp = message.timestamp ? Number.parseInt(message.timestamp, 10) : null;
    if (messageTimestamp) {
      const age = Math.floor(Date.now() / 1000) - messageTimestamp;
      if (age > MAX_MESSAGE_AGE_SECONDS) {
        console.log(`[Webhook] Mensaje antiguo ignorado (${age}s)`);
        return res.status(200).json({ status: "ok" });
      }
    }

    claimed = await deps.claimInboundMessage(messageId, from);
    if (!claimed) {
      console.log("[Webhook] Duplicate ignored:", pseudonymize(messageId));
      return res.status(200).json({ status: "ok" });
    }

    if (message.type !== "text") {
      console.log("[Webhook] Tipo no soportado:", message.type);
      return res.status(200).json({ status: "ok" });
    }

    if (!allowMessage(String(from || ""))) {
      console.warn("[SEC] Rate limit exceeded", { sender: pseudonymize(from) });
      return res.status(200).json({ status: "ok" });
    }

    const sanitizedText = sanitizeInput(message.text?.body || "");
    if (!sanitizedText) {
      return res.status(200).json({ status: "ok" });
    }

    console.log("[Webhook] Message received", {
      message: pseudonymize(messageId),
      sender: pseudonymize(from),
      chars: sanitizedText.length,
      persistentStore: hasPersistentStore,
    });

    // CRM: registrar/actualizar contacto sin bloquear la respuesta (fail-safe).
    trackContact({
      channel: "whatsapp",
      externalId: from,
      name: value?.contacts?.[0]?.profile?.name,
      tenantId: target.tenantId || null,
    });

    const { reply } = await deps.handleMessage({
      sessionId: target.tenantId ? `wa:${target.tenantId}:${from}` : `wa:${from}`,
      tenantId: target.tenantId,
      text: sanitizedText,
      phone: from,
    });

    await sendWhatsAppMessage(from, reply, target);
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook] Error:", safeError(error));

    // Si fallamos antes de responder al cliente, liberamos el id para que
    // un retry legítimo de Meta pueda reprocesarse.
    if (claimed && messageId) {
      await deps.releaseInboundMessage(messageId);
    }

    return res.status(500).json({ error: "internal_error" });
  }
};

module.exports._test = { deps, resolveTarget, verifyMetaSignature };
