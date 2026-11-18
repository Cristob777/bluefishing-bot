// Sistema de diseño compartido para /panel y /admin. Sin dependencias, sin JS (CSP estricta):
// drawer móvil con checkbox, toasts con animación CSS, iconos SVG inline.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  plug: '<path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  wa: '<path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 7.7 19.4z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.3-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/>',
  store: '<path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  msg: '<path d="M4 4h16v12H8l-4 4z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  hand: '<path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10M10 9.5v-6a1.5 1.5 0 0 1 3 0v6M13 9.5V5a1.5 1.5 0 0 1 3 0v7M16 9a1.5 1.5 0 0 1 3 0v4a8 8 0 0 1-8 8h-.5a7 7 0 0 1-5.4-2.6L3 16a1.5 1.5 0 0 1 2.3-2L7 15.5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrow: '<path d="M15 18l-6-6 6-6"/>',
  fish: '<path d="M2 12c3-5 9-7 14-4l4-3v14l-4-3c-5 3-11 1-14-4z"/><circle cx="14" cy="11" r="1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
};
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;

const CSS = `
:root{--bg:#f6f8fb;--card:#fff;--ink:#0f1b2d;--muted:#5b6b80;--line:#e4e9f0;--brand:#0a6cbd;--brand2:#0891b2;--brand-50:#eaf4fd;--ok:#0f9d6b;--ok-50:#e7f7f0;--warn:#b7791f;--warn-50:#fdf5e6;--err:#d64545;--err-50:#fdecec;--r:12px;--sh:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06);--sh2:0 10px 30px -12px rgba(16,24,40,.18)}
*{box-sizing:border-box}html,body{margin:0}body{font-family:Inter,"Inter var",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:22px;letter-spacing:-.02em;margin:0}h2{font-size:16px;margin:0 0 4px;letter-spacing:-.01em}h3{font-size:14px;margin:0 0 8px}
.muted{color:var(--muted)}.small{font-size:12.5px}
.app{display:grid;grid-template-columns:248px 1fr;min-height:100vh}
.side{background:#0b1f36;color:#c9d6e6;padding:18px 14px;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:10px;color:#fff;font-weight:700;font-size:15px;padding:4px 8px 18px}
.logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#1aa0e6,#0a6cbd);display:grid;place-items:center;color:#fff;box-shadow:0 4px 12px rgba(10,108,189,.45)}
.nav a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:#c9d6e6;font-weight:500}.nav a:hover{background:rgba(255,255,255,.06);text-decoration:none;color:#fff}
.nav a.on{background:rgba(26,160,230,.16);color:#fff;box-shadow:inset 2px 0 0 #1aa0e6}
.side .foot{margin-top:auto;font-size:12px;color:#7f93ab;padding:8px}
.main{min-width:0;display:flex;flex-direction:column}
.top{height:60px;background:rgba(255,255,255,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 28px;position:sticky;top:0;z-index:5}
.who{display:flex;align-items:center;gap:10px}.av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#0a6cbd,#0891b2);color:#fff;display:grid;place-items:center;font-weight:600;font-size:13px}
.who b{display:block;font-size:13.5px}.who span{font-size:12px;color:var(--muted)}
.content{padding:28px;max-width:1180px;width:100%}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh);padding:20px}
.grid{display:grid;gap:16px}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}.g2{grid-template-columns:repeat(2,1fr)}
.kpi{display:flex;gap:14px;align-items:center}.kpi .ic{width:42px;height:42px;border-radius:10px;display:grid;place-items:center;background:var(--brand-50);color:var(--brand)}
.kpi b{font-size:26px;letter-spacing:-.02em;display:block;line-height:1.1}.kpi span{color:var(--muted);font-size:12.5px}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px}
.b-ok{background:var(--ok-50);color:var(--ok)}.b-pend{background:var(--warn-50);color:var(--warn)}.b-off{background:#eef1f5;color:var(--muted)}.b-err{background:var(--err-50);color:var(--err)}.b-brand{background:var(--brand-50);color:var(--brand)}
.dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.svc{display:flex;flex-direction:column;gap:12px}.svc .row{display:flex;justify-content:space-between;align-items:center}
.svc .ic{width:40px;height:40px;border-radius:10px;display:grid;place-items:center}
.i-wa{background:#e8f8ef;color:#16a34a}.i-woo{background:#f2ecfb;color:#7c3aed}.i-web{background:var(--brand-50);color:var(--brand)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;background:var(--brand);color:#fff;font:inherit;font-weight:600;padding:9px 16px;border-radius:9px;cursor:pointer;box-shadow:0 1px 2px rgba(10,108,189,.3);text-decoration:none}
.btn:hover{background:#085a9e;text-decoration:none}.btn.ghost{background:#fff;color:var(--ink);border-color:var(--line);box-shadow:var(--sh)}.btn.ghost:hover{background:#f3f6fa}.btn.full{width:100%}
label{display:block;font-weight:500;font-size:13px;margin:14px 0 6px}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid #d5dde7;border-radius:9px;background:#fff;color:var(--ink);transition:border .15s,box-shadow .15s}
input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(10,108,189,.15)}
.help{font-size:12.5px;color:var(--muted);margin-top:6px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f5f9;border:1px solid var(--line);padding:2px 6px;border-radius:6px;font-size:12.5px;word-break:break-all}
details{border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-top:14px;background:#fbfcfe}details summary{cursor:pointer;font-weight:600;color:var(--brand)}details ol{margin:10px 0 0;padding-left:18px;color:var(--muted)}
.stepper{display:flex;gap:0;margin-top:14px}.st{flex:1;display:flex;align-items:center;gap:10px;position:relative;padding-right:12px}
.st .n{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:12.5px;background:#eef1f5;color:var(--muted);flex:none}
.st.done .n{background:var(--ok);color:#fff}.st.cur .n{background:var(--brand);color:#fff;box-shadow:0 0 0 4px var(--brand-50)}
.st:not(:last-child):after{content:"";flex:1;height:2px;background:var(--line);margin-left:6px}.st.done:not(:last-child):after{background:var(--ok)}
.st b{font-size:13px;white-space:nowrap}.st span{display:block;font-size:12px;color:var(--muted)}
.bar{height:8px;background:#eef1f5;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#1aa0e6,#0a6cbd);border-radius:99px}
table{width:100%;border-collapse:collapse}th{font-size:12px;font-weight:600;color:var(--muted);text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);background:#fafbfd}td{padding:12px 14px;border-bottom:1px solid #eef2f6;vertical-align:top}tr:last-child td{border-bottom:0}tbody tr:hover{background:#f8fbff}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r);background:#fff;box-shadow:var(--sh)}.tw table{min-width:620px}
.empty{text-align:center;padding:40px 20px;color:var(--muted)}.empty svg{color:#9fb6cf;margin-bottom:10px}.empty b{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}
.toast{position:fixed;right:20px;top:72px;z-index:50;display:flex;gap:10px;align-items:center;background:#0f1b2d;color:#fff;padding:12px 16px;border-radius:10px;box-shadow:var(--sh2);max-width:min(420px,calc(100vw - 40px));animation:tin .3s ease,tout .4s ease 5.5s forwards}
.toast.ok svg{color:#34d399}.toast.err svg{color:#f87171}
@keyframes tin{from{opacity:0;transform:translateY(-8px)}}@keyframes tout{to{opacity:0;transform:translateY(-8px);visibility:hidden}}
.list .it{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #eef2f6}.list .it:last-child{border:0}
.rec{display:grid;grid-template-columns:280px 1fr 280px;gap:16px;align-items:start}
.prop{padding:10px 0;border-bottom:1px solid #eef2f6}.prop:last-child{border:0}.prop span{display:block;font-size:12px;color:var(--muted)}.prop b{font-weight:500}
.tl{position:relative;padding-left:22px}.tl:before{content:"";position:absolute;left:7px;top:4px;bottom:4px;width:2px;background:var(--line)}
.ev{position:relative;margin-bottom:16px}.ev:before{content:"";position:absolute;left:-19px;top:6px;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid var(--brand)}
.bub{padding:10px 13px;border-radius:12px;margin:6px 0;white-space:pre-wrap;max-width:92%}.bub.u{background:#f1f5f9}.bub.a{background:var(--brand-50);margin-left:auto}
.kan{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);gap:14px;overflow-x:auto;padding-bottom:8px}
.col{background:#eef2f7;border-radius:var(--r);padding:12px;min-height:200px}.col h3{display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px}
.dcard{background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px 12px;margin-bottom:9px;box-shadow:var(--sh);display:block;color:var(--ink)}.dcard:hover{border-color:#b7d3ee;text-decoration:none}
.tabs{display:flex;gap:6px;flex-wrap:wrap}.tabs a{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);font-weight:500;font-size:13px}.tabs a.on{background:var(--ink);color:#fff;border-color:var(--ink)}.tabs a:hover{text-decoration:none}
.auth{min-height:100vh;display:grid;grid-template-columns:1fr 1fr}.auth .art{background:radial-gradient(1200px 500px at 20% 10%,#1aa0e6 0%,#0a6cbd 40%,#0b1f36 100%);color:#fff;padding:48px;display:flex;flex-direction:column;justify-content:space-between}
.auth .art h1{font-size:30px;line-height:1.2;max-width:420px}.auth .art p{color:#cfe3f7;max-width:420px}.auth .frm{display:grid;place-items:center;padding:32px}.auth .box{width:100%;max-width:400px}
.feat{display:flex;gap:10px;align-items:center;margin:10px 0;color:#e2effb}
.alert{display:flex;gap:8px;align-items:center;padding:10px 12px;border-radius:9px;font-size:13px;margin-bottom:12px}.alert.err{background:var(--err-50);color:var(--err)}.alert.ok{background:var(--ok-50);color:var(--ok)}
.burger,.scrim,#nav{display:none}
@media(max-width:1000px){.g4{grid-template-columns:repeat(2,1fr)}.rec{grid-template-columns:1fr}}
@media(max-width:860px){.app{grid-template-columns:1fr}.side{position:fixed;left:0;top:0;z-index:40;width:270px;transform:translateX(-100%);transition:transform .25s ease}
#nav:checked~.app .side{transform:none}#nav:checked~.scrim{display:block}.scrim{position:fixed;inset:0;background:rgba(15,27,45,.45);z-index:30}
.burger{display:grid;place-items:center;width:38px;height:38px;border-radius:9px;border:1px solid var(--line);background:#fff;cursor:pointer;margin-right:10px}
.top{padding:0 16px}.content{padding:18px 16px}.g3,.g2{grid-template-columns:1fr}.who .meta{display:none}.auth{grid-template-columns:1fr}.auth .art{padding:28px;min-height:auto}.auth .art .feats{display:none}
.stepper{flex-direction:column;gap:12px}.st:after{display:none}}
@media(max-width:480px){.g4{grid-template-columns:1fr 1fr}.kpi b{font-size:22px}.kpi .ic{width:36px;height:36px}.card{padding:16px}h1{font-size:19px}}
`;

