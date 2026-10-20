#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BLUEFISHING_BRANCH:-prod/hostinger-kvm4}"
ENV_FILE=".env.production"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.production.example and fill secrets." >&2
  exit 1
fi

chmod 600 "$ENV_FILE"

required=(
  BOT_DOMAIN
  POSTGRES_PASSWORD
  OPENAI_API_KEY
  VERIFY_TOKEN
  META_APP_SECRET
  WHATSAPP_TOKEN
  PHONE_NUMBER_ID
  HEALTHCHECK_TOKEN
  LOG_HASH_KEY
  ADMIN_DASHBOARD_USER
  ADMIN_DASHBOARD_PASSWORD
  ADMIN_SESSION_SECRET
)

for key in "${required[@]}"; do
  value="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  if [[ -z "$value" || "$value" == CHANGE_ME* ]]; then
    echo "Security preflight failed: $key is missing or still a placeholder." >&2
    exit 1
  fi
done

# Onboarding autoservicio (/panel): opcional. Si no se configura, /panel queda apagado (404)
# y el bot sigue igual. Si se configura, se valida el formato para no desplegar una clave débil.
envval() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true; }
CMK="$(envval CREDENTIALS_MASTER_KEY)"
PSS="$(envval PANEL_SESSION_SECRET)"
if [[ -n "$CMK" || -n "$PSS" ]]; then
  if ! [[ "$CMK" =~ ^[0-9a-fA-F]{64}$ ]] && [[ "$(printf '%s' "$CMK" | base64 -d 2>/dev/null | wc -c)" -ne 32 ]]; then
    echo "Security preflight failed: CREDENTIALS_MASTER_KEY must be 32 bytes (openssl rand -hex 32)." >&2
    exit 1
  fi
  if [[ ${#PSS} -lt 32 ]]; then
    echo "Security preflight failed: PANEL_SESSION_SECRET must be at least 32 chars." >&2
    exit 1
  fi
  echo "Onboarding panel: enabled."
else
  echo "Onboarding panel: disabled (CREDENTIALS_MASTER_KEY / PANEL_SESSION_SECRET not set)."
fi

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

export APP_COMMIT_SHA="$(git rev-parse HEAD)"

docker compose --env-file "$ENV_FILE" config >/dev/null
docker compose --env-file "$ENV_FILE" build --pull
docker compose --env-file "$ENV_FILE" up -d

# Migraciones idempotentes (seguras de repetir en una base existente).
for migration in db/migrations/*.sql; do
  [[ -f "$migration" ]] || continue
  docker compose --env-file "$ENV_FILE" exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"
done

docker compose --env-file "$ENV_FILE" exec -T app npm run sync-catalogo || true
docker compose --env-file "$ENV_FILE" exec -T app npm run enrich-catalogo || true
docker compose --env-file "$ENV_FILE" exec -T app npm run security:retention || true

echo
echo "Deployment complete."
docker compose --env-file "$ENV_FILE" ps
echo

HEALTHCHECK_TOKEN="$(grep '^HEALTHCHECK_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
AGENT_HOST_PORT="$(grep '^AGENT_HOST_PORT=' "$ENV_FILE" | cut -d= -f2- || true)"
AGENT_HOST_PORT="${AGENT_HOST_PORT:-18080}"

curl -fsS -H "X-Health-Token: $HEALTHCHECK_TOKEN" "http://127.0.0.1:$AGENT_HOST_PORT/health"
echo
echo "Local healthcheck passed. Public routing is a separate cutover step."
