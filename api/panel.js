// Panel de onboarding autoservicio: el dueño de cada empresa crea su cuenta,
// conecta su tienda WooCommerce y su WhatsApp, sin compartir claves con nadie.
const crypto = require("node:crypto");
const { createStore, normalizeEmail, validEmail } = require("../lib/tenantStore");
const woo = require("../lib/wooAuth");
const meta = require("../lib/metaGraph");
const box = require("../lib/secretBox");
const { safeError } = require("../lib/logSanitizer");

const COOKIE = "bf_panel";
const TTL = 12 * 60 * 60;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const flag = (name) => ["1", "true", "yes", "on"].includes(String(process.env[name] || "").toLowerCase());
const baseUrl = () => String(process.env.PUBLIC_BASE_URL || (process.env.BOT_DOMAIN ? `https://${process.env.BOT_DOMAIN}` : "")).replace(/\/+$/, "");
const secret = () => process.env.PANEL_SESSION_SECRET || "";

function configured() {
  return secret().length >= 32 && box.isConfigured() && /^https:\/\//.test(baseUrl());
}

function hmac(data) { return crypto.createHmac("sha256", secret()).update(data).digest("base64url"); }
function eq(a, b) { const A = Buffer.from(String(a ?? "")), B = Buffer.from(String(b ?? "")); return A.length === B.length && crypto.timingSafeEqual(A, B); }

function sign(user) {
  const payload = Buffer.from(JSON.stringify({ uid: user.id, sv: user.session_version, exp: Date.now() + TTL * 1000 })).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

function readToken(token) {
  try {
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig || !eq(sig, hmac(payload))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now() ? data : null;
  } catch { return null; }
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf("="); return i < 0 ? [x, ""] : [x.slice(0, i), x.slice(i + 1)];
  }));
}

const csrfFor = (token) => hmac(`csrf:${token}`);
const cookieHeader = (v, maxAge) => `${COOKIE}=${v}; Max-Age=${maxAge}; Path=/panel; HttpOnly; Secure; SameSite=Lax`;
const form = (raw) => Object.fromEntries(new URLSearchParams(Buffer.from(raw || "").toString("utf8")).entries());
function jsonBody(req) {
  if (req.body && Object.keys(req.body).length) return req.body;
  try { return JSON.parse(Buffer.from(req.rawBody || "").toString("utf8") || "{}"); } catch { return {}; }
}

function headers(res, csp) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", csp || "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; base-uri 'none'; frame-ancestors 'none'");
}
function html(res, status, body, csp) { headers(res, csp); res.statusCode = status; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(body); }
function json(res, status, obj) { headers(res); res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); }
function redirect(res, where, cookie) { headers(res); res.statusCode = 303; res.setHeader("Location", where); if (cookie) res.setHeader("Set-Cookie", cookie); res.end(); }

const ui = require("../lib/ui");
const crm = require("../lib/crm");
const { icon } = ui;
function page(title, body) { return ui.doc(title, `<div class="content" style="margin:auto;max-width:640px">${body}</div>`); }

function authPage(msg = "") {
  const form = `<h1>Bienvenido</h1><p class="muted" style="margin:6px 0 20px">Entra al panel de tu empresa o crea una cuenta nueva.</p>
${msg ? `<div class="alert err" role="alert">${icon("alert", 16)} ${esc(msg)}</div>` : ""}
<div class="card"><h2>Entrar</h2><form method="post" action="/panel/login"><label for="le">Correo</label><input id="le" name="email" type="email" placeholder="tu@empresa.cl" autocomplete="username" required><label for="lp">Contraseña</label><input id="lp" name="password" type="password" placeholder="••••••••••••" autocomplete="current-password" required><div style="margin-top:16px"><button class="btn full">Entrar</button></div></form></div>
<details style="background:#fff"><summary>¿Primera vez? Crea la cuenta de tu empresa</summary><form method="post" action="/panel/signup"><label for="sc">Nombre de la empresa</label><input id="sc" name="company" placeholder="Pesca Sur SpA" required maxlength="160"><label for="se">Correo del dueño</label><input id="se" name="email" type="email" placeholder="tu@empresa.cl" autocomplete="username" required><label for="sp">Contraseña</label><input id="sp" name="password" type="password" placeholder="Mínimo 12 caracteres" minlength="12" autocomplete="new-password" required><div style="margin-top:16px"><button class="btn full">Crear cuenta</button></div></form></details>`;
  return ui.authLayout({ title: "Blue Fishing · Panel", tagline: "Tu asistente de ventas atendiendo WhatsApp y tu web, 24/7.", feats: ["Conecta tu tienda WooCommerce en un clic", "Conecta tu WhatsApp Business sin compartir claves", "Mira conversaciones y clientes en un solo lugar"], form });
}

