const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("app no publica puertos al host y usa labels de Traefik configurables", () => {
  const compose = read("docker-compose.yml");
  const app = compose.slice(compose.indexOf("\n  app:"), compose.indexOf("\n  maintenance:"));
  assert.doesNotMatch(app, /\n    ports:/);
  assert.match(app, /traefik\.http\.services\.crmbot\.loadbalancer\.server\.port: "3000"/);
  assert.match(app, /certresolver: \$\{TRAEFIK_CERTRESOLVER/);
  assert.match(app, /PathPrefix\(`\/panel`\) \|\| PathPrefix\(`\/admin-chat`\)/);
  assert.match(app, /basicauth\.users: \$\{TRAEFIK_ADMIN_BASICAUTH_USERS:\?/);
  assert.match(compose, /pg_isready/);
});

test("migraciones re-ejecutables y deploy versionado", () => {
  for (const f of ["db/schema.sql", ...fs.readdirSync(path.join(__dirname, "../db/migrations")).map((f) => "db/migrations/" + f)]) {
    const sql = read(f);
    assert.doesNotMatch(sql, /create or replace view/i, f);
    for (const stmt of sql.match(/^\s*create (unique )?(table|index)[^\n]*/gim) || []) assert.match(stmt, /if not exists/i, f);
  }
  const mig = read("deploy/hostinger/migrate.sh");
  assert.match(mig, /set -euo pipefail/);
  assert.match(mig, /create table if not exists schema_migrations/);
  const inst = read("deploy/hostinger/install.sh");
  assert.match(inst, /set -euo pipefail/);
  assert.match(inst, /preflight\.sh/);
  assert.match(inst, /migrate\.sh/);
  assert.match(inst, /db:chatwoot_prepare/);
  assert.doesNotMatch(inst, /echo[^\n]*\$\(cat "\$PASS_FILE"\)/);
  assert.match(read("deploy/hostinger/deploy.sh"), /install\.sh/);
});

test(".env.production.example solo con placeholders en las 12 obligatorias", () => {
  const env = read(".env.production.example");
  for (const k of ["BOT_DOMAIN","POSTGRES_PASSWORD","OPENAI_API_KEY","VERIFY_TOKEN","META_APP_SECRET","WHATSAPP_TOKEN","PHONE_NUMBER_ID","HEALTHCHECK_TOKEN","LOG_HASH_KEY","ADMIN_DASHBOARD_USER","ADMIN_DASHBOARD_PASSWORD","ADMIN_SESSION_SECRET"])
    assert.match(env, new RegExp(`^${k}=CHANGE_ME`, "m"), k);
});

test("proyecto aislado crm-bot con Chatwoot y sin puertos al host", () => {
  const compose = read("docker-compose.yml");
  assert.match(compose, /^name: \$\{COMPOSE_PROJECT_NAME:-crm-bot\}/m);
  assert.doesNotMatch(compose, /^\s+ports:/m);
  for (const s of ["chatwoot-rails", "chatwoot-sidekiq", "chatwoot-postgres", "chatwoot-redis"]) assert.match(compose, new RegExp(`\n  ${s}:`));
  assert.match(compose, /pgvector\/pgvector:[0-9.]*-?pg16/);
  assert.match(compose, /Host\(`\$\{CHATWOOT_DOMAIN/);
});
