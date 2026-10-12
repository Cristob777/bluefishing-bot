/**
 * Servidor Express para correr Bluefishing Bot en un VPS (Hostinger) de forma
 * permanente, sin Vercel. Monta las mismas rutas que vercel.json y reutiliza
 * los handlers de api/*.js tal cual (son (req, res) estilo Vercel, compatibles
 * con Express: usan req.query, req.body, res.status().json()/send(), etc).
 */
// Cargar .env ANTES de require de los handlers (leen process.env al importar).
try {
  require("dotenv").config();
} catch (_) {
  // dotenv es opcional si las vars ya vienen del entorno / PM2.
}

const express = require("express");

const webhook = require("./api/webhook");
const admin = require("./api/admin");
const chat = require("./api/chat");
const widget = require("./api/widget");
const adminChat = require("./api/admin-chat");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Parseo de JSON para /chat, /admin-chat y el POST del webhook de Meta.
// El webhook de Meta no verifica firma en este proyecto, así que no se
// necesita raw body; si en el futuro se agrega X-Hub-Signature-256, cambiar
// a express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }).
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Rutas (equivalentes a routes[] de vercel.json)
app.get("/webhook", webhook);
app.post("/webhook", webhook);
app.post("/chat", chat);
app.options("/chat", chat); // CORS preflight del widget
app.get("/widget.js", widget);
app.get("/admin", admin);
app.post("/admin-chat", adminChat);

// Healthcheck simple para PM2 / proxy
app.get("/", (req, res) => res.status(200).send("Bluefishing bot OK"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] Bluefishing bot escuchando en puerto ${PORT}`);
  });
}

module.exports = app;
