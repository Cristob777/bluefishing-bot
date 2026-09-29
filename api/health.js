const fs = require("node:fs");
const path = require("node:path");
const { OPENAI_MODEL } = require("../lib/ai");
const { hasPersistentStore } = require("../lib/sessionStore");

function countCatalog() {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "catalogo", "catalogo_para_bot.txt"), "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#")).length;
  } catch {
    return 0;
  }
}

function countKnowledge() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "product_knowledge.json"), "utf8"));
    return Object.keys(parsed || {}).length;
  } catch {
    return 0;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const checks = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID && process.env.VERIFY_TOKEN),
    webhook_ingress: Boolean(process.env.WEBHOOK_INGRESS_SECRET || process.env.META_APP_SECRET),
    persistent_store: hasPersistentStore,
    catalog_products: countCatalog(),
    knowledge_products: countKnowledge(),
  };

  const required = checks.openai && checks.whatsapp && checks.webhook_ingress && checks.catalog_products > 0;
  const status = required ? (checks.persistent_store ? "ok" : "degraded") : "not_ready";

  return res.status(status === "not_ready" ? 503 : 200).json({
    service: "bluefishing-whatsapp-bot",
    status,
    model: OPENAI_MODEL,
    checks,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || null,
  });
};
