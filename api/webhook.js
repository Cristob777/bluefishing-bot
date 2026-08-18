const { sanitizeInput, handleMessage } = require("../lib/salesEngine");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "bluefishing123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const HAS_AI = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

const MAX_WHATSAPP_MESSAGE = 4096;

const processedMessages = new Set();

async function sendWhatsAppMessage(to, message) {
  const body = message.length > MAX_WHATSAPP_MESSAGE
    ? message.substring(0, MAX_WHATSAPP_MESSAGE - 20) + "\n\n(Respuesta recortada)"
    : message;
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to),
      type: "text",
      text: { body },
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("[Webhook] WhatsApp API error:", response.status, data);
    throw new Error(data.error?.message || "WhatsApp API falló");
  }
  return data;
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const body = req.body;
    console.log("[Webhook] POST recibido, body keys:", body ? Object.keys(body) : "null", "| object:", body?.object);

    if (!HAS_AI || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      console.error("[Webhook] Faltan variables de entorno:", {
        HAS_AI,
        WHATSAPP_TOKEN: !!WHATSAPP_TOKEN,
        PHONE_NUMBER_ID: !!PHONE_NUMBER_ID,
      });
      return res.status(500).json({ error: "Faltan variables de entorno en Vercel" });
    }

    const value =
      body.entry?.[0]?.changes?.[0]?.value ||
      (body.field === "messages" ? body.value : null);
    const messages = value?.messages;

    if (!messages || !messages[0]) {
      console.log("[Webhook] POST sin mensajes procesables. body.object:", body?.object, "body.field:", body?.field);
      return res.status(200).json({ status: "ok" });
    }

    const message = messages[0];
    const from = message.from;
    const messageId = message.id;
    const messageTimestamp = message.timestamp ? parseInt(message.timestamp, 10) : null;

    if (messageTimestamp) {
      const now = Math.floor(Date.now() / 1000);
      if (now - messageTimestamp > 300) {
        console.log(`[Webhook] Mensaje antiguo ignorado (${now - messageTimestamp}s de retraso)`);
        return res.status(200).json({ status: "ok" });
      }
    }

    if (messageId && processedMessages.has(messageId)) {
      console.log("[Webhook] Mensaje duplicado ignorado:", messageId);
      return res.status(200).json({ status: "ok" });
    }
    if (messageId) {
      processedMessages.add(messageId);
      if (processedMessages.size > 500) {
        const iterator = processedMessages.values();
        processedMessages.delete(iterator.next().value);
      }
    }

    console.log("[Webhook] Mensaje de", from, "tipo:", message.type);

    if (message.type !== "text") {
      console.log("[Webhook] Mensaje ignorado (tipo no text):", message.type);
      return res.status(200).json({ status: "ok" });
    }

    const text = message.text.body;
    const sanitizedText = sanitizeInput(text);
    if (!sanitizedText) {
      return res.status(200).json({ status: "ok" });
    }

    console.log("[Webhook] Texto:", sanitizedText.substring(0, 50), "| from:", from);

    const { reply: response } = await handleMessage({ sessionId: `wa:${from}`, text: sanitizedText });

    console.log("[Webhook] Enviando a WhatsApp to:", from);
    await sendWhatsAppMessage(from, response);
    console.log("[Webhook] Respuesta enviada OK");

    return res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
