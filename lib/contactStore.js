// CRM: upsert de contactos en Postgres (tabla contacts, db/migrations/003_crm_contacts.sql).
// Fail-safe: nunca lanza ni bloquea la respuesta al cliente; sin DATABASE_URL es no-op.
const postgres = require("./postgres");
const { pseudonymize, safeError } = require("./logSanitizer");

const MAX_NAME = 120;
const CHANNELS = new Set(["whatsapp", "web", "instagram", "chatwoot"]);
const PREFIX = { whatsapp: "wa", web: "web", instagram: "ig", chatwoot: "cw" };
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,100}$/;

let queryFn = postgres.isConfigured ? postgres.query : null;
function _setQuery(fn) { queryFn = fn; } // solo tests

function cleanName(name) {
  if (typeof name !== "string") return null;
  // Sin caracteres de control ni saltos; largo acotado.
  const v = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return v || null;
}

function cleanPhone(phone) {
  const v = String(phone || "").replace(/\D/g, "").slice(0, 20);
  return v || null;
}

// session_id se actualiza: en Chatwoot apunta a la conversación más reciente (cw:<conversation id>);
// en WhatsApp/web es determinístico y no cambia.
const UPSERT_SQL = `insert into contacts (channel, external_id, session_id, name, phone, source_channel, tenant_id, message_count)
values ($1, $2, $3, $4, $5, $6, $7, 1)
on conflict ((coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)), channel, external_id) do update set
  session_id = excluded.session_id,
  source_channel = coalesce(excluded.source_channel, contacts.source_channel),
  name = coalesce(excluded.name, contacts.name),
  phone = coalesce(excluded.phone, contacts.phone),
  message_count = contacts.message_count + 1,
  last_seen_at = now(),
  updated_at = now()
returning id`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function upsertContact({ channel = "whatsapp", externalId, name, phone, sessionId: sessionOverride, sourceChannel, tenantId = null } = {}) {
  if (!queryFn) return null;
  try {
    if (!CHANNELS.has(channel)) return null;
    const ext = channel === "whatsapp" ? cleanPhone(externalId) : String(externalId || "").slice(0, 100);
    if (!ext || !SAFE_ID.test(ext)) return null;
    const tenant = tenantId && UUID.test(String(tenantId)) ? String(tenantId) : null;
    const sessionId = typeof sessionOverride === "string" && SAFE_ID.test(sessionOverride)
      ? sessionOverride
      : tenant ? `${PREFIX[channel]}:${tenant}:${ext}` : `${PREFIX[channel]}:${ext}`;
    const source = typeof sourceChannel === "string" ? sourceChannel.slice(0, 40) : null;
    const params = [channel, ext, sessionId, cleanName(name), channel === "whatsapp" ? ext : cleanPhone(phone), source, tenant];
    const result = await queryFn(UPSERT_SQL, params);
    return result?.rows?.[0]?.id ?? null;
  } catch (error) {
    console.error("[CRM] upsertContact failed", { contact: pseudonymize(externalId), error: safeError(error) });
    return null;
  }
}

// Para el webhook: dispara sin esperar y nunca rechaza.
function trackContact(args) {
  upsertContact(args).catch(() => {});
}

module.exports = { upsertContact, trackContact, cleanName, cleanPhone, UPSERT_SQL, _setQuery };
