const { sanitizeInput, handleMessage } = require("../lib/salesEngine");
const { claimInboundMessage, releaseInboundMessage, hasPersistentStore } = require("../lib/sessionStore");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v24.0";
const HAS_AI = Boolean(process.env.OPENAI_API_KEY);
const WEBHOOK_INGRESS_SECRET = process.env.WEBHOOK_INGRESS_SECRET;

const MAX_WHATSAPP_MESSAGE = 4096;
const MAX_MESSAGE_AGE_SECONDS = Number(process.env.MAX_MESSAGE_AGE_SECONDS || 300);

function assertProductionConfig() {
  const missing = [];
  if (!VERIFY_TOKEN) missing.push("VERIFY_TOKEN");
  if (!WHATSAPP_TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!PHONE_NUMBER_ID) missing.push("PHONE_NUMBER_ID");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!WEBHOOK_INGRESS_SECRET) missing.push("WEBHOOK_INGRESS_SECRET");
  return missing;
}

async function sendWhatsAppMessage(to, message) {
  const body = message.length > MAX_WHATSAPP_MESSAGE
    ? message.substring(0, MAX_WHATSAPP_MESSAGE - 20) + "\n\n(Respuesta recortada)"
    : message;

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
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
    console.error("[Webhook] WhatsApp API error:", response.status, data);
    throw new Error(data?.error?.message || `WhatsApp API HTTP ${response.status}`);
  }
  return data;
}

module.exports = async (req, res) => {
  const ingress = req.query?.ingress;
  if (WEBHOOK_INGRESS_SECRET && ingress !== WEBHOOK_INGRESS_SECRET) {
    return res.status(403).send("Forbidden");
  }

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (VERIFY_TOKEN && mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const missing = assertProductionConfig();
  if (missing.length) {
    console.error("[Webhook] Configuración incompleta:", missing.join(", "));
    return res.status(500).json({ error: "Bot no configurado" });
  }

  let messageId = null;
  let claimed = false;

  try {
    const body = req.body || {};
    const value =
      body.entry?.[0]?.changes?.[0]?.value ||
      (body.field === "messages" ? body.value : null);
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

    claimed = await claimInboundMessage(messageId, from);
    if (!claimed) {
      console.log("[Webhook] Mensaje duplicado ignorado:", messageId);
      return res.status(200).json({ status: "ok" });
    }

    if (message.type !== "text") {
      console.log("[Webhook] Tipo no soportado:", message.type);
      return res.status(200).json({ status: "ok" });
    }

    const sanitizedText = sanitizeInput(message.text?.body || "");
    if (!sanitizedText) {
      return res.status(200).json({ status: "ok" });
    }

    console.log("[Webhook] Mensaje recibido", {
      messageId,
      from,
      chars: sanitizedText.length,
      persistentStore: hasPersistentStore,
    });

    const { reply } = await handleMessage({
      sessionId: `wa:${from}`,
      text: sanitizedText,
      phone: from,
    });

    await sendWhatsAppMessage(from, reply);
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook] Error:", error);

    // Si fallamos antes de responder al cliente, liberamos el id para que
    // un retry legítimo de Meta pueda reprocesarse.
    if (claimed && messageId) {
      await releaseInboundMessage(messageId);
    }

    return res.status(500).json({ error: "internal_error" });
  }
};
