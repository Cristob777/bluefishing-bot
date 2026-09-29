const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function recordConversationEvent(event) {
  if (!client) return false;
  try {
    const { error } = await client.from("bot_events").insert({
      session_id: event.sessionId,
      channel: event.channel || "whatsapp",
      user_message: event.userMessage || "",
      bot_response: event.botResponse || null,
      intent: event.intent || null,
      products: event.products || [],
      latency_ms: event.latencyMs || null,
      handoff: Boolean(event.handoff),
    });
    if (error) throw error;
  } catch (error) {
    console.warn("[Telemetry] No se pudo registrar evento:", error.message);
  }
}

async function createHandoffRequest({ sessionId, phone, intent, message }) {
  if (!client) return;
  try {
    const { error } = await client.from("handoff_requests").insert({
      session_id: sessionId,
      phone: phone || null,
      intent: intent || null,
      last_message: message || "",
      status: "open",
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn("[Telemetry] No se pudo crear handoff:", error.message);
    return false;
  }
}

module.exports = { recordConversationEvent, createHandoffRequest };
