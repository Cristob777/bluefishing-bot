const { sanitizeInput, handleMessage } = require("../lib/salesEngine");

const HAS_AI = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

// Dominios desde donde el widget puede llamar a este endpoint. Separar por
// comas si hay más de uno (ej. producción + www + un ambiente de pruebas).
// Sin esto configurado, el navegador bloquea la llamada por CORS — es la
// protección real, no la URL del endpoint en sí.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!HAS_AI) {
    return res.status(500).json({ error: "Bot no configurado" });
  }

  try {
    const body = req.body || {};
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 100) : "";
    const message = typeof body.message === "string" ? body.message : "";

    if (!sessionId) {
      return res.status(400).json({ error: "Falta sessionId" });
    }

    const sanitizedText = sanitizeInput(message);
    if (!sanitizedText) {
      return res.status(400).json({ error: "Mensaje vacío" });
    }

    const { reply } = await handleMessage({ sessionId: `web:${sessionId}`, text: sanitizedText });

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("[Chat] Error:", error);
    return res.status(500).json({ error: "Hubo un problema procesando tu mensaje" });
  }
};
