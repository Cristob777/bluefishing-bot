const { sanitizeInput, handleMessage } = require("../lib/salesEngine");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const HAS_AI = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// Endpoint solo para /admin → pestaña "Chat de prueba". A diferencia de
// api/chat.js (el widget público), esto exige una sesión de Supabase válida
// y devuelve el detalle de clasificación/productos que el equipo necesita
// para poder corregir una respuesta con criterio.
async function getAuthenticatedUser(req) {
  if (!supabase) return null;
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!HAS_AI || !supabase) {
    return res.status(500).json({ error: "Bot o Supabase no configurado" });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: "No autorizado" });
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

    // Namespace separado ("train:") para que una conversación de prueba
    // nunca comparta sesión con un cliente real de WhatsApp o del widget.
    const { reply, debug } = await handleMessage({ sessionId: `train:${sessionId}`, text: sanitizedText });

    return res.status(200).json({ reply, debug, userMessage: sanitizedText });
  } catch (error) {
    console.error("[AdminChat] Error:", error);
    return res.status(500).json({ error: "Hubo un problema procesando tu mensaje" });
  }
};
