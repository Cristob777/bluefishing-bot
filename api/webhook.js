const path = require("path");
const fs = require("fs");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "bluefishing123";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const USE_CLAUDE = !!ANTHROPIC_API_KEY;

const conversationHistory = {};
const processedMessages = new Set();

let catalogCache = null;
function getCatalogContent() {
  if (catalogCache) return catalogCache;
  try {
    const catalogPath = path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt");
    const raw = fs.readFileSync(catalogPath, "utf8");
    catalogCache = raw
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .join("\n");
    return catalogCache;
  } catch (e) {
    console.warn("[Webhook] No se pudo cargar catálogo:", e.message);
    return "(Catálogo no disponible. Recomienda ver https://bluefishing.cl)";
  }
}

const SYSTEM_PROMPT_BASE = `## ROL
Eres Matías, el asistente experto en pesca deportiva de Bluefishing.cl — la tienda especializada en pesca deportiva con las mejores marcas de Japón, EE.UU. y Chile.

Tu misión es ayudar a los clientes a elegir el equipo correcto según su tipo de pesca, nivel de experiencia y objetivo. Eres cercano y amigable, pero hablas con autoridad técnica real — como un pescador experimentado que también conoce el catálogo de la tienda.

## PERSONALIDAD
- Cercano, directo y apasionado por la pesca
- Usas lenguaje claro en español, sin tecnicismos innecesarios
- Nunca eres frío ni robótico
- Respondes de forma concisa

## LO QUE HACES
1. Asesoras sobre qué equipo necesita según tipo de pesca
2. Recomiendas productos del catálogo de Bluefishing.cl
3. Explicas diferencias entre productos
4. Educas sobre técnicas: spinning, jigging, popping, ajing, surfcasting, río
5. Armas combos completos (caña + carrete + línea + señuelo)

## LO QUE NO HACES
- No consultas stock — derivas al link del producto
- No inventas productos fuera del catálogo
- No garantizas precios

## ENVÍOS
"Hacemos envíos a todas las regiones de Chile. El envío se paga al momento de comprar. También puedes retirar en tienda sin costo. Despachamos vía Bluexpress, 2 días hábiles."

## STOCK Y PRECIOS
Para dar links de productos, debes generar la URL así:
1. Toma el nombre del producto (ej: "TSURINOYA Caña PROFLEX 632UL")
2. Pásalo a minúsculas, quita tildes y cambia espacios por guiones (ej: "tsurinoya-cana-proflex-632ul")
3. Añade la base: https://bluefishing.cl/producto/tsurinoya-cana-proflex-632ul/
"Para disponibilidad y precio: [Link generado]"

## CONOCIMIENTO DE PESCA

PESCA EN RÍO: Cañas UL-L 1.8-2.1m | Carretes 1000-2500 | PE 0.3-0.6 + fluoro 4-8lb | Señuelos: cucharillas, minnows, cranks

MAR DESDE COSTA: Cañas MH 2.7-3.2m | Carretes 3000-5000 | PE 1-2 | Vinilos, jigheads

SURFCASTING: Cañas 3m+, MH-H | Carretes 5000-6000 | PE 1.5-3

JIGGING: Cañas jigging PE 2-6 | Carretes alta capacidad | Jigs 50-300g

POPPING: Cañas H-XH 2.4-2.7m | Carretes 8000-14000 | PE 3-8

AJING: Cañas UL 1.8-2.1m | Carretes 1000-2000 | PE 0.3-0.4 | Vinilos 1-3g

## MARCAS
- YAMAGA BLANKS: Cañas japonesas premium
- BADFISH: Marca chilena, precio-calidad
- TSURINOYA: Entrada/media gama
- VARIVAS: Líneas japonesas premium
- DAIWA: Carretes japoneses
- BKK/DECOY: Anzuelos calidad
- MEIHO: Cajas organizadoras
- SALVIMAR: Buceo deportivo

## CATÁLOGO

`;

