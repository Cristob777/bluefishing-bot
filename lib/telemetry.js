const { query, isConfigured: hasPostgres } = require("./postgres");
const { safeError } = require("./logSanitizer");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (!hasPostgres && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function recordConversationEvent(event) {
  try {
    if (hasPostgres) {
      await query(
        `insert into bot_events(session_id,channel,user_message,bot_response,intent,products,latency_ms,handoff)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [
          event.sessionId,
          event.channel || "whatsapp",
          event.userMessage || "",
          event.botResponse || null,
          event.intent || null,
          JSON.stringify(event.products || []),
          event.latencyMs || null,
          Boolean(event.handoff),
        ]
      );
      return true;
    }

    if (supabase) {
      const { error } = await supabase.from("bot_events").insert({
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
      return true;
    }
  } catch (error) {
    console.warn("[Telemetry] No se pudo registrar evento:", safeError(error));
  }
  return false;
}

async function createHandoffRequest({ sessionId, phone, intent, message }) {
  try {
    if (hasPostgres) {
      await query(
        "insert into handoff_requests(session_id,phone,intent,last_message,status) values ($1,$2,$3,$4,'open')",
        [sessionId, phone || null, intent || null, message || ""]
      );
      return true;
    }

    if (supabase) {
      const { error } = await supabase.from("handoff_requests").insert({
        session_id: sessionId,
        phone: phone || null,
        intent: intent || null,
        last_message: message || "",
        status: "open",
      });
      if (error) throw error;
      return true;
    }
  } catch (error) {
    console.warn("[Telemetry] No se pudo crear handoff:", safeError(error));
  }
  return false;
}

module.exports = { recordConversationEvent, createHandoffRequest };
