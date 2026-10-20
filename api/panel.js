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

const CSS = "body{margin:0;background:#07111f;color:#edf5ff;font-family:system-ui,sans-serif}.w{max-width:760px;margin:auto;padding:24px}.card{background:#0d1b2e;border:1px solid #20364f;border-radius:14px;padding:16px;margin:14px 0}.muted{color:#93a9c2;font-size:13px}input,button{width:100%;box-sizing:border-box;padding:11px;margin:6px 0;border-radius:8px;border:1px solid #20364f;background:#0d1b2e;color:#edf5ff}button{cursor:pointer;background:#14406b}.ok{color:#5fd39a}.err{color:#ff8a8a}code{background:#13253b;padding:2px 5px;border-radius:5px;word-break:break-all}";
function page(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="w">${body}</div></body></html>`;
}

function authPage(msg = "") {
  return page("BlueFishing · Panel", `<h2>Panel de tu empresa</h2>${msg ? `<p class="err">${esc(msg)}</p>` : ""}
<div class="card"><h3>Entrar</h3><form method="post" action="/panel/login"><input name="email" type="email" placeholder="Correo" autocomplete="username" required><input name="password" type="password" placeholder="Contraseña" autocomplete="current-password" required><button>Entrar</button></form></div>
<div class="card"><h3>Crear cuenta</h3><form method="post" action="/panel/signup"><input name="company" placeholder="Nombre de la empresa" required maxlength="160"><input name="email" type="email" placeholder="Correo del dueño" autocomplete="username" required><input name="password" type="password" placeholder="Contraseña (mínimo 12 caracteres)" minlength="12" autocomplete="new-password" required><button>Crear cuenta</button></form></div>`);
}

const NOTICES = {
  woo_ok: ["ok", "Tienda conectada."], woo_err: ["err", "No pudimos conectar la tienda. Revisa la URL (https) e inténtalo de nuevo."],
  wa_ok: ["ok", "WhatsApp conectado y webhook suscrito."], wa_err: ["err", "Meta rechazó los datos de WhatsApp. Revisa token, Phone number ID y WABA ID."],
  csrf: ["err", "La sesión expiró, vuelve a intentarlo."],
};

function dashboardPage(user, st, csrf, verifyToken, notice) {
  const n = NOTICES[notice];
  const wooState = st.woo_connected_at ? `<p class="ok">Conectada: ${esc(st.woo_store_url)} (permiso ${esc(st.woo_key_permissions || "read")})</p>` : `<p class="muted">Sin conectar.</p>`;
  const waState = st.wa_connected_at ? `<p class="ok">Conectado: ${esc(st.wa_display_phone || st.wa_phone_number_id)} · modo ${esc(st.wa_mode)}</p>` : `<p class="muted">Sin conectar.</p>`;
  const es = flag("WA_EMBEDDED_SIGNUP_ENABLED") ? `<p><a style="color:#4fb8ff" href="/panel/whatsapp/embedded">Conectar con Facebook (Embedded Signup)</a></p>` : "";
  return page("BlueFishing · Panel", `<h2>${esc(user.tenant_name)}</h2><p class="muted">${esc(user.email)}</p>${n ? `<p class="${n[0]}">${esc(n[1])}</p>` : ""}
<div class="card"><h3>Tienda WooCommerce</h3>${wooState}<form method="post" action="/panel/woo/connect"><input type="hidden" name="csrf" value="${esc(csrf)}"><input name="store_url" type="url" placeholder="https://tutienda.cl" required><button>Conectar tienda</button></form><p class="muted">Te llevamos a tu WordPress para aprobar un acceso de solo lectura. Nunca vemos tu contraseña.</p></div>
<div class="card"><h3>WhatsApp</h3>${waState}${es}
<form method="post" action="/panel/whatsapp/connect"><input type="hidden" name="csrf" value="${esc(csrf)}">
<input name="access_token" type="password" placeholder="Token permanente (System User)" autocomplete="off" required>
<input name="phone_number_id" placeholder="Phone number ID" inputmode="numeric" required>
<input name="waba_id" placeholder="WhatsApp Business Account ID (WABA)" inputmode="numeric" required>
<input name="app_secret" type="password" placeholder="App secret de tu app de Meta" autocomplete="off" required>
<button>Conectar WhatsApp</button></form>
<p class="muted">En tu app de Meta configura el webhook con:<br>URL: <code>${esc(baseUrl())}/webhook</code><br>Verify token: <code>${esc(verifyToken)}</code><br>Campo suscrito: <code>messages</code></p></div>
<form method="post" action="/panel/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button>Salir</button></form>`);
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
      if (path !== "/panel") return html(res, 404, page("No encontrado", "No encontrado."));

      const verifyToken = verifyTokenFor(tenantId);
      await store.ensureVerifyTokenHash(tenantId, box.sha256(verifyToken));
      const notice = req.query?.woo === "return" ? (String(req.query?.success) === "1" ? "woo_ok" : "woo_err") : req.query?.n;
      return html(res, 200, dashboardPage(user, await store.status(tenantId), csrf, verifyToken, notice));
    } catch (error) {
      console.error("[Panel] Error:", safeError(error));
      return html(res, 500, page("Error", "No pudimos procesar la solicitud."));
    }
  };
}

module.exports = createPanel();
module.exports.createPanel = createPanel;
module.exports._test = { sign, readToken, csrfFor, verifyTokenFor, configured, COOKIE };