function getSystemPrompt() {
  return SYSTEM_PROMPT_BASE + getCatalogContent();
}

const MAX_WHATSAPP_MESSAGE = 4096;

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

async function getClaudeResponse(userMessage, from) {
  const { Anthropic } = require("@anthropic-ai/sdk");
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const client = new Anthropic({ apiKey: apiKey });

  if (!conversationHistory[from]) {
    conversationHistory[from] = [];
  }

  conversationHistory[from].push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  if (conversationHistory[from].length > 10) {
    conversationHistory[from] = conversationHistory[from].slice(-10);
  }

  const messages = conversationHistory[from].slice(0, -1).map((m) => ({
    role: m.role === "model" ? "assistant" : "user",
    content: m.parts[0]?.text || "",
  }));

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: getSystemPrompt(),
    messages: [...messages, { role: "user", content: userMessage }],
  });

  const responseText =
    response.content?.find((b) => b.type === "text")?.text || "";

  conversationHistory[from].push({
    role: "model",
    parts: [{ text: responseText }],
  });

  return responseText;
}

async function getGeminiResponse(userMessage, from) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  if (!conversationHistory[from]) {
    conversationHistory[from] = [];
  }

  conversationHistory[from].push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  if (conversationHistory[from].length > 10) {
    conversationHistory[from] = conversationHistory[from].slice(-10);
  }

  const chat = model.startChat({
    systemInstruction: getSystemPrompt(),
    history: conversationHistory[from].slice(0, -1),
  });

  const result = await chat.sendMessage(userMessage);
  const responseText = result.response.text();

  conversationHistory[from].push({
    role: "model",
    parts: [{ text: responseText }],
  });

  return responseText;
}

async function getAIResponse(userMessage, from) {
  if (USE_CLAUDE) return getClaudeResponse(userMessage, from);
  return getGeminiResponse(userMessage, from);
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

  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("[Webhook] POST recibido, body keys:", body ? Object.keys(body) : "null", "| object:", body?.object);

      const hasAI = GEMINI_API_KEY || ANTHROPIC_API_KEY;
      if (!hasAI || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        console.error("[Webhook] Faltan variables de entorno:", {
          GEMINI: !!GEMINI_API_KEY,
          ANTHROPIC: !!ANTHROPIC_API_KEY,
          WHATSAPP_TOKEN: !!WHATSAPP_TOKEN,
          PHONE_NUMBER_ID: !!PHONE_NUMBER_ID,
        });
        return res.status(500).json({ error: "Faltan variables de entorno en Vercel" });
      }

      // Formato real: body.entry[0].changes[0].value | Formato prueba Meta: body.value
      let value =
        body.entry?.[0]?.changes?.[0]?.value ||
        (body.field === "messages" ? body.value : null);
      const messages = value?.messages;

      if (messages && messages[0]) {
          const message = messages[0];
          const from = message.from;
          const messageId = message.id;

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

          if (message.type === "text") {
            const text = message.text.body;
            console.log("[Webhook] Texto:", text.substring(0, 50), "| from:", from);
            let response;
            try {
              response = await getAIResponse(text, from);
            } catch (err) {
              console.error("[Webhook] Error AI:", err.message);
              response = "Disculpa, hubo un problema al procesar. Intenta de nuevo en un momento.";
            }
            console.log("[Webhook] Enviando a WhatsApp to:", from);
            try {
              await sendWhatsAppMessage(from, response);
              console.log("[Webhook] Respuesta enviada OK");
            } catch (err) {
              console.error("[Webhook] FALLO ENVÍO WHATSAPP:", err.message);
              throw err;
            }
          } else {
            console.log("[Webhook] Mensaje ignorado (tipo no text):", message.type);
          }
      } else {
        console.log("[Webhook] POST sin mensajes procesables. body.object:", body?.object, "body.field:", body?.field);
      }

      return res.status(200).json({ status: "ok" });
    } catch (error) {
      console.error("[Webhook] Error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).send("Method not allowed");
};
