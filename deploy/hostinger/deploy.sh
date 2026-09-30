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

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

export APP_COMMIT_SHA="$(git rev-parse HEAD)"

docker compose --env-file "$ENV_FILE" config >/dev/null
docker compose --env-file "$ENV_FILE" build --pull
docker compose --env-file "$ENV_FILE" up -d

docker compose --env-file "$ENV_FILE" exec -T app npm run sync-catalogo || true
docker compose --env-file "$ENV_FILE" exec -T app npm run enrich-catalogo || true
docker compose --env-file "$ENV_FILE" exec -T app npm run security:retention || true

echo
echo "Deployment complete."
docker compose --env-file "$ENV_FILE" ps
echo

BOT_DOMAIN="$(grep '^BOT_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
HEALTHCHECK_TOKEN="$(grep '^HEALTHCHECK_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"

curl -fsS -H "X-Health-Token: $HEALTHCHECK_TOKEN" "https://$BOT_DOMAIN/health"
echo
