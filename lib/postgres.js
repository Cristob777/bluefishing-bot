const { safeError } = require("./logSanitizer");
const DATABASE_URL = process.env.DATABASE_URL || "";

let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", (error) => {
      console.error("[Postgres] Pool error:", safeError(error));
    });
  }
  return pool;
}

async function query(text, params = []) {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL no configurado");
  return p.query(text, params);
}

async function ping() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query("select 1");
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getPool,
  query,
  ping,
  isConfigured: Boolean(DATABASE_URL),
};
