// CRM: upsert de contactos en Postgres (tabla contacts, db/migrations/002_crm_contacts.sql).
// Fail-safe: nunca lanza ni bloquea la respuesta al cliente; sin DATABASE_URL es no-op.
const postgres = require("./postgres");
const { pseudonymize, safeError } = require("./logSanitizer");

const MAX_NAME = 120;
const CHANNELS = new Set(["whatsapp", "web", "instagram"]);
const PREFIX = { whatsapp: "wa", web: "web", instagram: "ig" };

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

const UPSERT_SQL = `insert into contacts (channel, external_id, session_id, name, phone, message_count)
values ($1, $2, $3, $4, $5, 1)
on conflict (channel, external_id) do update set
  name = coalesce(excluded.name, contacts.name),
  phone = coalesce(excluded.phone, contacts.phone),
  message_count = contacts.message_count + 1,
  last_seen_at = now(),
  updated_at = now()
returning id`;

async function upsertContact({ channel = "whatsapp", externalId, name, phone } = {}) {
  if (!queryFn) return null;
  try {
    if (!CHANNELS.has(channel)) return null;
    const ext = channel === "whatsapp" ? cleanPhone(externalId) : String(externalId || "").slice(0, 100);
    if (!ext) return null;
    const sessionId = `${PREFIX[channel]}:${ext}`;
    const params = [channel, ext, sessionId, cleanName(name), channel === "whatsapp" ? ext : cleanPhone(phone)];
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