const NOTICES = {
  woo_ok: ["ok", "Tienda conectada."], woo_err: ["err", "No pudimos conectar la tienda. Revisa la URL (https) e inténtalo de nuevo."],
  wa_ok: ["ok", "WhatsApp conectado y webhook suscrito."], wa_err: ["err", "Meta rechazó los datos de WhatsApp. Revisa el token, el Phone number ID, el WABA ID y el App secret (32 caracteres)."],
  wa_taken: ["err", "Ese número de WhatsApp ya está conectado a otra empresa."],
  csrf: ["err", "Tu sesión expiró por seguridad. Vuelve a intentarlo."],
  stage_ok: ["ok", "Etapa actualizada."], stage_err: ["err", "No pudimos mover el contacto."],
  sync_ok: ["ok", "Pedidos sincronizados."], sync_err: ["err", "No pudimos leer los pedidos de tu tienda. Revisa la conexión."],
  web_ok: ["ok", "Dominios del chat web guardados."], web_err: ["err", "Revisa los dominios: deben empezar con https:// (máximo 5)."],
};

const NAV = [["/panel", "Inicio", "home"], ["/panel/resultados", "Resultados", "chart"], ["/panel/contactos", "Contactos", "users"], ["/panel/embudo", "Embudo", "board"], ["/panel/conversaciones", "Conversaciones", "chat"], ["/panel/conexiones", "Conexiones", "plug"], ["/panel/ajustes", "Ajustes", "cog"]];
function layout(ctx, active, title, body) {
  const n = NOTICES[ctx.notice];
  return ui.shell({ title, product: "Blue Fishing", nav: NAV.map(([href, label, ic]) => ({ href, label, icon: ic, on: href === active })),
    user: { name: ctx.user.tenant_name, sub: ctx.user.email }, logout: { action: "/panel/logout", csrf: ctx.csrf }, body, toast: n ? { kind: n[0], text: n[1] } : null });
}
const fmt = (n) => new Intl.NumberFormat("es-CL").format(Number(n || 0));
const when = (v) => { try { return new Intl.DateTimeFormat("es-CL", { timeZone: process.env.ADMIN_TIMEZONE || "America/Santiago", dateStyle: "medium", timeStyle: "short" }).format(new Date(v)); } catch { return ""; } };
const phoneOf = (sid) => { const x = String(sid).split(":").pop(); if (String(sid).startsWith("web:")) return `Visitante web ${x.slice(-4)}`; return x.length > 7 ? `+${x.slice(0, 3)} •••• ${x.slice(-4)}` : x; };
const webOn = () => Boolean(String(process.env.ALLOWED_ORIGIN || "").trim());
const badge = (on, pendText = "Pendiente") => on ? `<span class="badge b-ok"><span class="dot"></span>Conectado</span>` : `<span class="badge b-pend"><span class="dot"></span>${pendText}</span>`;

function services(st) {
  const wa = Boolean(st.wa_connected_at), woo = Boolean(st.woo_connected_at), web = webOn();
  const card = (cls, ic, name, on, detail, cta) => `<div class="card svc"><div class="row"><span class="ic ${cls}">${icon(ic, 20)}</span>${badge(on, ic === "globe" ? "No activado" : "Pendiente")}</div><div><h2>${name}</h2><div class="muted small">${detail}</div></div>${cta}</div>`;
  return `<div class="grid g3">
${card("i-wa", "wa", "WhatsApp", wa, wa ? esc(st.wa_display_phone || st.wa_phone_number_id) : "Matías responde a tus clientes por WhatsApp.", `<a class="btn ${wa ? "ghost" : ""}" href="/panel/conexiones#whatsapp">${wa ? "Administrar" : "Conectar WhatsApp"}</a>`)}
${card("i-woo", "store", "WooCommerce", woo, woo ? `${esc(st.woo_store_url)} · solo lectura` : "Para que Matías conozca tus productos y stock.", `<a class="btn ${woo ? "ghost" : ""}" href="/panel/conexiones#tienda">${woo ? "Administrar" : "Conectar tienda"}</a>`)}
${card("i-web", "globe", "Chat web", web, web ? "Burbuja de chat activa en tu sitio." : "Lo activa tu operador al instalar el widget.", `<a class="btn ghost" href="/panel/ajustes#web">Ver instrucciones</a>`)}
</div>`;
}

