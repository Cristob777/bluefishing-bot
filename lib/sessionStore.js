const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const memorySessions = new Map();
const memoryProcessed = new Set();

function defaultSession() {
  return { history: [], knownContext: null, lastClassification: null };
}

async function loadSession(sessionId) {
  if (!client) {
    return memorySessions.get(sessionId) || defaultSession();
  }

  const { data, error } = await client
    .from("bot_sessions")
    .select("history, known_context, last_classification")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) throw new Error(`Supabase loadSession: ${error.message}`);
  if (!data) return defaultSession();

  return {
    history: Array.isArray(data.history) ? data.history : [],
    knownContext: data.known_context || null,
    lastClassification: data.last_classification || null,
  };
}

async function saveSession(sessionId, session) {
  const row = {
    session_id: sessionId,
    history: session.history || [],
    known_context: session.knownContext || {},
    last_classification: session.lastClassification || {},
    updated_at: new Date().toISOString(),
  };

  if (!client) {
    memorySessions.set(sessionId, {
      history: row.history,
      knownContext: row.known_context,
      lastClassification: row.last_classification,
    });
    return;
  }

  const { error } = await client.from("bot_sessions").upsert(row, { onConflict: "session_id" });
  if (error) throw new Error(`Supabase saveSession: ${error.message}`);
}

async function claimInboundMessage(messageId, fromPhone) {
  if (!messageId) return true;

  if (!client) {
    if (memoryProcessed.has(messageId)) return false;
    memoryProcessed.add(messageId);
    if (memoryProcessed.size > 1000) {
      memoryProcessed.delete(memoryProcessed.values().next().value);
    }
    return true;
  }

  const { error } = await client.from("processed_whatsapp_messages").insert({
    message_id: messageId,
    from_phone: String(fromPhone || ""),
  });

  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`Supabase claimInboundMessage: ${error.message}`);
}

async function releaseInboundMessage(messageId) {
  if (!messageId) return;

  if (!client) {
    memoryProcessed.delete(messageId);
    return;
  }

  const { error } = await client
    .from("processed_whatsapp_messages")
    .delete()
    .eq("message_id", messageId);

  if (error) {
    console.warn("[SessionStore] No se pudo liberar message_id:", error.message);
  }
}

module.exports = {
  loadSession,
  saveSession,
  claimInboundMessage,
  releaseInboundMessage,
  hasPersistentStore: Boolean(client),
};
