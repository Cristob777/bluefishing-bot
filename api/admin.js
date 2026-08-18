const schema = require("../catalogo/schema-enriquecimiento");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

function renderMissingConfigPage() {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>BlueFishing — Admin no configurado</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 640px; margin: 80px auto; line-height: 1.6;">
  <h1>Falta configurar Supabase</h1>
  <p>Definí <code>SUPABASE_URL</code> y <code>SUPABASE_ANON_KEY</code> como variables de entorno en Vercel
  (Project Settings → Environment Variables) y redeployá. Ver <code>supabase/schema.sql</code> y el
  README para el setup completo.</p>
</body></html>`;
}

function renderAdminPage() {
  const schemaJson = JSON.stringify(schema).replace(/</g, "\\u003c");
  const supabaseUrlJson = JSON.stringify(SUPABASE_URL);
  const supabaseAnonKeyJson = JSON.stringify(SUPABASE_ANON_KEY);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BlueFishing Bot — Entrenar catálogo</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #1a1d21; }
  header { background: #0b3d63; color: white; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .stats { font-size: 13px; opacity: 0.9; }
  #logout-btn { background: transparent; border: 1px solid rgba(255,255,255,0.4); color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }

  #login-screen { max-width: 360px; margin: 90px auto; background: white; padding: 28px; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  #login-screen h2 { margin-top: 0; font-size: 18px; }
  #login-screen input { width: 100%; padding: 9px 10px; margin-bottom: 10px; border: 1px solid #d3d7dc; border-radius: 6px; font-size: 14px; }
  #login-screen button { width: 100%; padding: 10px; background: #0b3d63; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  #login-error { color: #b3261e; font-size: 13px; min-height: 18px; margin-bottom: 6px; }

  #main-screen { display: flex; height: calc(100vh - 49px); }
  #product-list { width: 340px; flex-shrink: 0; background: white; border-right: 1px solid #e3e5e8; overflow-y: auto; }
  #product-list .toolbar { padding: 10px; border-bottom: 1px solid #eee; position: sticky; top: 0; background: white; }
  #product-list input[type="search"] { width: 100%; padding: 8px; border: 1px solid #d3d7dc; border-radius: 6px; font-size: 13px; margin-bottom: 6px; }
  #product-list label.filter { font-size: 12px; color: #555; display: flex; align-items: center; gap: 6px; }
  .product-item { padding: 10px 12px; border-bottom: 1px solid #f0f1f2; cursor: pointer; font-size: 13px; }
  .product-item:hover { background: #f6f9fc; }
  .product-item.active { background: #e8f1fa; }
  .product-item .name { font-weight: 500; margin-bottom: 3px; }
  .product-item .meta { color: #666; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: 600; }
  .badge.ok { background: #e3f4e6; color: #1e7b34; }
  .badge.pending { background: #fdecea; color: #b3261e; }

  #editor { flex: 1; overflow-y: auto; padding: 24px 32px; }
  #editor .placeholder { color: #888; font-size: 14px; margin-top: 60px; text-align: center; }
  #editor h2 { margin-top: 0; font-size: 18px; }
  #editor .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
  #editor a { color: #0b6ab3; }
  fieldset { border: 1px solid #e3e5e8; border-radius: 8px; margin-bottom: 16px; padding: 14px 16px; }
  legend { font-size: 12px; font-weight: 600; color: #444; text-transform: uppercase; letter-spacing: 0.03em; padding: 0 6px; }
  .field { margin-bottom: 14px; }
  .field label.field-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
  .field .help { font-size: 11.5px; color: #888; margin-top: 3px; }
  .field input[type="text"], .field textarea, .field select { width: 100%; padding: 8px 9px; border: 1px solid #d3d7dc; border-radius: 6px; font-size: 13.5px; font-family: inherit; }
  .field textarea { min-height: 60px; resize: vertical; }
  .checkbox-group { display: flex; flex-wrap: wrap; gap: 10px; }
  .checkbox-group label { font-size: 13px; display: flex; align-items: center; gap: 5px; background: #f2f4f6; padding: 5px 10px; border-radius: 14px; cursor: pointer; }
  .checkbox-group input { margin: 0; }

  #save-bar { position: sticky; bottom: 0; background: white; border-top: 1px solid #e3e5e8; padding: 12px 0; margin-top: 8px; display: flex; align-items: center; gap: 12px; }
  #save-btn { background: #0b6ab3; color: white; border: none; padding: 10px 22px; border-radius: 6px; font-size: 14px; cursor: pointer; }
  #save-btn:disabled { opacity: 0.6; cursor: default; }
  #save-status { font-size: 13px; color: #1e7b34; }

  .tab-bar { display: flex; gap: 4px; background: white; border-bottom: 1px solid #e3e5e8; padding: 0 20px; }
  .tab-btn { background: transparent; border: none; padding: 12px 14px; font-size: 13.5px; cursor: pointer; color: #555; border-bottom: 2px solid transparent; }
  .tab-btn.active { color: #0b3d63; border-bottom-color: #0b3d63; font-weight: 600; }
  .tab-panel[hidden] { display: none; }

  #chat-tab { display: flex; flex-direction: column; height: calc(100vh - 49px - 45px); max-width: 720px; margin: 0 auto; }
  #chat-messages { flex: 1; overflow-y: auto; padding: 20px; }
  .chat-msg { max-width: 75%; padding: 9px 13px; border-radius: 12px; margin-bottom: 4px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .chat-msg.user { background: #0b3d63; color: white; margin-left: auto; border-bottom-right-radius: 3px; }
  .chat-msg.assistant { background: white; border: 1px solid #e3e5e8; margin-right: auto; border-bottom-left-radius: 3px; }
  .chat-turn { margin-bottom: 14px; }
  .chat-turn-tools { margin-right: auto; max-width: 75%; margin-top: 3px; }
  .flag-btn { background: none; border: 1px solid #e3c2c0; color: #b3261e; font-size: 11px; padding: 3px 8px; border-radius: 10px; cursor: pointer; }
  .flag-btn.flagged { border-color: #c8dcc9; color: #1e7b34; cursor: default; }
  .correction-form { margin-top: 6px; background: #fff8f7; border: 1px solid #f0d4d2; border-radius: 8px; padding: 10px; max-width: 75%; }
  .correction-form textarea { width: 100%; font-size: 12.5px; padding: 6px 8px; border: 1px solid #d3d7dc; border-radius: 6px; min-height: 50px; font-family: inherit; }
  .correction-form .actions { display: flex; gap: 8px; margin-top: 6px; }
  .correction-form button { font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
  .correction-form .save-correction { background: #b3261e; color: white; border: none; }
  .correction-form .cancel-correction { background: transparent; border: 1px solid #ccc; }
  #chat-inputbar { display: flex; gap: 8px; padding: 14px 20px; border-top: 1px solid #e3e5e8; background: white; }
  #chat-input { flex: 1; padding: 10px 14px; border: 1px solid #d3d7dc; border-radius: 20px; font-size: 13.5px; }
  #chat-send-btn { background: #0b3d63; color: white; border: none; border-radius: 20px; padding: 0 18px; cursor: pointer; }
  #chat-hint { font-size: 12px; color: #888; padding: 8px 20px 0; }

  #feedback-tab { max-width: 820px; margin: 0 auto; padding: 20px; }
  .feedback-item { background: white; border: 1px solid #e3e5e8; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
  .feedback-item .fb-meta { font-size: 11.5px; color: #888; margin-bottom: 8px; display: flex; justify-content: space-between; }
  .feedback-item .fb-row { font-size: 13px; margin-bottom: 6px; }
  .feedback-item .fb-label { font-weight: 600; color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: .02em; }
  .feedback-item .fb-bad { color: #b3261e; }
  .feedback-item .fb-good { color: #1e7b34; }
  .resolve-btn { margin-top: 6px; background: #0b6ab3; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
  .status-pill { font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
  .status-pill.flagged { background: #fdecea; color: #b3261e; }
  .status-pill.resolved { background: #e3f4e6; color: #1e7b34; }
</style>
</head>
<body>

<div id="login-screen">
  <h2>BlueFishing Bot — Entrenar catálogo</h2>
  <p style="font-size:13px;color:#666;margin-top:-8px;">Ingresá con tu cuenta del equipo.</p>
  <div id="login-error"></div>
  <input id="login-email" type="email" placeholder="Email" autocomplete="username">
  <input id="login-password" type="password" placeholder="Contraseña" autocomplete="current-password">
  <button id="login-btn">Entrar</button>
</div>

<div id="app-screen" hidden>
  <header>
    <h1>BlueFishing Bot — Entrenar catálogo</h1>
    <div style="display:flex;align-items:center;gap:16px;">
      <span class="stats" id="stats-line"></span>
      <button id="logout-btn">Salir</button>
    </div>
  </header>
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="catalogo">Catálogo</button>
    <button class="tab-btn" data-tab="chat">Chat de prueba</button>
    <button class="tab-btn" data-tab="feedback">Correcciones</button>
  </div>

  <div id="catalogo-tab" class="tab-panel">
    <div id="main-screen">
      <aside id="product-list">
        <div class="toolbar">
          <input type="search" id="search-input" placeholder="Buscar producto...">
          <label class="filter"><input type="checkbox" id="filter-pending"> Solo sin entrenar</label>
        </div>
        <div id="product-items"></div>
      </aside>
      <main id="editor">
        <div class="placeholder">Elegí un producto de la lista para cargar su ficha técnica.</div>
      </main>
    </div>
  </div>

  <div id="chat-tab" class="tab-panel" hidden>
    <div id="chat-hint">Chateá con Matías como si fueras cliente. Si responde algo incorrecto, marcalo para dejar la corrección en cola de revisión.</div>
    <div id="chat-messages"></div>
    <div id="chat-inputbar">
      <input type="text" id="chat-input" placeholder="Escribí un mensaje de prueba..." maxlength="800">
      <button id="chat-send-btn">Enviar</button>
    </div>
  </div>

  <div id="feedback-tab" class="tab-panel" hidden>
    <div id="feedback-items"></div>
  </div>
</div>

<script type="module">
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SCHEMA = ${schemaJson};
const supabase = createClient(${supabaseUrlJson}, ${supabaseAnonKeyJson});

const loginScreen = document.getElementById("login-screen");
const appScreen = document.getElementById("app-screen");
const loginError = document.getElementById("login-error");
const productItemsEl = document.getElementById("product-items");
const editorEl = document.getElementById("editor");
const statsLine = document.getElementById("stats-line");
const searchInput = document.getElementById("search-input");
const filterPending = document.getElementById("filter-pending");

let products = [];
let attributesByUrl = new Map();
let currentUser = null;
let activeUrl = null;

function normList(value) {
  return (value || []).map((v) => String(v).trim()).filter(Boolean);
}

async function loadData() {
  const [{ data: productRows, error: productsError }, { data: attrRows, error: attrsError }] = await Promise.all([
    supabase.from("products").select("*").order("name"),
    supabase.from("product_attributes").select("*"),
  ]);

  if (productsError) throw productsError;
  if (attrsError) throw attrsError;

  products = productRows || [];
  attributesByUrl = new Map((attrRows || []).map((row) => [row.product_url, row]));
  renderStats();
  renderList();
}

function renderStats() {
  const trained = products.filter((p) => attributesByUrl.has(p.url)).length;
  statsLine.textContent = trained + "/" + products.length + " productos entrenados · " + (currentUser?.email || "");
}

function renderList() {
  const query = (searchInput.value || "").toLowerCase().trim();
  const onlyPending = filterPending.checked;

  const filtered = products.filter((p) => {
    const isTrained = attributesByUrl.has(p.url);
    if (onlyPending && isTrained) return false;
    if (!query) return true;
    return (p.name + " " + (p.brand || "") + " " + (p.category || "")).toLowerCase().includes(query);
  });

  productItemsEl.innerHTML = "";
  for (const p of filtered) {
    const isTrained = attributesByUrl.has(p.url);
    const item = document.createElement("div");
    item.className = "product-item" + (p.url === activeUrl ? " active" : "");
    item.innerHTML =
      '<div class="name">' + escapeHtml(p.name) + '</div>' +
      '<div class="meta"><span>' + escapeHtml(p.category || p.product_type || "") + '</span>' +
      '<span class="badge ' + (isTrained ? "ok" : "pending") + '">' + (isTrained ? "Entrenado" : "Pendiente") + '</span></div>';
    item.addEventListener("click", () => openEditor(p.url));
    productItemsEl.appendChild(item);
  }
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fieldsForProductType(productType) {
  const extra = SCHEMA.FIELDS_BY_PRODUCT_TYPE[productType] || [];
  if (productType === "combo") return [...extra, ...SCHEMA.COMBO_FIELDS];
  return extra;
}

function renderFieldInput(field, value) {
  const id = "field_" + field.key;
  const help = field.help ? '<div class="help">' + escapeHtml(field.help) + "</div>" : "";

  if (field.type === "select") {
    const options = ["", ...field.options].map((opt) => {
      const selected = value === opt ? " selected" : "";
      const label = opt === "" ? "— sin definir —" : opt;
      return '<option value="' + escapeHtml(opt) + '"' + selected + ">" + escapeHtml(label) + "</option>";
    }).join("");
    return '<div class="field"><label class="field-label" for="' + id + '">' + escapeHtml(field.label) + '</label>' +
      '<select id="' + id + '">' + options + "</select>" + help + "</div>";
  }

  if (field.type === "multiselect") {
    const selectedList = normList(value);
    const boxes = field.options.map((opt) => {
      const checked = selectedList.includes(opt) ? " checked" : "";
      return '<label><input type="checkbox" value="' + escapeHtml(opt) + '"' + checked + "> " + escapeHtml(opt) + "</label>";
    }).join("");
    return '<div class="field"><label class="field-label">' + escapeHtml(field.label) + '</label>' +
      '<div class="checkbox-group" id="' + id + '">' + boxes + "</div>" + help + "</div>";
  }

  if (field.type === "multiselect_tags") {
    const current = normList(value).join(", ");
    const datalist = (field.options || []).map((opt) => '<option value="' + escapeHtml(opt) + '">').join("");
    return '<div class="field"><label class="field-label" for="' + id + '">' + escapeHtml(field.label) + '</label>' +
      '<input type="text" id="' + id + '" list="' + id + '_list" value="' + escapeHtml(current) + '" placeholder="separar con comas">' +
      '<datalist id="' + id + '_list">' + datalist + "</datalist>" + help + "</div>";
  }

  if (field.type === "textarea") {
    return '<div class="field"><label class="field-label" for="' + id + '">' + escapeHtml(field.label) + '</label>' +
      '<textarea id="' + id + '">' + escapeHtml(value || "") + "</textarea>" + help + "</div>";
  }

  if (field.type === "boolean") {
    const checked = value ? " checked" : "";
    return '<div class="field"><label class="field-label"><input type="checkbox" id="' + id + '"' + checked + "> " + escapeHtml(field.label) + "</label>" + help + "</div>";
  }

  return '<div class="field"><label class="field-label" for="' + id + '">' + escapeHtml(field.label) + '</label>' +
    '<input type="text" id="' + id + '" value="' + escapeHtml(value || "") + '">' + help + "</div>";
}

function readFieldValue(field) {
  const id = "field_" + field.key;
  if (field.type === "multiselect") {
    const container = document.getElementById(id);
    return [...container.querySelectorAll("input:checked")].map((el) => el.value);
  }
  if (field.type === "multiselect_tags") {
    const raw = document.getElementById(id).value;
    return raw.split(",").map((v) => v.trim()).filter(Boolean);
  }
  if (field.type === "boolean") {
    return document.getElementById(id).checked;
  }
  return document.getElementById(id).value.trim();
}

function openEditor(url) {
  activeUrl = url;
  renderList();

  const product = products.find((p) => p.url === url);
  if (!product) return;
  const attrs = attributesByUrl.get(url) || {};
  const categoryFields = fieldsForProductType(product.product_type);

  const commonHtml = SCHEMA.COMMON_FIELDS.map((field) => {
    const value = field.key === "verified_notes" ? attrs.verified_notes : attrs[field.key];
    return renderFieldInput(field, value);
  }).join("");

  const extraValues = attrs.extra || {};
  const categoryHtml = categoryFields.map((field) => renderFieldInput(field, extraValues[field.key])).join("");

  editorEl.innerHTML =
    '<h2>' + escapeHtml(product.name) + "</h2>" +
    '<div class="subtitle">' + escapeHtml(product.price || "") + " · " + escapeHtml(product.category || "") +
    ' · <a href="' + escapeHtml(product.url) + '" target="_blank" rel="noopener">ver en la tienda ↗</a></div>' +
    '<fieldset><legend>Datos generales</legend>' + commonHtml + "</fieldset>" +
    (categoryHtml ? '<fieldset><legend>Specs de ' + escapeHtml(product.product_type || "categoría") + "</legend>" + categoryHtml + "</fieldset>" : "") +
    '<div id="save-bar"><button id="save-btn">Guardar ficha</button><span id="save-status"></span></div>';

  document.getElementById("save-btn").addEventListener("click", () => saveProduct(product, categoryFields));
}

async function saveProduct(product, categoryFields) {
  const saveBtn = document.getElementById("save-btn");
  const saveStatus = document.getElementById("save-status");
  saveBtn.disabled = true;
  saveStatus.textContent = "Guardando...";
  saveStatus.style.color = "#666";

  const commonValues = {};
  for (const field of SCHEMA.COMMON_FIELDS) {
    commonValues[field.key] = readFieldValue(field);
  }

  const extra = {};
  for (const field of categoryFields) {
    extra[field.key] = readFieldValue(field);
  }

  const row = {
    product_url: product.url,
    target_species: commonValues.target_species || [],
    water_type: commonValues.water_type || [],
    fishing_position: commonValues.fishing_position || [],
    technique: commonValues.technique || [],
    experience_level: commonValues.experience_level || null,
    verified_notes: commonValues.verified_notes || "",
    extra,
    updated_by: currentUser?.email || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("product_attributes").upsert(row, { onConflict: "product_url" });

  saveBtn.disabled = false;
  if (error) {
    saveStatus.textContent = "Error: " + error.message;
    saveStatus.style.color = "#b3261e";
    return;
  }

  attributesByUrl.set(product.url, row);
  saveStatus.textContent = "Guardado ✓";
  renderStats();
  renderList();
}

// ---------- Pestañas ----------

function switchTab(tab) {
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  document.getElementById("catalogo-tab").hidden = tab !== "catalogo";
  document.getElementById("chat-tab").hidden = tab !== "chat";
  document.getElementById("feedback-tab").hidden = tab !== "feedback";
  if (tab === "feedback") loadFeedback();
}

for (const btn of document.querySelectorAll(".tab-btn")) {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
}

// ---------- Chat de prueba ----------

function getTrainingSessionId() {
  let id = localStorage.getItem("bf_admin_chat_session");
  if (!id) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2));
    localStorage.setItem("bf_admin_chat_session", id);
  }
  return id;
}

const trainingSessionId = getTrainingSessionId();
const chatMessagesEl = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");
let chatTurnCounter = 0;

function renderCorrectionForm(container, turn) {
  const form = document.createElement("div");
  form.className = "correction-form";
  form.innerHTML =
    '<div class="fb-label">¿Cuál era la respuesta correcta?</div>' +
    '<textarea placeholder="Escribí lo que Matías debería haber respondido..."></textarea>' +
    '<div class="actions"><button class="save-correction">Guardar corrección</button><button class="cancel-correction">Cancelar</button></div>';

  const textarea = form.querySelector("textarea");
  form.querySelector(".cancel-correction").addEventListener("click", () => form.remove());
  form.querySelector(".save-correction").addEventListener("click", async () => {
    const correction = textarea.value.trim();
    const { error } = await supabase.from("chat_feedback").insert({
      session_id: trainingSessionId,
      user_message: turn.userMessage,
      bot_response: turn.botResponse,
      correction: correction || null,
      debug_snapshot: turn.debug || {},
      status: "flagged",
      flagged_by: currentUser?.email || null,
    });

    if (error) {
      form.querySelector(".fb-label").textContent = "Error: " + error.message;
      return;
    }

    form.remove();
    turn.flagBtn.textContent = "✓ Marcada";
    turn.flagBtn.className = "flag-btn flagged";
    turn.flagBtn.disabled = true;
  });

  container.appendChild(form);
}

function renderChatTurn(userMessage, botResponse, debug) {
  chatTurnCounter += 1;
  const turn = { userMessage, botResponse, debug };

  const userEl = document.createElement("div");
  userEl.className = "chat-turn";
  userEl.innerHTML = '<div class="chat-msg user"></div>';
  userEl.querySelector(".chat-msg").textContent = userMessage;
  chatMessagesEl.appendChild(userEl);

  const assistantWrap = document.createElement("div");
  assistantWrap.className = "chat-turn";
  const bubble = document.createElement("div");
  bubble.className = "chat-msg assistant";
  bubble.textContent = botResponse;
  assistantWrap.appendChild(bubble);

  const tools = document.createElement("div");
  tools.className = "chat-turn-tools";
  const flagBtn = document.createElement("button");
  flagBtn.className = "flag-btn";
  flagBtn.textContent = "👎 Marcar incorrecta";
  turn.flagBtn = flagBtn;
  flagBtn.addEventListener("click", () => renderCorrectionForm(assistantWrap, turn));
  tools.appendChild(flagBtn);
  assistantWrap.appendChild(tools);

  chatMessagesEl.appendChild(assistantWrap);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function sendTrainingMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  chatInput.disabled = true;
  chatSendBtn.disabled = true;

  const typingEl = document.createElement("div");
  typingEl.className = "chat-msg assistant";
  typingEl.style.color = "#888";
  typingEl.style.fontStyle = "italic";
  typingEl.textContent = "escribiendo...";
  chatMessagesEl.appendChild(typingEl);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/admin-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ sessionId: trainingSessionId, message: text }),
    });
    const data = await res.json();
    typingEl.remove();

    if (!res.ok) {
      renderChatTurn(text, "[Error] " + (data.error || "no se pudo responder"), {});
    } else {
      renderChatTurn(data.userMessage || text, data.reply, data.debug);
    }
  } catch (err) {
    typingEl.remove();
    renderChatTurn(text, "[Error de conexión] " + err.message, {});
  }

  chatInput.disabled = false;
  chatSendBtn.disabled = false;
  chatInput.focus();
}

chatSendBtn.addEventListener("click", sendTrainingMessage);
chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendTrainingMessage(); });

// ---------- Correcciones ----------

async function loadFeedback() {
  const feedbackEl = document.getElementById("feedback-items");
  feedbackEl.innerHTML = '<div class="placeholder">Cargando...</div>';

  const { data, error } = await supabase.from("chat_feedback").select("*").order("created_at", { ascending: false });
  if (error) {
    feedbackEl.innerHTML = '<div class="placeholder">Error: ' + escapeHtml(error.message) + "</div>";
    return;
  }

  if (!data.length) {
    feedbackEl.innerHTML = '<div class="placeholder">Sin correcciones cargadas todavía.</div>';
    return;
  }

  feedbackEl.innerHTML = "";
  for (const row of data) {
    const item = document.createElement("div");
    item.className = "feedback-item";
    item.innerHTML =
      '<div class="fb-meta"><span>' + escapeHtml(row.flagged_by || "—") + " · " + new Date(row.created_at).toLocaleString("es-CL") + '</span>' +
      '<span class="status-pill ' + row.status + '">' + (row.status === "resolved" ? "Resuelta" : "Pendiente") + "</span></div>" +
      '<div class="fb-row"><span class="fb-label">Cliente preguntó: </span>' + escapeHtml(row.user_message) + "</div>" +
      '<div class="fb-row fb-bad"><span class="fb-label">Bot respondió (incorrecto): </span>' + escapeHtml(row.bot_response) + "</div>" +
      (row.correction ? '<div class="fb-row fb-good"><span class="fb-label">Debería responder: </span>' + escapeHtml(row.correction) + "</div>" : "");

    if (row.status === "flagged") {
      const resolveBtn = document.createElement("button");
      resolveBtn.className = "resolve-btn";
      resolveBtn.textContent = "Marcar resuelta";
      resolveBtn.addEventListener("click", async () => {
        resolveBtn.disabled = true;
        await supabase.from("chat_feedback").update({
          status: "resolved",
          resolved_by: currentUser?.email || null,
          resolved_at: new Date().toISOString(),
        }).eq("id", row.id);
        loadFeedback();
      });
      item.appendChild(resolveBtn);
    }

    feedbackEl.appendChild(item);
  }
}

async function handleLogin() {
  loginError.textContent = "";
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = error.message;
    return;
  }
  currentUser = data.user;
  await enterApp();
}

async function enterApp() {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  try {
    await loadData();
  } catch (err) {
    editorEl.innerHTML = '<div class="placeholder">Error cargando el catálogo: ' + escapeHtml(err.message) + "</div>";
  }
}

document.getElementById("login-btn").addEventListener("click", handleLogin);
document.getElementById("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.reload();
});
searchInput.addEventListener("input", renderList);
filterPending.addEventListener("change", renderList);

(async () => {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    await enterApp();
  }
})();
</script>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(renderMissingConfigPage());
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(renderAdminPage());
};