function homePage(ctx, st, m) {
  const wa = Boolean(st.wa_connected_at), woo = Boolean(st.woo_connected_at);
  const steps = [["Cuenta creada", "Listo", true], ["Conectar tienda", woo ? "Listo" : "Catálogo", woo], ["Conectar WhatsApp", wa ? "Listo" : "Mensajes", wa]];
  const done = steps.filter((x) => x[2]).length, cur = steps.findIndex((x) => !x[2]);
  const onboarding = done === 3 ? "" : `<div class="card" style="margin-bottom:16px"><div class="head" style="margin:0"><div><h2>Configura tu asistente</h2><div class="muted">${done} de 3 pasos listos · te toma unos 5 minutos</div></div><a class="btn" href="/panel/conexiones">Continuar ${icon("bolt", 16)}</a></div>
<div class="bar" style="margin-top:14px"><i style="width:${Math.round(done / 3 * 100)}%"></i></div>
<div class="stepper">${steps.map((x, i) => `<div class="st ${x[2] ? "done" : i === cur ? "cur" : ""}"><span class="n">${x[2] ? icon("check", 14) : i + 1}</span><div><b>${x[0]}</b><span>${x[1]}</span></div></div>`).join("")}</div></div>`;
  const kpi = (ic, v, l) => `<div class="card kpi"><span class="ic">${icon(ic, 20)}</span><div><b>${fmt(v)}</b><span>${l}</span></div></div>`;
  return layout(ctx, "/panel", "Inicio", `<div class="head"><div><h1>Hola, ${esc(ctx.user.tenant_name)} 👋</h1><div class="muted">Esto es lo que pasó con tu asistente en los últimos 30 días.</div></div></div>
${onboarding}<div class="grid g4" style="margin-bottom:16px">${kpi("msg", m.messages, "Mensajes atendidos")}${kpi("users", m.contacts, "Contactos")}${kpi("hand", m.handoffs, "Derivados a humano")}${kpi("clock", m.today, "Mensajes hoy")}</div>
<h2 style="margin:22px 0 12px">Tus canales</h2>${services(st)}`);
}

function connectionsPage(ctx, st, verifyToken) {
  const wa = Boolean(st.wa_connected_at), woo = Boolean(st.woo_connected_at);
  const es = flag("WA_EMBEDDED_SIGNUP_ENABLED") ? `<p><a href="/panel/whatsapp/embedded">Conectar con Facebook (Embedded Signup)</a></p>` : "";
  const wooForm = `<form method="post" action="/panel/woo/connect"><input type="hidden" name="csrf" value="${esc(ctx.csrf)}"><label for="su">Dirección de tu tienda</label><input id="su" name="store_url" type="url" placeholder="https://tutienda.cl" required><div class="help">Te llevamos a tu WordPress para aprobar un acceso de <b>solo lectura</b>. Nunca vemos tu contraseña.</div><div style="margin-top:14px"><button class="btn">${woo ? "Volver a conectar" : "Conectar tienda"}</button></div></form>`;
  const waForm = `<form method="post" action="/panel/whatsapp/connect"><input type="hidden" name="csrf" value="${esc(ctx.csrf)}"><div class="grid g2" style="gap:0 16px">
<div><label for="t1">Token permanente</label><input id="t1" name="access_token" type="password" placeholder="EAAG…" autocomplete="off" required></div>
<div><label for="t4">Clave secreta de la app (App secret)</label><input id="t4" name="app_secret" type="password" placeholder="32 caracteres" autocomplete="off" required></div>
<div><label for="t2">Identificador del número (Phone number ID)</label><input id="t2" name="phone_number_id" placeholder="Ej: 123456789012345" inputmode="numeric" pattern="[0-9]+" required></div>
<div><label for="t3">Identificador de la cuenta (WABA ID)</label><input id="t3" name="waba_id" placeholder="Ej: 109876543210987" inputmode="numeric" pattern="[0-9]+" required></div></div>
<div style="margin-top:16px"><button class="btn">${wa ? "Actualizar datos" : "Conectar WhatsApp"}</button></div></form>
<details><summary>¿Dónde encuentro estos datos?</summary><ol><li>En <b>developers.facebook.com</b> → tu app → <b>WhatsApp → Configuración de la API</b> están el <i>Phone number ID</i> y el <i>WABA ID</i>.</li><li>En <b>business.facebook.com → Configuración → Usuarios del sistema</b> crea un usuario, asígnale la app y genera un <b>token permanente</b> con <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>.</li><li>En tu app → <b>Configuración → Básica</b> copia la <b>clave secreta de la app</b>.</li></ol></details>`;
  const hook = `<details${wa ? "" : " open"}><summary>Datos del webhook para pegar en Meta</summary><div class="muted" style="margin-top:8px">En tu app de Meta → WhatsApp → Configuración → Webhook:</div><div class="list" style="margin-top:6px"><div class="it"><span>URL de devolución</span><code>${esc(baseUrl())}/webhook</code></div><div class="it"><span>Token de verificación: <code>${esc(verifyToken)}</code></span></div><div class="it"><span>Campo</span><code>messages</code></div></div></details>`;
  const block = (id, cls, ic, title, on, detail, inner) => `<div class="card" id="${id}" style="margin-bottom:16px"><div class="head" style="margin-bottom:6px;align-items:center"><div style="display:flex;gap:12px;align-items:center"><span class="ic ${cls}" style="width:40px;height:40px;border-radius:10px;display:grid;place-items:center;flex:none">${icon(ic, 20)}</span><div><h2>${title}</h2><div class="muted small">${detail}</div></div></div>${badge(on)}</div>${inner}</div>`;
  return layout(ctx, "/panel/conexiones", "Conexiones", `<div class="head"><div><h1>Conexiones</h1><div class="muted">Conecta tus canales. Tus claves se guardan cifradas.</div></div></div>
${block("tienda", "i-woo", "store", "Paso 1 · Tu tienda WooCommerce", woo, woo ? `${esc(st.woo_store_url)} · solo lectura` : "Para que Matías conozca tus productos.", woo ? `<details><summary>Cambiar tienda</summary>${wooForm}</details>` : wooForm)}
${block("whatsapp", "i-wa", "wa", "Paso 2 · Tu WhatsApp", wa, wa ? esc(st.wa_display_phone || st.wa_phone_number_id) : "Para que Matías responda a tus clientes.", es + (wa ? `<details><summary>Cambiar datos de WhatsApp</summary>${waForm}</details>` : waForm) + hook)}`);
}

