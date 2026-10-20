// Métricas de "Resultados" con datos reales. prefix = null (global, /admin) o 'wa:<tenant>:%' (/panel).
async function results(query, { days = 30, prefix = null } = {}) {
  const d = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const f = prefix ? "and session_id like $2" : "";
  const p = prefix ? [d, prefix] : [d];
  const [daily, split, first, prods, intents] = await Promise.all([
    query(`select to_char(g.day,'DD/MM') label, coalesce(count(e.*),0)::int messages, count(distinct e.session_id)::int conversations
             from generate_series((now() at time zone 'America/Santiago')::date-($1::int-1), (now() at time zone 'America/Santiago')::date, interval '1 day') g(day)
             left join bot_events e on (e.created_at at time zone 'America/Santiago')::date=g.day::date ${f.replace("session_id", "e.session_id")}
            group by g.day order by g.day`, p),
    query(`select count(*) filter (where h)::int handoff, count(*) filter (where not h)::int resolved from
             (select session_id, bool_or(handoff) or exists(select 1 from handoff_requests r where r.session_id=bot_events.session_id) h
                from bot_events where created_at>=now()-($1::int*interval '1 day') ${f} group by session_id) x`, p),
    query(`select round(avg(latency_ms))::int avg_ms, count(*)::int n from (select distinct on (session_id) latency_ms from bot_events
             where created_at>=now()-($1::int*interval '1 day') and latency_ms is not null ${f} order by session_id, created_at) x`, p),
    query(`select item->>'name' name, count(*)::int count from bot_events e cross join lateral jsonb_array_elements(e.products) item
            where e.created_at>=now()-($1::int*interval '1 day') and coalesce(item->>'name','')<>'' ${f.replace("session_id", "e.session_id")} group by 1 order by 2 desc limit 6`, p),
    query(`select coalesce(intent,'sin_intent') name, count(*)::int count from bot_events where created_at>=now()-($1::int*interval '1 day') ${f} group by 1 order by 2 desc limit 6`, p),
  ]);
  let funnel = null;
  if (prefix) {
    const r = await query(`select count(distinct e.session_id)::int contacts,
        count(distinct e.session_id) filter (where lower(coalesce(s.known_context->>'purchase_intent_level',''))='high')::int interested
      from bot_events e left join bot_sessions s on s.session_id=e.session_id where e.created_at>=now()-($1::int*interval '1 day') and e.session_id like $2`, p);
    funnel = { steps: [{ label: "Nuevo (contactos)", value: r.rows[0].contacts }, { label: "Interesado (intención alta)", value: r.rows[0].interested }], partial: true };
  } else {
    const r = await query(`select stage, count(*)::int n from contacts where last_seen_at>=now()-($1::int*interval '1 day') group by stage`, [d]).catch(() => ({ rows: [] }));
    const n = Object.fromEntries(r.rows.map((x) => [x.stage, x.n]));
    const compro = n.compro || 0, cot = (n.cotizado || 0) + compro, int = (n.interesado || 0) + cot, all = (n.nuevo || 0) + int + (n.perdido || 0);
    funnel = { steps: [{ label: "Nuevo", value: all }, { label: "Interesado", value: int }, { label: "Cotizado", value: cot }, { label: "Compró", value: compro }], lost: n.perdido || 0, partial: false };
  }
  return { days: d, daily: daily.rows, split: split.rows[0] || {}, first: first.rows[0] || {}, products: prods.rows, intents: intents.rows, funnel,
    sales: null }; // No existe tabla de pedidos/cotizaciones vinculada al bot: nunca se inventa.
}

function resultsBody(ui, charts, r, base) {
  const tabs = `<div class="tabs">${[7, 30, 90].map((n) => `<a class="${n === r.days ? "on" : ""}" href="${base}${base.includes("?") ? "&" : "?"}days=${n}">${n} días</a>`).join("")}</div>`;
  const tot = r.daily.reduce((a, x) => a + x.messages, 0), res = Number(r.split.resolved || 0), han = Number(r.split.handoff || 0);
  const kpi = (ic, v, l) => `<div class="card kpi"><span class="ic">${ui.icon(ic, 20)}</span><div><b>${v}</b><span>${l}</span></div></div>`;
  const ms = r.first.avg_ms;
  const frt = ms == null ? "Sin datos" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  const rate = res + han ? Math.round((res / (res + han)) * 100) + "%" : "Sin datos";
  return `<div class="head"><div><h1>Resultados</h1><div class="muted">Datos reales de los últimos ${r.days} días.</div></div>${tabs}</div>
<div class="grid g4" style="margin-bottom:16px">${kpi("msg", tot.toLocaleString("es-CL"), "Mensajes")}${kpi("users", (res + han).toLocaleString("es-CL"), "Conversaciones")}${kpi("check", rate, "Resueltas por el bot")}${kpi("clock", frt, "1ª respuesta promedio")}</div>
<div class="card" style="margin-bottom:16px"><h3>Mensajes y conversaciones por día</h3>${charts.line(r.daily.map((x) => x.label), [{ name: "Mensajes", color: charts.C.a, values: r.daily.map((x) => x.messages) }, { name: "Conversaciones", color: charts.C.ok, values: r.daily.map((x) => x.conversations) }])}</div>
<div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>Embudo de conversión</h3>${charts.funnel(r.funnel.steps)}${r.funnel.partial ? `<div class="help">Cotizado y Compró: <b>sin datos</b> por empresa todavía (el CRM aún no separa por empresa).</div>` : r.funnel.lost ? `<div class="help">Perdidos en el período: ${r.funnel.lost}</div>` : ""}</div>
<div class="card"><h3>Resuelto por el bot vs. derivado a humano</h3>${charts.donut([{ label: "Resuelto por Matías", value: res, color: charts.C.a }, { label: "Derivado a humano", value: han, color: charts.C.err }], rate === "Sin datos" ? "" : rate)}</div></div>
<div class="grid g3"><div class="card"><h3>Productos más consultados</h3>${charts.hbars(r.products)}</div><div class="card"><h3>Intenciones principales</h3>${charts.hbars(r.intents, ui.intentLabel)}</div>
<div class="card"><h3>Ventas y cotizaciones atribuidas</h3>${r.sales ? "" : charts.noData("Aún no hay pedidos ni cotizaciones vinculados al bot. Cuando se conecten los pedidos de WooCommerce o el CRM, aparecerán aquí.")}</div></div>`;
}

module.exports = { results, resultsBody };
