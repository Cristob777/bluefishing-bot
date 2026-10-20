// Sync unidireccional bot (Postgres de producción) -> Atomic CRM (Supabase, API REST/PostgREST).
// - Idempotente: tabla atomic_crm_sync (entity, source_id) -> id en Atomic + hash del payload.
// - Etapas solo avanzan (nunca retrocede lo que el equipo movió a mano en el kanban; compro/perdido son finales).
// - Fail-safe: errores por fila se registran y se sigue con la siguiente.
const crypto = require("node:crypto");
const { safeError, pseudonymize } = require("./logSanitizer");

const STAGES = ["nuevo", "interesado", "cotizado", "compro", "perdido"];
const STAGE_LABELS = { nuevo: "Nuevo", interesado: "Interesado", cotizado: "Cotizado", compro: "Compró", perdido: "Perdido" };
const RANK = { nuevo: 0, interesado: 1, cotizado: 2, compro: 3, perdido: 3 };
const TERMINAL = new Set(["compro", "perdido"]);
const CHANNEL_LABEL = { whatsapp: "WhatsApp", web: "Web", instagram: "Instagram", chatwoot: "Chatwoot" };

function normalizeStage(s) {
  const v = String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return STAGES.includes(v) ? v : "nuevo";
}

// Etapa inferida desde datos del bot.
//  - cotizado: el bot recomendó productos concretos (bot_events.products no vacío).
//  - interesado: intención de compra media/alta o handoff solicitado.
function inferStage(row) {
  if (Number(row.quotes) > 0) return "cotizado";
  const level = String(row.intent_level || "").toLowerCase();
  if (row.handoff_open || Number(row.handoffs) > 0 || level === "high" || level === "medium" || level === "alta" || level === "media") return "interesado";
  return "nuevo";
}

// Combina etapa guardada (puede venir de un humano) con la inferida: solo avanza, terminales no se tocan.
function advanceStage(current, proposed) {
  const cur = normalizeStage(current);
  const next = normalizeStage(proposed);
  if (TERMINAL.has(cur)) return cur;
  return RANK[next] > RANK[cur] ? next : cur;
}

function hashPayload(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 32);
}

function contactPayload(row, salesId) {
  const name = String(row.name || "").trim();
  const [first, ...rest] = name ? name.split(/\s+/) : ["Cliente"];
  const channel = CHANNEL_LABEL[row.channel] || row.channel;
  const source = row.source_channel ? ` vía ${row.source_channel}` : "";
  return {
    first_name: first.slice(0, 80),
    last_name: (rest.join(" ") || (name ? "" : channel)).slice(0, 80),
    phone_jsonb: row.phone ? [{ number: `+${String(row.phone).replace(/\D/g, "")}`, type: "Other" }] : [],
    email_jsonb: [],
    first_seen: row.first_seen_at,
    last_seen: row.last_seen_at,
    background: `Contacto del bot Matías (${channel}${source}). Sesión: ${row.session_id}. Mensajes: ${row.message_count || 0}.`,
    ...(salesId ? { sales_id: salesId } : {}),
  };
}

function dealPayload(row, stage, contactTargetId, salesId) {
  const products = Array.isArray(row.recent_products) ? row.recent_products.filter(Boolean).slice(0, 5) : [];
  return {
    name: `${CHANNEL_LABEL[row.channel] || row.channel} · ${String(row.name || "Cliente").slice(0, 60)}`,
    contact_ids: [contactTargetId],
    stage,
    category: "bot",
    description: products.length ? `Productos de interés: ${products.join(", ")}` : "Oportunidad creada por el bot.",
    ...(salesId ? { sales_id: salesId } : {}),
  };
}

function handoffNote(h, contactTargetId) {
  return {
    contact_id: contactTargetId,
    text: `Traspaso a humano solicitado (${h.intent || "sin intent"}). Último mensaje: ${String(h.last_message || "").slice(0, 500)}`,
    date: h.created_at,
    status: "hot",
  };
}

// Cliente mínimo de PostgREST (Supabase). fetchImpl inyectable para tests.
function createAtomicClient({ url, key, timeoutMs = 10000 }, fetchImpl = globalThis.fetch) {
  const base = String(url || "").replace(/\/+$/, "") + "/rest/v1";
  async function call(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(base + path, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Atomic CRM ${method} ${path.split("?")[0]} -> ${res.status}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } finally { clearTimeout(timer); }
  }
  const safeId = (id) => { const n = Number(id); if (!Number.isSafeInteger(n) || n <= 0) throw new Error("invalid id"); return n; };
  return {
    insert: async (table, row) => (await call("POST", `/${table}`, row))?.[0],
    update: async (table, id, row) => (await call("PATCH", `/${table}?id=eq.${safeId(id)}`, row))?.[0],
    get: async (table, id, select = "*") => (await call("GET", `/${table}?id=eq.${safeId(id)}&select=${select}`))?.[0] || null,
    salesByEmail: async () => {
      const rows = (await call("GET", "/sales?select=id,email,disabled")) || [];
      return new Map(rows.filter((r) => !r.disabled).map((r) => [String(r.email).toLowerCase(), r.id]));
    },
  };
}