const STAGE = (c) => c.handoff ? ["Derivado a humano", "b-err"] : String(c.intent_level || "").toLowerCase() === "high" ? ["Interesado", "b-ok"] : c.turns > 1 ? ["En conversación", "b-brand"] : ["Nuevo", "b-off"];

function conversationsPage(ctx, rows) {
  const body = rows.length ? `<div class="tw"><table><thead><tr><th>Contacto</th><th>Etapa</th><th>Último mensaje</th><th>Mensajes</th><th>Actividad</th></tr></thead><tbody>${rows.map((c) => { const s = STAGE(c); return `<tr><td><a href="/panel/conversaciones?s=${encodeURIComponent(c.session_id)}"><b>${esc(phoneOf(c.session_id))}</b></a><div class="muted small">${esc(ui.intentLabel(c.last_intent))}</div></td><td><span class="badge ${s[1]}">${s[0]}</span></td><td>${esc(String(c.last_message || "").slice(0, 90))}</td><td>${fmt(c.turns)}</td><td class="muted small">${esc(when(c.last_at))}</td></tr>`; }).join("")}</tbody></table></div>`
    : `<div class="card">${ui.empty("chat", "Aún no hay conversaciones", "Cuando un cliente le escriba a tu WhatsApp, lo verás aquí.", `<a class="btn" href="/panel/conexiones#whatsapp">Conectar WhatsApp</a>`)}</div>`;
  return layout(ctx, "/panel/conversaciones", "Conversaciones", `<div class="head"><div><h1>Conversaciones</h1><div class="muted">Clientes que hablaron con Matías por WhatsApp.</div></div></div>${body}`);
}

