const fs = require("node:fs");
const path = require("node:path");
const { OPENAI_MODEL } = require("../lib/ai");
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
  const checks = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID && process.env.VERIFY_TOKEN),
    meta_signature: Boolean(process.env.META_APP_SECRET),
    database,
    persistence_backend: persistenceBackend,
    catalog_products: countCatalog(),
    knowledge_products: countKnowledge(),
  };

  const ready = checks.openai && checks.whatsapp && checks.meta_signature && checks.database && checks.catalog_products > 0;
  return res.status(ready ? 200 : 503).json({
    service: "bluefishing-whatsapp-bot",
    status: ready ? "ok" : "not_ready",
    model: OPENAI_MODEL,
    checks,
    commit: process.env.APP_COMMIT_SHA?.slice(0,12) || null,
  });
};
