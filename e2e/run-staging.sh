#!/usr/bin/env bash
# Prueba de punta a punta ANTES del deploy: levanta server.js real contra un Postgres real
# (base desechable bf_e2e) y simula OpenAI, Bsale, Meta y Chatwoot. No usa credenciales reales
# ni toca servicios externos. Uso:
#   E2E_PG_ADMIN_URL=postgresql://postgres@localhost:5432/postgres bash e2e/run-staging.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_URL="${E2E_PG_ADMIN_URL:-postgresql://postgres@localhost:5432/postgres}"
DB=bf_e2e
DB_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/'"$DB"'";console.log(u.toString())' "$ADMIN_URL")"
export E2E_MOCK_PORT="${E2E_MOCK_PORT:-4010}"
M="http://127.0.0.1:${E2E_MOCK_PORT}"

echo "== Base desechable $DB"
psql "$ADMIN_URL" -q -c "drop database if exists $DB" -c "create database $DB"
for f in db/schema.sql db/migrations/*.sql; do psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "Migración falló: $f"; exit 1; }; done

export PORT="${E2E_PORT:-3300}" NODE_ENV=production DATABASE_URL="$DB_URL"
export OPENAI_API_KEY=sk-e2e OPENAI_BASE_URL="$M/openai/v1"
export BSALE_ACCESS_TOKEN=bsale-staging-token BSALE_API_URL="$M/bsale/v1"
export VERIFY_TOKEN=vt-staging WHATSAPP_TOKEN=wa-staging-token PHONE_NUMBER_ID=123456 META_APP_SECRET=app-secret-staging GRAPH_API_BASE_URL="$M/graph"
export CHATWOOT_ENABLED=true CHATWOOT_BASE_URL="$M/chatwoot" CHATWOOT_BOT_TOKEN=cw-bot CHATWOOT_LABELS_TOKEN=cw-labels CHATWOOT_WEBHOOK_SECRET=cw-secret
export ADMIN_DASHBOARD_USER=admin ADMIN_DASHBOARD_PASSWORD=staging-pass-123456 ADMIN_SESSION_SECRET=e2e-session-secret-0123456789abcdef
export ALLOWED_ORIGIN=https://bluefishing.cl LOG_HASH_KEY=e2e-log-hash-key
export E2E_MOCK_LOG="$PWD/e2e/.mock-log.jsonl"

LOGDIR="$(mktemp -d)"
node e2e/mocks.js >"$LOGDIR/mocks.log" 2>&1 & MOCKS=$!
node server.js >"$LOGDIR/server.log" 2>&1 & SERVER=$!
trap 'kill $MOCKS $SERVER 2>/dev/null || true; rm -f "$E2E_MOCK_LOG"' EXIT
for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done

echo "== Escenarios"
if node e2e/run.js; then
  echo "== OK. Logs: $LOGDIR"
else
  echo "== FALLÓ. Revisa $LOGDIR/server.log"; tail -30 "$LOGDIR/server.log"; exit 1
fi