function recordPage(ctx, sid, x) {
  const c = x.context || {}, last = x.events[x.events.length - 1];
  const props = [["Teléfono", phoneOf(sid)], ["Canal", sid.startsWith("web:") ? "Chat web" : "WhatsApp"], ["Correo", x.contact?.email], ["Primer contacto", x.events[0] ? when(x.events[0].created_at) : "—"], ["Última actividad", last ? when(last.created_at) : "—"], ["Producto buscado", c.product_type], ["Especie", c.target_species], ["Técnica", c.technique], ["Presupuesto", c.budget_range], ["Marca preferida", c.brand_preference]]
    .filter(([, v]) => v && v !== "unknown").map(([k, v]) => `<div class="prop"><span>${k}</span><b>${esc(v)}</b></div>`).join("");
  const tl = x.events.length ? x.events.map((e) => `<div class="ev"><div class="muted small">${esc(when(e.created_at))} · ${esc(ui.intentLabel(e.intent))}</div><div class="bub u">${esc(e.user_message)}</div>${e.bot_response ? `<div class="bub a">${esc(e.bot_response)}</div>` : ""}</div>`).join("") : ui.empty("chat", "Sin mensajes", "Esta conversación no tiene mensajes.");
  const stage = x.contact ? [crm.STAGE_LABEL[x.contact.stage] || x.contact.stage, { nuevo: "b-off", interesado: "b-brand", cotizado: "b-pend", compro: "b-ok", perdido: "b-err" }[x.contact.stage] || "b-off"] : STAGE({ handoff: x.handoffs.some((h) => h.status === "open"), intent_level: c.purchase_intent_level, turns: x.events.length });
  const mover = x.contact ? crm.CRM_CSS + crm.moveForm({ action: "/panel/crm/stage", csrf: ctx.csrf, contactId: x.contact.id, stage: x.contact.stage, back: `/panel/conversaciones?s=${encodeURIComponent(sid)}` }) : "";
  const prods = [...new Set(x.events.flatMap((e) => (Array.isArray(e.products) ? e.products : []).map((p) => p && p.name).filter(Boolean)))].slice(0, 6);
  return layout(ctx, "/panel/conversaciones", "Contacto", `<div class="head"><div><a class="small" href="/panel/conversaciones">← Conversaciones</a><h1 style="margin-top:6px">${esc(phoneOf(sid))}</h1></div><span class="badge ${stage[1]}">${stage[0]}</span></div>
<div class="rec"><div class="card"><h3>Propiedades</h3>${props}</div><div class="card"><h3>Actividad</h3><div class="tl">${tl}</div></div>
<div class="grid" style="gap:16px"><div class="card"><h3>Etapa del embudo</h3><span class="badge ${stage[1]}">${stage[0]}</span>${mover}<div class="muted small" style="margin-top:8px">Intención de compra: ${esc(c.purchase_intent_level && c.purchase_intent_level !== "unknown" ? c.purchase_intent_level : "sin datos")}</div></div>
<div class="card"><h3>Productos recomendados</h3>${prods.length ? `<div class="list">${prods.map((p) => `<div class="it"><span>${esc(p)}</span></div>`).join("")}</div>` : `<div class="muted small">Aún ninguno.</div>`}</div>
<div class="card"><h3>Derivaciones</h3>${x.handoffs.length ? `<div class="list">${x.handoffs.map((h) => `<div class="it"><span class="badge ${h.status === "open" ? "b-err" : "b-off"}">${h.status === "open" ? "Abierta" : "Cerrada"}</span><span class="muted small">${esc(when(h.created_at))}</span></div>`).join("")}</div>` : `<div class="muted small">No pidió hablar con una persona.</div>`}</div></div></div>`);
}

function settingsPage(ctx) {
  const u = ctx.user, origins = (u.widget_origins || []).join(", ");
  const snippet = `<script src="${baseUrl()}/widget.js" data-key="${u.widget_key || ""}" async></script>`;
  return layout(ctx, "/panel/ajustes", "Ajustes", `<div class="head"><div><h1>Ajustes</h1><div class="muted">Tu cuenta y canales.</div></div></div>
<div class="grid g2"><div class="card"><h3>Cuenta</h3><div class="prop"><span>Empresa</span><b>${esc(u.tenant_name)}</b></div><div class="prop"><span>Correo</span><b>${esc(u.email)}</b></div><div class="prop"><span>Seguridad</span><b>Contraseña cifrada · sesión de 12 h</b></div></div>
<div class="card" id="web"><h3>Chat web de tu empresa</h3>${badge((u.widget_origins || []).length > 0, "No activado")}
<p class="muted small">1) Escribe los dominios de tu sitio. 2) Pega esta línea en el pie de página de tu web. Las conversaciones quedarán en <b>tu</b> CRM.</p>
<code>${esc(snippet)}</code>
<form method="post" action="/panel/ajustes/web"><input type="hidden" name="csrf" value="${esc(ctx.csrf)}"><label for="wo">Dominios permitidos (separados por coma)</label><input id="wo" name="origins" placeholder="https://tutienda.cl, https://www.tutienda.cl" value="${esc(origins)}"><div style="margin-top:12px"><button class="btn">Guardar dominios</button></div></form></div></div>`);
}