function doc(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}
const initials = (s) => String(s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

function toast(kind, text) {
  if (!text) return "";
  return `<div class="toast ${kind}" role="status">${icon(kind === "ok" ? "check" : "alert")}<span>${esc(text)}</span></div>`;
}

// shell({ title, product, nav:[{href,label,icon,on}], user:{name,sub}, logout:{action,csrf}, body, toast:{kind,text} })
function shell(o) {
  const nav = o.nav.map((n) => `<a href="${n.href}" class="${n.on ? "on" : ""}">${icon(n.icon)}<span>${esc(n.label)}</span></a>`).join("");
  const csrf = o.logout.csrf ? `<input type="hidden" name="csrf" value="${esc(o.logout.csrf)}">` : "";
  return doc(o.title, `<input type="checkbox" id="nav"><label for="nav" class="scrim" aria-label="Cerrar menú"></label>
<div class="app"><aside class="side"><div class="brand"><span class="logo">${icon("fish", 18)}</span>${esc(o.product)}</div><nav class="nav">${nav}</nav>
<form method="post" action="${o.logout.action}" style="margin-top:8px">${csrf}<button class="btn ghost full" style="background:transparent;color:#c9d6e6;border-color:rgba(255,255,255,.14);box-shadow:none">${icon("out", 16)} Cerrar sesión</button></form>
<div class="foot">Blue Fishing · Matías IA</div></aside>
<div class="main"><header class="top"><div style="display:flex;align-items:center"><label for="nav" class="burger" aria-label="Abrir menú">${icon("menu")}</label><b>${esc(o.title)}</b></div>
<div class="who"><div class="meta" style="text-align:right"><b>${esc(o.user.name)}</b><span>${esc(o.user.sub || "")}</span></div><span class="av">${esc(initials(o.user.name))}</span></div></header>
<main class="content">${o.body}</main></div></div>${o.toast ? toast(o.toast.kind, o.toast.text) : ""}`);
}

function empty(ic, title, text, cta = "") {
  return `<div class="empty">${icon(ic, 40)}<b>${esc(title)}</b><div>${esc(text)}</div>${cta ? `<div style="margin-top:14px">${cta}</div>` : ""}</div>`;
}

function authLayout({ title, tagline, feats = [], form }) {
  return doc(title, `<div class="auth"><div class="art"><div class="brand" style="padding:0">${`<span class="logo">${icon("fish", 18)}</span>`}Blue Fishing</div>
<div><h1>${esc(tagline)}</h1><div class="feats" style="margin-top:22px">${feats.map((f) => `<div class="feat">${icon("check", 16)} ${esc(f)}</div>`).join("")}</div></div>
<p class="small">Tus claves se guardan cifradas. Nunca te las pedimos por chat.</p></div><div class="frm"><div class="box">${form}</div></div></div>`);
}

function errorPage(title, text, back, label) {
  return doc(title, `<div style="min-height:100vh;display:grid;place-items:center;padding:24px"><div class="card" style="max-width:420px;text-align:center">${icon("alert", 40)}<h1 style="margin:10px 0 6px">${esc(title)}</h1><p class="muted">${esc(text)}</p><a class="btn" href="${back}">${icon("arrow", 16)} ${esc(label)}</a></div></div>`);
}

const INTENTS = { buscar_producto: "Busca producto", consulta_ambigua: "Consulta general", precio: "Pregunta precio", stock: "Pregunta stock", saludo: "Saludo", handoff: "Pide humano", envio: "Envíos", sin_intent: "Sin clasificar" };
const intentLabel = (k) => INTENTS[k] || (k ? String(k).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "—");

module.exports = { esc, icon, shell, doc, empty, toast, authLayout, errorPage, intentLabel, initials, CSS };
