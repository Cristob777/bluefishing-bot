// CRM estilo Twenty: tabla de contactos (orden/filtros por querystring) y kanban con "mover etapa"
// por POST de formulario (sin JS; compatible con CSP). tenantId undefined = todas las empresas (/admin).
const ui = require("./ui");
const { esc, icon } = ui;

const STAGES = [["nuevo", "Nuevo"], ["interesado", "Interesado"], ["cotizado", "Cotizado"], ["compro", "Compró"], ["perdido", "Perdido"]];
const STAGE_LABEL = Object.fromEntries(STAGES);
const STAGE_BADGE = { nuevo: "b-off", interesado: "b-brand", cotizado: "b-pend", compro: "b-ok", perdido: "b-err" };
const CHANNELS = { whatsapp: "WhatsApp", web: "Chat web", chatwoot: "Chatwoot", instagram: "Instagram" };
const SORTS = { last: "c.last_seen_at", first: "c.first_seen_at", msgs: "c.message_count", stage: "array_position(array['nuevo','interesado','cotizado','compro','perdido'], c.stage)", name: "coalesce(c.name, c.external_id)", sales: "sales" };

function scope(tenantId, params) {
  if (tenantId === undefined) return "true";
  if (tenantId === null) return "c.tenant_id is null";
  params.push(tenantId); return `c.tenant_id = $${params.length}`;
}

async function listContacts(query, { tenantId, q = "", stage = "", channel = "", sort = "last", dir = "desc", limit = 200 } = {}) {
  const p = [], w = [scope(tenantId, p)];
  if (STAGE_LABEL[stage]) { p.push(stage); w.push(`c.stage = $${p.length}`); }
  if (CHANNELS[channel]) { p.push(channel); w.push(`c.channel = $${p.length}`); }
  const qq = String(q || "").trim().slice(0, 60);
  if (qq) { p.push(`%${qq.replace(/[%_\\]/g, "\\$&")}%`); w.push(`(coalesce(c.name,'') ilike $${p.length} or coalesce(c.phone,'') ilike $${p.length} or coalesce(c.email,'') ilike $${p.length})`); }
  const col = SORTS[sort] || SORTS.last, d = dir === "asc" ? "asc" : "desc";
  p.push(Math.min(500, Number(limit) || 200));
  const r = await query(`select c.id, c.tenant_id, c.channel, c.external_id, c.session_id, c.name, c.phone, c.email, c.stage, c.message_count, c.first_seen_at, c.last_seen_at,
      t.name tenant_name,
      coalesce((select sum(o.total) from woo_orders o where o.contact_id=c.id and o.status in ('completed','processing')),0)::float sales
    from contacts c left join tenants t on t.id=c.tenant_id where ${w.join(" and ")} order by ${col} ${d} nulls last, c.id desc limit $${p.length}`, p);
  return r.rows;
}

async function moveStage(query, { tenantId, contactId, stage, actor }) {
  if (!STAGE_LABEL[stage] || !/^\d{1,18}$/.test(String(contactId))) return false;
  const p = [Number(contactId), stage], w = scope(tenantId, p);
  const r = await query(`update contacts c set stage=$2, updated_at=now() from (select id, stage old from contacts where id=$1) o
     where c.id=o.id and ${w} returning c.id, c.tenant_id, o.old`, p);
  if (!r.rows[0]) return false;
  if (r.rows[0].old !== stage) await query("insert into contact_stage_events (contact_id, tenant_id, from_stage, to_stage, actor) values ($1,$2,$3,$4,$5)", [r.rows[0].id, r.rows[0].tenant_id, r.rows[0].old, stage, String(actor || "").slice(0, 80)]);
  return true;
}

async function contactBySession(query, { tenantId, sessionId }) {
  const p = [String(sessionId)], w = scope(tenantId, p);
  const r = await query(`select c.id, c.stage, c.name, c.channel, c.phone, c.email from contacts c where c.session_id=$1 and ${w} limit 1`, p).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

const who = (c) => c.name || (c.channel === "web" ? `Visitante web ${String(c.external_id).slice(-4)}` : (c.phone || c.external_id || "").replace(/^(\d{3})\d+(\d{4})$/, "+$1 •••• $2"));
const money = (v) => Number(v) ? new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(v)) : "—";
const when = (v) => { try { return new Intl.DateTimeFormat("es-CL", { timeZone: process.env.ADMIN_TIMEZONE || "America/Santiago", dateStyle: "short", timeStyle: "short" }).format(new Date(v)); } catch { return ""; } };

function moveForm({ action, csrf, contactId, stage, back, compact = false }) {
  const opts = STAGES.map(([k, l]) => `<option value="${k}"${k === stage ? " selected" : ""}>${l}</option>`).join("");
  return `<form method="post" action="${action}" class="mv"${compact ? "" : ' style="margin-top:8px"'}>${csrf ? `<input type="hidden" name="csrf" value="${esc(csrf)}">` : ""}<input type="hidden" name="contact_id" value="${esc(contactId)}"><input type="hidden" name="back" value="${esc(back)}"><select name="stage" aria-label="Etapa">${opts}</select><button class="btn ghost" title="Mover">${compact ? "→" : "Mover"}</button></form>`;
}

