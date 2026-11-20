// Etapas automáticas del embudo (CRM propio en /admin), sin depender de Atomic CRM.
// Reglas deterministas (no las decide el LLM), las mismas del sync con Atomic:
//  - cotizado:   Matías recomendó productos concretos en la conversación.
//  - interesado: intención de compra media/alta o pidió hablar con una persona.
//  - compro:     lo marcan las ventas sincronizadas (Bsale / WooCommerce), no esta función.
// Solo avanza: nunca retrocede lo que el equipo movió a mano; compro/perdido son finales.
const { inferStage, advanceStage, normalizeStage } = require("./atomicCrmSync");
const { safeError, pseudonymize } = require("./logSanitizer");

const ROW_SQL = `select c.id, c.tenant_id, c.stage,
    s.known_context->>'purchase_intent_level' as intent_level,
    (select count(*)::int from bot_events e where e.session_id = c.session_id and jsonb_array_length(e.products) > 0) as quotes,
    (select count(*)::int from handoff_requests h where h.session_id = c.session_id) as handoffs,
    exists (select 1 from handoff_requests h where h.session_id = c.session_id and h.status = 'open') as handoff_open
  from contacts c left join bot_sessions s on s.session_id = c.session_id
  where c.session_id = $1`;

// Devuelve las transiciones aplicadas: [{ contactId, from, to }].
async function refreshStage(query, sessionId) {
  if (!sessionId) return [];
  const moved = [];
  try {
    const { rows } = await query(ROW_SQL, [sessionId]);
    for (const row of rows) {
      const from = normalizeStage(row.stage);
      const to = advanceStage(row.stage, inferStage(row));
      if (to === from) continue;
      // Condición sobre la etapa leída: si un humano la movió entre medio, no se pisa.
      const u = await query("update contacts set stage = $1, updated_at = now() where id = $2 and stage is not distinct from $3 returning id", [to, row.id, row.stage]);
      if (!u.rows.length) continue;
      await query("insert into contact_stage_events (contact_id, tenant_id, from_stage, to_stage, actor) values ($1,$2,$3,$4,'bot')", [row.id, row.tenant_id || null, from, to]);
      moved.push({ contactId: row.id, from, to });
    }
  } catch (error) {
    console.warn("[CRM] No se pudo actualizar la etapa:", safeError(error), { session: pseudonymize(sessionId) });
  }
  return moved;
}

module.exports = { refreshStage, ROW_SQL };
