const { query, isConfigured: hasPostgres } = require("./postgres");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (!hasPostgres && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const memorySessions = new Map();
const memoryProcessed = new Set();

function defaultSession() {
  return { history: [], knownContext: null, lastClassification: null };
}

async function loadSession(sessionId) {
  if (hasPostgres) {
    const { rows } = await query(
      "select history, known_context, last_classification from bot_sessions where session_id = $1 limit 1",
      [sessionId]
    );
    if (!rows[0]) return defaultSession();
    return {
      history: Array.isArray(rows[0].history) ? rows[0].history : [],
      knownContext: rows[0].known_context || null,
      lastClassification: rows[0].last_classification || null,
    };
  }

  if (supabase) {
    const { data, error } = await supabase
      .from("bot_sessions")
      .select("history, known_context, last_classification")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (error) throw new Error("Supabase loadSession: " + error.message);
    if (!data) return defaultSession();
    return {
      history: Array.isArray(data.history) ? data.history : [],
      knownContext: data.known_context || null,
      lastClassification: data.last_classification || null,
    };
  }

  return memorySessions.get(sessionId) || defaultSession();
}

async function saveSession(sessionId, session) {
  const history = session.history || [];
  const knownContext = session.knownContext || {};
  const lastClassification = session.lastClassification || {};

  if (hasPostgres) {
    await query(
      `insert into bot_sessions(session_id, history, known_context, last_classification, updated_at)
       values ($1,$2::jsonb,$3::jsonb,$4::jsonb,now())
       on conflict(session_id) do update set
         history=excluded.history,
         known_context=excluded.known_context,
         last_classification=excluded.last_classification,
         updated_at=now()`,
      [sessionId, JSON.stringify(history), JSON.stringify(knownContext), JSON.stringify(lastClassification)]
    );
    return;
  }

  if (supabase) {
    const { error } = await supabase.from("bot_sessions").upsert({
      session_id: sessionId,
      history,
      known_context: knownContext,
      last_classification: lastClassification,
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id" });
    if (error) throw new Error("Supabase saveSession: " + error.message);
    return;
  }

  memorySessions.set(sessionId, { history, knownContext, lastClassification });
}

async function claimInboundMessage(messageId, fromPhone) {
  if (!messageId) return true;

  if (hasPostgres) {
    const result = await query(
      "insert into processed_whatsapp_messages(message_id, from_phone) values ($1,$2) on conflict do nothing",
      [messageId, String(fromPhone || "")]
    );
    return result.rowCount === 1;
  }

  if (supabase) {
    const { error } = await supabase.from("processed_whatsapp_messages").insert({
      message_id: messageId,
      from_phone: String(fromPhone || ""),
    });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error("Supabase claimInboundMessage: " + error.message);
  }

  if (memoryProcessed.has(messageId)) return false;
  memoryProcessed.add(messageId);
  if (memoryProcessed.size > 1000) memoryProcessed.delete(memoryProcessed.values().next().value);
  return true;
}

async function releaseInboundMessage(messageId) {
  if (!messageId) return;
  if (hasPostgres) {
    await query("delete from processed_whatsapp_messages where message_id=$1", [messageId]);
    return;
  }
  if (supabase) {
    await supabase.from("processed_whatsapp_messages").delete().eq("message_id", messageId);
    return;
  }
  memoryProcessed.delete(messageId);
}

module.exports = {
  loadSession,
  saveSession,
  claimInboundMessage,
  releaseInboundMessage,
  hasPersistentStore: hasPostgres || Boolean(supabase),
  persistenceBackend: hasPostgres ? "postgres" : (supabase ? "supabase" : "memory"),
};