const CRM_CSS = `<style>.mv{display:flex;gap:6px;align-items:center}.mv select{flex:1;min-width:0;font:inherit;font-size:12.5px;padding:6px 8px;border:1px solid #d5dde7;border-radius:8px;background:#fff}.mv .btn{padding:6px 10px}
.flt{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.flt input,.flt select{width:auto;flex:1;min-width:140px;font:inherit;padding:8px 10px;border:1px solid #d5dde7;border-radius:9px;background:#fff}
th a{color:inherit}th a:hover{color:var(--brand);text-decoration:none}.sv{display:inline-flex;gap:6px}</style>`;

function contactsTable(rows, { base, sep = "?", detail, filters, showTenant = false, csrf, action }) {
  const f = filters || {};
  const qs = (o) => { const u = new URLSearchParams({ ...f, ...o }); for (const [k, v] of [...u]) if (!v) u.delete(k); const s = u.toString(); return s ? base + sep + s : base; };
  const th = (key, label) => { const on = (f.sort || "last") === key, nd = on && f.dir !== "asc" ? "asc" : "desc"; return `<th><a href="${esc(qs({ sort: key, dir: nd }))}">${label}${on ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</a></th>`; };
  const hidden = Object.entries(base.includes("?") ? Object.fromEntries(new URLSearchParams(base.split("?")[1])) : {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  const filterBar = `<form class="flt" method="get" action="${esc(base.split("?")[0])}">${hidden}<input type="search" name="q" placeholder="Buscar nombre, teléfono o correo" value="${esc(f.q || "")}">
<select name="stage" aria-label="Etapa"><option value="">Todas las etapas</option>${STAGES.map(([k, l]) => `<option value="${k}"${f.stage === k ? " selected" : ""}>${l}</option>`).join("")}</select>
<select name="channel" aria-label="Canal"><option value="">Todos los canales</option>${Object.entries(CHANNELS).map(([k, l]) => `<option value="${k}"${f.channel === k ? " selected" : ""}>${l}</option>`).join("")}</select><button class="btn">Filtrar</button></form>`;
  if (!rows.length) return CRM_CSS + filterBar + `<div class="card">${ui.empty("users", "Sin contactos", f.q || f.stage || f.channel ? "Ningún contacto coincide con los filtros." : "Los contactos aparecen cuando alguien escribe por WhatsApp o el chat web.")}</div>`;
  const body = rows.map((c) => `<tr><td><a href="${esc(detail(c))}"><b>${esc(who(c))}</b></a>${c.email ? `<div class="muted small">${esc(c.email)}</div>` : ""}</td>${showTenant ? `<td class="small">${esc(c.tenant_name || "Operador")}</td>` : ""}
<td><span class="badge b-off">${esc(CHANNELS[c.channel] || c.channel)}</span></td><td>${moveForm({ action, csrf, contactId: c.id, stage: c.stage, back: qs({}), compact: true })}</td><td>${Number(c.message_count) || 0}</td><td>${money(c.sales)}</td><td class="muted small">${esc(when(c.last_seen_at))}</td></tr>`).join("");
  return CRM_CSS + filterBar + `<div class="tw"><table><thead><tr>${th("name", "Contacto")}${showTenant ? "<th>Empresa</th>" : ""}<th>Canal</th>${th("stage", "Etapa")}${th("msgs", "Mensajes")}${th("sales", "Ventas")}${th("last", "Última actividad")}</tr></thead><tbody>${body}</tbody></table></div><div class="muted small" style="margin-top:8px">${rows.length} contacto${rows.length === 1 ? "" : "s"}</div>`;
}

function kanban(rows, { detail, csrf, action, back, showTenant = false }) {
  if (!rows.length) return `<div class="card">${ui.empty("board", "El embudo está vacío", "Los contactos aparecen aquí cuando escriben por WhatsApp o por el chat web.")}</div>`;
  const cols = STAGES.map(([k, l]) => {
    const it = rows.filter((r) => r.stage === k);
    const sum = it.reduce((a, r) => a + Number(r.sales || 0), 0);
    return `<div class="col"><h3><span><span class="badge ${STAGE_BADGE[k]}"><span class="dot"></span>${l}</span></span><span class="muted">${it.length}</span></h3>${sum ? `<div class="muted small" style="margin:-4px 0 8px">${money(sum)}</div>` : ""}
${it.length ? it.map((r) => `<div class="dcard"><a href="${esc(detail(r))}"><b>${esc(who(r))}</b></a><div class="muted small">${esc(CHANNELS[r.channel] || r.channel)} · ${Number(r.message_count) || 0} mensaje${Number(r.message_count) === 1 ? "" : "s"}${showTenant ? ` · ${esc(r.tenant_name || "Operador")}` : ""}</div>${Number(r.sales) ? `<div class="small" style="color:var(--ok);font-weight:600">${money(r.sales)}</div>` : ""}<div class="muted small">${esc(when(r.last_seen_at))}</div>${moveForm({ action, csrf, contactId: r.id, stage: r.stage, back, compact: true })}</div>`).join("") : `<div class="muted small" style="text-align:center;padding:20px 0">Sin contactos</div>`}</div>`;
  }).join("");
  return CRM_CSS + `<div class="kan">${cols}</div>`;
}

const safeBack = (b, prefix) => { const s = String(b || ""); return s.startsWith(prefix) && !s.startsWith("//") && !/[\r\n]/.test(s) ? s : prefix; };

module.exports = { STAGES, STAGE_LABEL, CHANNELS, listContacts, moveStage, contactBySession, contactsTable, kanban, moveForm, safeBack, who, CRM_CSS };