const SOURCE_SQL = `select c.id, c.channel, c.external_id, c.session_id, c.source_channel, c.name, c.phone, c.stage, c.assigned_to,
  c.message_count, c.first_seen_at, c.last_seen_at,
  s.known_context->>'purchase_intent_level' as intent_level,
  (select count(*)::int from bot_events e where e.session_id = c.session_id and jsonb_array_length(e.products) > 0) as quotes,
  (select count(*)::int from handoff_requests h where h.session_id = c.session_id) as handoffs,
  exists (select 1 from handoff_requests h where h.session_id = c.session_id and h.status = 'open') as handoff_open,
  (select array_agg(distinct p.item->>'name') from (
     select jsonb_array_elements(e.products) as item from bot_events e
     where e.session_id = c.session_id order by e.created_at desc limit 20) p) as recent_products
from contacts c left join bot_sessions s on s.session_id = c.session_id
where c.last_seen_at >= now() - ($1::int * interval '1 day')
order by c.last_seen_at desc limit $2`;

async function loadMap(query, entity, ids) {
  if (!ids.length) return new Map();
  const r = await query("select source_id, target_id, payload_hash from atomic_crm_sync where entity = $1 and source_id = any($2::text[])", [entity, ids]);
  return new Map(r.rows.map((x) => [x.source_id, x]));
}

async function saveMap(query, entity, sourceId, targetId, hash) {
  await query(`insert into atomic_crm_sync(entity, source_id, target_id, payload_hash) values ($1,$2,$3,$4)
    on conflict (entity, source_id) do update set target_id = excluded.target_id, payload_hash = excluded.payload_hash, synced_at = now()`,
  [entity, String(sourceId), targetId, hash]);
}

async function runSync({ query, atomic, lookbackDays = 30, batchSize = 200, defaultSalesId = null, log = console }) {
  const stats = { contacts: 0, contactsSkipped: 0, deals: 0, notes: 0, stageAdvanced: 0, errors: 0 };
  const rows = (await query(SOURCE_SQL, [lookbackDays, batchSize])).rows;
  if (!rows.length) return stats;
  const ids = rows.map((r) => String(r.id));
  const [cMap, dMap] = await Promise.all([loadMap(query, "contact", ids), loadMap(query, "deal", ids)]);
  let sales = new Map();
  try { sales = await atomic.salesByEmail(); } catch (e) { log.warn("[AtomicCRM] No se pudo leer sales:", safeError(e)); }

  for (const row of rows) {
    const sid = String(row.id);
    try {
      const salesId = (row.assigned_to && sales.get(String(row.assigned_to).toLowerCase())) || defaultSalesId || null;

      // 1) Contacto
      const cp = contactPayload(row, salesId);
      const cHash = hashPayload(cp);
      let contactTarget = cMap.get(sid)?.target_id;
      if (!contactTarget) {
        contactTarget = (await atomic.insert("contacts", cp)).id;
        await saveMap(query, "contact", sid, contactTarget, cHash);
        stats.contacts++;
      } else if (cMap.get(sid).payload_hash !== cHash) {
        await atomic.update("contacts", contactTarget, cp);
        await saveMap(query, "contact", sid, contactTarget, cHash);
        stats.contacts++;
      } else stats.contactsSkipped++;

      // 2) Etapa: solo avanza; se guarda de vuelta en contacts del bot.
      const stage = advanceStage(row.stage, inferStage(row));
      if (stage !== normalizeStage(row.stage)) {
        await query("update contacts set stage = $1, updated_at = now() where id = $2 and stage = $3", [stage, row.id, row.stage]);
        stats.stageAdvanced++;
      }

      // 3) Deal (uno por contacto) desde 'interesado' en adelante.
      if (stage !== "nuevo") {
        const dExisting = dMap.get(sid);
        if (!dExisting) {
          const deal = await atomic.insert("deals", dealPayload(row, stage, contactTarget, salesId));
          await saveMap(query, "deal", sid, deal.id, stage);
          stats.deals++;
        } else if (dExisting.payload_hash !== stage) {
          // Respeta cambios hechos en el kanban: solo avanza respecto de la etapa actual en Atomic.
          const current = await atomic.get("deals", dExisting.target_id, "id,stage");
          if (current) {
            const target = advanceStage(current.stage, stage);
            if (target !== current.stage) await atomic.update("deals", dExisting.target_id, { stage: target, updated_at: new Date().toISOString() });
            await saveMap(query, "deal", sid, dExisting.target_id, stage);
            stats.deals++;
          }
        }
      }

      // 4) Handoffs -> notas del contacto (una por handoff).
      if (Number(row.handoffs) > 0) {
        const hs = (await query("select id, intent, last_message, created_at from handoff_requests where session_id = $1 order by id desc limit 20", [row.session_id])).rows;
        const nMap = await loadMap(query, "handoff_note", hs.map((h) => String(h.id)));
        for (const h of hs) {
          if (nMap.has(String(h.id))) continue;
          const note = await atomic.insert("contact_notes", handoffNote(h, contactTarget));
          await saveMap(query, "handoff_note", h.id, note.id, null);
          stats.notes++;
        }
      }
    } catch (error) {
      stats.errors++;
      log.error("[AtomicCRM] Error sincronizando contacto", { contact: pseudonymize(sid), error: safeError(error) });
    }
  }
  return stats;
}

module.exports = {
  STAGES, STAGE_LABELS, normalizeStage, inferStage, advanceStage, hashPayload,
  contactPayload, dealPayload, handoffNote, createAtomicClient, runSync, SOURCE_SQL,
};
