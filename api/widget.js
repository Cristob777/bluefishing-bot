const WIDGET_SCRIPT = `
(function () {
  var scriptEl = document.currentScript;
  var config = {
    apiBase: (scriptEl && scriptEl.dataset.api) || (scriptEl ? scriptEl.src.replace(/\\/widget\\.js.*$/, "") : ""),
    color: (scriptEl && scriptEl.dataset.color) || "#0b3d63",
    greeting: (scriptEl && scriptEl.dataset.greeting) || "¡Hola! Soy Matías, el asistente de Bluefishing. ¿En qué te puedo ayudar?",
    position: (scriptEl && scriptEl.dataset.position === "left") ? "left" : "right",
  };

  var STORAGE_SESSION_KEY = "bf_chat_session_id";
  var STORAGE_HISTORY_KEY = "bf_chat_history";

  function getSessionId() {
    var id = localStorage.getItem(STORAGE_SESSION_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2));
      localStorage.setItem(STORAGE_SESSION_KEY, id);
    }
    return id;
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_HISTORY_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history.slice(-40)));
  }

  var sessionId = getSessionId();
  var history = loadHistory();
  var sideProp = config.position;

  var style = document.createElement("style");
  style.textContent =
    ".bf-chat-btn{position:fixed;bottom:20px;" + sideProp + ":20px;width:56px;height:56px;border-radius:50%;background:" + config.color + ";box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer;z-index:999998;display:flex;align-items:center;justify-content:center;border:none;padding:0;}" +
    ".bf-chat-btn svg{width:26px;height:26px;fill:#fff;}" +
    ".bf-chat-window{position:fixed;bottom:88px;" + sideProp + ":20px;width:340px;max-width:92vw;height:480px;max-height:75vh;background:#fff;border-radius:14px;box-shadow:0 6px 30px rgba(0,0,0,.25);z-index:999999;display:none;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;}" +
    ".bf-chat-window.open{display:flex;}" +
    ".bf-chat-header{background:" + config.color + ";color:#fff;padding:14px 16px;font-size:14px;font-weight:600;display:flex;justify-content:space-between;align-items:center;}" +
    ".bf-chat-header button{background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:0;}" +
    ".bf-chat-messages{flex:1;overflow-y:auto;padding:12px;background:#f5f6f8;}" +
    ".bf-msg{max-width:80%;padding:8px 12px;border-radius:12px;margin-bottom:8px;font-size:13.5px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;}" +
    ".bf-msg.user{background:" + config.color + ";color:#fff;margin-left:auto;border-bottom-right-radius:3px;}" +
    ".bf-msg.assistant{background:#fff;color:#1a1d21;border:1px solid #e3e5e8;margin-right:auto;border-bottom-left-radius:3px;}" +
    ".bf-msg.typing{color:#888;font-style:italic;}" +
    ".bf-chat-inputbar{display:flex;border-top:1px solid #e3e5e8;padding:8px;gap:8px;}" +
    ".bf-chat-inputbar input{flex:1;border:1px solid #d3d7dc;border-radius:20px;padding:9px 14px;font-size:13.5px;outline:none;min-width:0;}" +
    ".bf-chat-inputbar button{background:" + config.color + ";color:#fff;border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;flex-shrink:0;}" +
    ".bf-chat-inputbar button:disabled,.bf-chat-inputbar input:disabled{opacity:.6;}";
  document.head.appendChild(style);

  var button = document.createElement("button");
  button.className = "bf-chat-btn";
  button.type = "button";
  button.setAttribute("aria-label", "Abrir chat");
  button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

  var win = document.createElement("div");
  win.className = "bf-chat-window";
  win.innerHTML =
    '<div class="bf-chat-header"><span>Matías · Bluefishing</span><button type="button" aria-label="Cerrar">\\u2715</button></div>' +
    '<div class="bf-chat-messages"></div>' +
    '<div class="bf-chat-inputbar"><input type="text" placeholder="Escribe tu consulta..." maxlength="800"><button type="button" aria-label="Enviar">\\u27A4</button></div>';

  document.body.appendChild(button);
  document.body.appendChild(win);

  var messagesEl = win.querySelector(".bf-chat-messages");
  var inputEl = win.querySelector("input");
  var sendBtn = win.querySelector(".bf-chat-inputbar button");
  var closeBtn = win.querySelector(".bf-chat-header button");

  function renderMessage(role, text) {
    var el = document.createElement("div");
    el.className = "bf-msg " + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function renderHistory() {
    messagesEl.innerHTML = "";
    if (!history.length) {
      renderMessage("assistant", config.greeting);
    } else {
      history.forEach(function (m) { renderMessage(m.role, m.text); });
    }
  }

  var isOpen = false;
  function toggle() {
    isOpen = !isOpen;
    win.classList.toggle("open", isOpen);
    if (isOpen) {
      renderHistory();
      inputEl.focus();
    }
  }

  button.addEventListener("click", toggle);
  closeBtn.addEventListener("click", toggle);

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    inputEl.disabled = true;
    sendBtn.disabled = true;

    renderMessage("user", text);
    history.push({ role: "user", text: text });
    saveHistory(history);

    var typingEl = renderMessage("assistant typing", "escribiendo...");

    fetch(config.apiBase + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, message: text }),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        typingEl.remove();
        if (!result.ok) {
          renderMessage("assistant", "Disculpa, hubo un problema. Intenta de nuevo en un momento.");
          return;
        }
        renderMessage("assistant", result.data.reply);
        history.push({ role: "assistant", text: result.data.reply });
        saveHistory(history);
      })
      .catch(function () {
        typingEl.remove();
        renderMessage("assistant", "No pudimos conectar. Revisa tu conexión e intenta de nuevo.");
      })
      .then(function () {
        inputEl.disabled = false;
        sendBtn.disabled = false;
        inputEl.focus();
      });
  }

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") sendMessage();
  });
})();
`;

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(WIDGET_SCRIPT);
};
