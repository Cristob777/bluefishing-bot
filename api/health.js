const fs = require("node:fs");
const path = require("node:path");
const { hasPersistentStore, persistenceBackend } = require("../lib/sessionStore");
const { ping } = require("../lib/postgres");

function countCatalog() {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt"), "utf8")
      .split("\n").filter((line) => line.trim() && !line.startsWith("#")).length;
  } catch { return 0; }
}

function countKnowledge() {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "product_knowledge.json"), "utf8")) || {}).length;
  } catch { return 0; }
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const database = persistenceBackend === "postgres" ? await ping() : hasPersistentStore;
  const ready =
    Boolean(process.env.OPENAI_API_KEY) &&
    Boolean(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID && process.env.VERIFY_TOKEN) &&
    Boolean(process.env.META_APP_SECRET) &&
    Boolean(database) &&
    countCatalog() > 0;

  const supplied = String(req.headers?.["x-health-token"] || "");
  const authorized = Boolean(process.env.HEALTHCHECK_TOKEN) && supplied === process.env.HEALTHCHECK_TOKEN;

  if (!authorized) {
    return res.status(ready ? 200 : 503).json({
      service: "bluefishing-whatsapp-bot",
      status: ready ? "ok" : "not_ready"
    });
  }

  return res.status(ready ? 200 : 503).json({
    service: "bluefishing-whatsapp-bot",
    status: ready ? "ok" : "not_ready",
    checks: {
      database: Boolean(database),
      catalog: countCatalog() > 0,
      knowledge: countKnowledge() > 0
    },
    commit: process.env.APP_COMMIT_SHA?.slice(0,12) || null
  });
};
