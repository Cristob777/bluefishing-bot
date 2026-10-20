const { query, isConfigured } = require("../lib/postgres");

const days = Math.max(1, Number(process.env.SECURITY_DATA_RETENTION_DAYS || 30));

async function main() {
  if (!isConfigured) {
    console.log("[Retention] DATABASE_URL not configured; nothing to clean.");
    return;
  }

  const interval = days + " days";

  await query("delete from processed_whatsapp_messages where created_at < now() - $1::interval", [interval]);
  await query("delete from bot_events where created_at < now() - $1::interval", [interval]);
  await query("delete from bot_sessions where updated_at < now() - $1::interval", [interval]);
  await query(
    "delete from handoff_requests where status='closed' and created_at < now() - ($1::interval * 3)",
    [interval]
  );

  console.log("[Retention] Cleanup complete", { retention_days: days });
}

main().catch((error) => {
  console.error("[Retention] Failed");
  process.exit(1);
});