function embeddedPage(csrf, nonce) {
  const cfg = { appId: process.env.META_APP_ID, configId: process.env.META_ES_CONFIG_ID, version: process.env.GRAPH_API_VERSION || "v24.0", csrf };
  const script = `window.BF=${JSON.stringify(cfg).replace(/</g, "\\u003c")};
let session={};
window.addEventListener('message',function(e){if(e.origin!=='https://www.facebook.com'&&e.origin!=='https://web.facebook.com')return;try{const d=JSON.parse(e.data);if(d.type==='WA_EMBEDDED_SIGNUP'&&d.event==='FINISH'){session=d.data||{};}}catch(_){}});
window.fbAsyncInit=function(){FB.init({appId:BF.appId,autoLogAppEvents:true,xfbml:false,version:BF.version});};
async function go(){const s=await fetch('/panel/whatsapp/embedded/start',{method:'POST',headers:{'x-csrf-token':BF.csrf}}).then(r=>r.json());
FB.login(function(r){if(!r.authResponse||!r.authResponse.code){document.getElementById('m').textContent='Cancelado.';return;}
setTimeout(function(){fetch('/panel/whatsapp/embedded/complete',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':BF.csrf},body:JSON.stringify({state:s.state,code:r.authResponse.code,waba_id:session.waba_id,phone_number_id:session.phone_number_id})}).then(x=>x.json()).then(function(j){document.getElementById('m').textContent=j.ok?'WhatsApp conectado.':'No se pudo conectar.';});},800);
},{config_id:BF.configId,response_type:'code',override_default_response_type:true,extras:{setup:{}}});}
document.getElementById('b').addEventListener('click',go);`;
  const body = page("Conectar WhatsApp", `<h2>Conectar WhatsApp con Facebook</h2><div class="card"><button id="b">Conectar con Facebook</button><p id="m" class="muted"></p><p><a style="color:#4fb8ff" href="/panel">← Volver</a></p></div><script nonce="${nonce}" async defer crossorigin="anonymous" src="https://connect.facebook.net/es_LA/sdk.js"></script><script nonce="${nonce}">${script}</script>`);
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' https://connect.facebook.net; connect-src 'self' https://*.facebook.com; frame-src https://*.facebook.com; img-src https://*.facebook.com https://*.fbcdn.net; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
  return { body, csp };
}

const attempts = new Map();
function limited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  a.n++; attempts.set(ip, a);
  return a.n > 10;
}

function verifyTokenFor(tenantId) { return box.derive(`wa_verify:${tenantId}`).slice(0, 32); }

