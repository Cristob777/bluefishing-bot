#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BLUEFISHING_BRANCH:-prod/hostinger-kvm4}"

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production. Copy .env.production.example and fill secrets." >&2
  exit 1
fi

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

export APP_COMMIT_SHA="$(git rev-parse HEAD)"
docker compose --env-file .env.production build --pull
docker compose --env-file .env.production up -d
docker compose --env-file .env.production exec -T app npm run sync-catalogo || true
docker compose --env-file .env.production exec -T app npm run enrich-catalogo || true

echo
echo "Deployment complete."
docker compose --env-file .env.production ps
echo
curl -fsS "https://$(grep '^BOT_DOMAIN=' .env.production | cut -d= -f2-)/health" || true
echo
