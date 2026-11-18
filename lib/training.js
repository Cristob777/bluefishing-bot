// Entrenamiento desde /admin: el dueño corrige respuestas y verifica fichas de productos.
// - Correcciones: chat_feedback (flagged → resolved). Las resueltas entran al prompt como
//   HUMAN_VERIFIED_EXAMPLES (lib/learnedExamples.js), elegidas por parecido con lo que pregunta el cliente.
// - Fichas: product_attributes con updated_by humano. Pisan la ficha automática y quedan
//   "verificadas" (lib/catalog.js), así Matías puede afirmar esa compatibilidad al vender.

const MAX_CORRECTION = 400;
const MAX_NOTES = 300;
const WATER = ["mar", "río", "lago"];
const POSITION = ["orilla", "roca", "playa", "bote", "embarcación", "muelle"];
const TECHNIQUE = ["spinning", "baitcasting", "jigging", "shore jigging", "popping", "trolling", "surfcasting", "ajing/light game", "fondeo", "fly fishing"];

function clean(text, max) {
  return String(text || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim()
    .slice(0, max);
}

function pick(values, allowed) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(list.filter((v) => allowed.includes(v)))];
}

function speciesList(text) {
  return [...new Set(String(text || "").split(",").map((s) => clean(s, 40).toLowerCase()).filter(Boolean))].slice(0, 12);
}

// Marca una respuesta del bot para corregir. Idempotente por evento.
async function flagEvent(query, { eventId, actor }) {
  const { rows } = await query(
    `insert into chat_feedback(session_id, source_channel, user_message, bot_response, debug_snapshot, status, flagged_by, event_id)
     select e.session_id, e.channel, e.user_message, coalesce(e.bot_response, ''),
            jsonb_build_object('intent', e.intent, 'products', e.products, 'route', e.route), 'flagged', $2, e.id
       from bot_events e where e.id = $1
     on conflict (event_id) where event_id is not null do nothing
     returning id`,
    [eventId, actor]
  );
  return rows[0]?.id || null;
}

async function resolveFeedback(query, { id, correction, actor }) {
  const text = clean(correction, MAX_CORRECTION);
  if (!text) return false;
  const { rowCount } = await query(
    "update chat_feedback set correction = $2, status = 'resolved', resolved_by = $3, resolved_at = now() where id = $1",
    [id, text, actor]
  );
  return rowCount > 0;
}

// Descartar (pendiente que no vale la pena) u olvidar (aprendida que ya no aplica): sale del prompt.
async function archiveFeedback(query, { id, actor }) {
  const { rowCount } = await query(
    "update chat_feedback set status = 'archived', resolved_by = $2, resolved_at = now() where id = $1",
    [id, actor]
  );
  return rowCount > 0;
}

async function listFeedback(query) {
  const { rows } = await query(
    `select id, session_id, user_message, bot_response, correction, status, created_at, resolved_at, event_id
       from chat_feedback where status in ('flagged', 'resolved')
      order by case status when 'flagged' then 0 else 1 end, coalesce(resolved_at, created_at) desc
      limit 100`
  );
  return {
    pending: rows.filter((r) => r.status === "flagged"),
    learned: rows.filter((r) => r.status === "resolved"),
  };
}

async function flaggedEventIds(query, sessionId) {
  const { rows } = await query(
    "select event_id, status from chat_feedback where session_id = $1 and event_id is not null",
    [sessionId]
  );
  return new Map(rows.map((r) => [String(r.event_id), r.status]));
}

async function saveProductSheet(query, { url, water, position, technique, species, notes, actor }) {
  const row = {
    water_type: pick(water, WATER),
    fishing_position: pick(position, POSITION),
    technique: pick(technique, TECHNIQUE),
    target_species: speciesList(species),
    verified_notes: clean(notes, MAX_NOTES),
  };
  await query(
    `insert into product_attributes(product_url, target_species, water_type, fishing_position, technique, verified_notes,
                                    extraction_method, extraction_confidence, updated_by, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'human', 1, $7, now())
     on conflict (product_url) do update set
       target_species = excluded.target_species, water_type = excluded.water_type,
       fishing_position = excluded.fishing_position, technique = excluded.technique,
       verified_notes = excluded.verified_notes, extraction_method = 'human',
       extraction_confidence = 1, updated_by = excluded.updated_by, updated_at = now()`,
    [url, row.target_species, row.water_type, row.fishing_position, row.technique, row.verified_notes, actor]
  );
  return row;
}

async function removeProductSheet(query, { url }) {
  const { rowCount } = await query("delete from product_attributes where product_url = $1 and updated_by like 'admin:%'", [url]);
  return rowCount > 0;
}

// Productos donde la tienda no dice el tipo de agua o los lista en mar y río a la vez.
function needsReview(product) {
  return product.verification !== "verificada" && (product.needsReview || !product.waterType.length);
}

module.exports = {
  WATER, POSITION, TECHNIQUE, MAX_CORRECTION,
  flagEvent, resolveFeedback, archiveFeedback, listFeedback, flaggedEventIds,
  saveProductSheet, removeProductSheet, needsReview, speciesList, pick,
};