function createPanel({ store = createStore(), fetchImpl = fetch } = {}) {
  async function currentUser(req) {
    const token = cookies(req)[COOKIE];
    const data = readToken(token);
    if (!data) return null;
    const user = await store.getUser(data.uid);
    if (!user || Number(user.session_version) !== Number(data.sv)) return null;
    return { user, csrf: csrfFor(token) };
  }

  return async function panel(req, res) {
    if (!configured()) { res.statusCode = 404; return res.end("Not found"); }
    const path = req.path || "/panel";
    try {
      // Callback servidor-a-servidor de WooCommerce: sin cookie, validado por state de un solo uso.
      if (path === "/panel/woo/callback" && req.method === "POST") {
        const b = jsonBody(req);
        const st = await store.consumeState(String(b.user_id || ""), "woo");
        if (!st) return json(res, 400, { error: "invalid_state" });
        const consumerKey = String(b.consumer_key || ""), consumerSecret = String(b.consumer_secret || "");
        if (!/^ck_[a-f0-9]{20,64}$/.test(consumerKey) || !/^cs_[a-f0-9]{20,64}$/.test(consumerSecret)) return json(res, 400, { error: "invalid_keys" });
        if (b.key_permissions && b.key_permissions !== "read") return json(res, 400, { error: "invalid_scope" });
        const ok = await woo.verifyKeys({ storeUrl: st.store_url, consumerKey, consumerSecret }, { fetchImpl }).catch(() => false);
        if (!ok) return json(res, 400, { error: "keys_rejected" });
        await store.saveWoo(st.tenant_id, { storeUrl: st.store_url, keyId: Number(b.key_id) || null, consumerKey, consumerSecret, permissions: "read" });
        return json(res, 200, { ok: true });
      }

      if (path === "/panel/signup" && req.method === "POST") {
        if (limited(req)) return html(res, 429, authPage("Demasiados intentos. Espera unos minutos."));
        const f = form(req.rawBody);
        const email = normalizeEmail(f.email), company = String(f.company || "").trim().slice(0, 160), password = String(f.password || "");
        if (!validEmail(email) || !company || password.length < 12 || password.length > 200) return html(res, 400, authPage("Revisa los datos: correo válido y contraseña de 12+ caracteres."));
        const user = await store.signup({ company, email, password });
        if (!user) return html(res, 409, authPage("Ese correo ya tiene cuenta. Entra con tu contraseña."));
        return redirect(res, "/panel", cookieHeader(sign(user), TTL));
      }

      if (path === "/panel/login" && req.method === "POST") {
        if (limited(req)) return html(res, 429, authPage("Demasiados intentos. Espera unos minutos."));
        const f = form(req.rawBody);
        const user = await store.login(normalizeEmail(f.email), String(f.password || ""));
        if (!user) return html(res, 401, authPage("Correo o contraseña incorrectos."));
        return redirect(res, "/panel", cookieHeader(sign(user), TTL));
      }

      const session = await currentUser(req);
      if (!session) return html(res, 200, authPage());
      const { user, csrf } = session;
      const tenantId = user.tenant_id;

      if (req.method === "POST") {
        const f = path.startsWith("/panel/whatsapp/embedded/") ? jsonBody(req) : form(req.rawBody);
        const sent = req.headers["x-csrf-token"] || f.csrf;
        if (!eq(sent, csrf)) return path.startsWith("/panel/whatsapp/embedded/") ? json(res, 403, { error: "csrf" }) : redirect(res, "/panel?n=csrf");

        if (path === "/panel/crm/stage") {
          const ok = store.query ? await crm.moveStage(store.query, { tenantId, contactId: f.contact_id, stage: f.stage, actor: `panel:${user.email}` }) : false;
          const back = crm.safeBack(f.back, "/panel/");
          return redirect(res, `${back}${back.includes("?") ? "&" : "?"}n=${ok ? "stage_ok" : "stage_err"}`);
        }
        if (path === "/panel/woo/sync") {
          const creds = await store.getWooCredentials(tenantId).catch(() => null);
          const r = creds && store.query ? await require("../lib/wooOrders").syncOrders(store.query, { tenantId, creds, fetchImpl }) : { ok: false };
          return redirect(res, `/panel/resultados?n=${r.ok ? "sync_ok" : "sync_err"}`);
        }
        if (path === "/panel/ajustes/web") {
          const list = String(f.origins || "").split(/[,\s]+/).map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
          const valid = list.length <= 5 && list.every((o) => { try { const u = new URL(o); return u.protocol === "https:" && u.origin === o; } catch { return false; } });
          if (!valid) return redirect(res, "/panel/ajustes?n=web_err#web");
          await store.setWidgetOrigins(tenantId, list);
          require("./chat")._tenantCache.clear();
          return redirect(res, "/panel/ajustes?n=web_ok#web");
        }
        if (path === "/panel/logout") { await store.bumpSession(user.id); return redirect(res, "/panel", cookieHeader("", 0)); }

        if (path === "/panel/woo/connect") {
          const storeUrl = woo.normalizeStoreUrl(f.store_url);
          if (!storeUrl) return redirect(res, "/panel?n=woo_err");
          const state = await store.createState({ tenantId, kind: "woo", storeUrl });
          return redirect(res, woo.buildAuthorizeUrl({ storeUrl, state, publicBaseUrl: baseUrl() }));
        }

        if (path === "/panel/whatsapp/connect") {
          const input = { accessToken: String(f.access_token || "").trim(), phoneNumberId: String(f.phone_number_id || "").trim(), wabaId: String(f.waba_id || "").trim() };
          const appSecret = String(f.app_secret || "").trim();
          if (!/^[a-f0-9]{32}$/i.test(appSecret)) return redirect(res, "/panel?n=wa_err");
          try {
            const info = await meta.validateAndSubscribe({ ...input, appSecret }, { fetchImpl });
            await store.saveWhatsApp(tenantId, { mode: "own_app", ...input, appSecret, displayPhone: info.displayPhone });
            await store.ensureVerifyTokenHash(tenantId, box.sha256(verifyTokenFor(tenantId)));
            return redirect(res, "/panel?n=wa_ok");
          } catch (error) {
            if (error.code === "23505") return redirect(res, "/panel?n=wa_taken");
            console.warn("[Panel] WhatsApp connect rejected:", safeError(error));
            return redirect(res, "/panel?n=wa_err");
          }
        }

        if (flag("WA_EMBEDDED_SIGNUP_ENABLED") && path === "/panel/whatsapp/embedded/start") {
          return json(res, 200, { state: await store.createState({ tenantId, kind: "meta_es" }) });
        }

        if (flag("WA_EMBEDDED_SIGNUP_ENABLED") && path === "/panel/whatsapp/embedded/complete") {
          const st = await store.consumeState(String(f.state || ""), "meta_es");
          if (!st || st.tenant_id !== tenantId) return json(res, 400, { error: "invalid_state" });
          const phoneNumberId = String(f.phone_number_id || ""), wabaId = String(f.waba_id || ""), code = String(f.code || "");
          if (!meta.ID_RE.test(phoneNumberId) || !meta.ID_RE.test(wabaId) || !code || code.length > 2048) return json(res, 400, { error: "invalid_input" });
          try {
            const accessToken = await meta.exchangeCode(code, { fetchImpl });
            const info = await meta.validateAndSubscribe({ accessToken, phoneNumberId, wabaId }, { fetchImpl });
            const pin = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
            await meta.registerPhone({ accessToken, phoneNumberId, pin }, { fetchImpl });
            // appSecret null => el webhook se verifica con META_APP_SECRET (app del Tech Provider).
            await store.saveWhatsApp(tenantId, { mode: "embedded_signup", accessToken, phoneNumberId, wabaId, appSecret: null, pin, displayPhone: info.displayPhone });
            return json(res, 200, { ok: true });
          } catch (error) {
            console.warn("[Panel] Embedded Signup failed:", safeError(error));
            return json(res, 502, { error: "meta_error" });
          }
        }
        return json(res, 404, { error: "not_found" });
      }

      if (path === "/panel/whatsapp/embedded" && flag("WA_EMBEDDED_SIGNUP_ENABLED")) {
        const nonce = crypto.randomBytes(16).toString("base64");
        const p = embeddedPage(csrf, nonce);
        return html(res, 200, p.body, p.csp);
      }
      const notice = req.query?.woo === "return" ? (String(req.query?.success) === "1" ? "woo_ok" : "woo_err") : req.query?.n;
      const ctx = { user, csrf, notice };
      const metrics = async () => (store.metrics ? store.metrics(tenantId).catch(() => ({})) : {});
      if (path === "/panel") return html(res, 200, homePage(ctx, await store.status(tenantId), await metrics()));
      if (path === "/panel/conexiones") {
        const verifyToken = verifyTokenFor(tenantId);
        await store.ensureVerifyTokenHash(tenantId, box.sha256(verifyToken));
        return html(res, 200, connectionsPage(ctx, await store.status(tenantId), verifyToken));
      }
      if (path === "/panel/conversaciones") {
        const sid = String(req.query?.s || "").slice(0, 200);
        if (sid) {
          const x = store.conversation ? await store.conversation(tenantId, sid) : null;
          if (!x) return html(res, 404, ui.errorPage("Conversación no encontrada", "Puede que no exista o sea de otra empresa.", "/panel/conversaciones", "Volver a conversaciones"));
          x.contact = store.query ? await crm.contactBySession(store.query, { tenantId, sessionId: sid }) : null;
          return html(res, 200, recordPage(ctx, sid, x));
        }
        return html(res, 200, conversationsPage(ctx, store.conversations ? await store.conversations(tenantId) : []));
      }
      if (path === "/panel/resultados") {
        const R = require("../lib/results");
        const st = await store.status(tenantId);
        const r = store.results ? await store.results(tenantId, req.query?.days || 30, { salesConnected: Boolean(st.woo_connected_at) }) : null;
        const sync = st.woo_connected_at ? `<form method="post" action="/panel/woo/sync" style="margin-top:12px"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn ghost full">Sincronizar pedidos ahora</button></form>` : `<a class="btn ghost full" style="margin-top:12px" href="/panel/conexiones#tienda">Conectar tienda</a>`;
        return html(res, 200, layout(ctx, "/panel/resultados", "Resultados", r ? R.resultsBody(ui, require("../lib/charts"), r, "/panel/resultados", sync) : ui.empty("chart", "Sin datos", "Aún no hay resultados.")));
      }
      if (path === "/panel/contactos" || path === "/panel/embudo") {
        const q = req.query || {}, filters = { q: q.q || "", stage: q.stage || "", channel: q.channel || "", sort: q.sort || "", dir: q.dir || "" };
        const rows = store.query ? await crm.listContacts(store.query, { tenantId, ...filters }) : [];
        const detail = (c) => `/panel/conversaciones?s=${encodeURIComponent(c.session_id)}`;
        if (path === "/panel/embudo") return html(res, 200, layout(ctx, path, "Embudo", `<div class="head"><div><h1>Embudo</h1><div class="muted">Mueve cada contacto a su etapa. Los pedidos atribuidos pasan solos a «Compró».</div></div><a class="btn ghost" href="/panel/contactos">Ver como tabla</a></div>${crm.kanban(rows, { detail, csrf, action: "/panel/crm/stage", back: "/panel/embudo" })}`));
        return html(res, 200, layout(ctx, path, "Contactos", `<div class="head"><div><h1>Contactos</h1><div class="muted">Todos tus clientes de WhatsApp y chat web.</div></div><a class="btn ghost" href="/panel/embudo">Ver embudo</a></div>${crm.contactsTable(rows, { base: "/panel/contactos", detail, filters, csrf, action: "/panel/crm/stage" })}`));
      }
      if (path === "/panel/ajustes") return html(res, 200, settingsPage(ctx));
      return html(res, 404, ui.errorPage("Página no encontrada", "El enlace no existe o cambió.", "/panel", "Volver a tu panel"));
    } catch (error) {
      console.error("[Panel] Error:", safeError(error));
      return html(res, 500, ui.errorPage("Algo salió mal", "No pudimos procesar la solicitud. Inténtalo de nuevo en unos minutos.", "/panel", "Volver a tu panel"));
    }
  };
}

module.exports = createPanel();
module.exports.createPanel = createPanel;
module.exports._test = { sign, readToken, csrfFor, verifyTokenFor, configured, COOKIE };
