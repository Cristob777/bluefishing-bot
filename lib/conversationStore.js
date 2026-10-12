// Persistencia de contactos/conversaciones/mensajes (CRM PR1).
// Fail-safe: nunca lanza; si faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY es no-op.
// Tablas: supabase/migrations/20261012_crm_conversations.sql

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Una conversación se reutiliza si tuvo actividad en las últimas 24 h.
const CONVERSATION_IDLE_MS = 24 * 60 * 60 * 1000;

let client = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function _setClient(c) { client = c; } // solo para tests

function isEnabled() { return !!client; }

async function upsertContact({ channel, externalId, name = null, phone = null }) {
  if (!client || !channel || !externalId) return null;
  try {
    const row = { channel, external_id: String(externalId), last_seen_at: new Date().toISOString() };
    if (name) row.name = name;
    if (phone) row.phone = phone;
    const { data, error } = await client
      .from("contacts")
      .upsert(row, { onConflict: "channel,external_id" })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error("[conversationStore] upsertContact:", err.message || err);
    return null;
  }
}

async function getOrCreateConversation({ contactId, channel }) {
  if (!client || !contactId) return null;
  try {
    const since = new Date(Date.now() - CONVERSATION_IDLE_MS).toISOString();
    const { data: found, error: findErr } = await client
      .from("conversations")
      .select("id, status")
      .eq("contact_id", contactId)
      .neq("status", "closed")
      .gte("last_message_at", since)
      .order("last_message_at", { ascending: false })
      .limit(1);
    if (findErr) throw findErr;
    if (found && found[0]) return found[0];
    const { data, error } = await client
      .from("conversations")
      .insert({ contact_id: contactId, channel })
      .select("id, status")
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error("[conversationStore] getOrCreateConversation:", err.message || err);
    return null;
  }
}

async function logMessage({ conversationId, direction, role, content, metadata = {} }) {
  if (!client || !conversationId || !content) return null;
  try {
    const { error } = await client.from("messages").insert({
      conversation_id: conversationId, direction, role, content: String(content), metadata,
    });
    if (error) throw error;
    await client.from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);
    return true;
  } catch (err) {
    console.error("[conversationStore] logMessage:", err.message || err);
    return null;
  }
}

// Registra un turno completo (entrada + respuesta). Pensado para llamarse sin await.
async function recordExchange({ channel, externalId, name, phone, userText, botReply, metadata = {} }) {
  if (!client) return null;
  try {
    const contact = await upsertContact({ channel, externalId, name, phone });
    if (!contact) return null;
    const conv = await getOrCreateConversation({ contactId: contact.id, channel });
    if (!conv) return null;
    await logMessage({ conversationId: conv.id, direction: "in", role: "user", content: userText, metadata });
    if (botReply) {
      await logMessage({ conversationId: conv.id, direction: "out", role: "bot", content: botReply, metadata: metadata.out || {} });
    }
    return conv.id;
  } catch (err) {
    console.error("[conversationStore] recordExchange:", err.message || err);
    return null;
  }
}

module.exports = { upsertContact, getOrCreateConversation, logMessage, recordExchange, isEnabled, _setClient };
