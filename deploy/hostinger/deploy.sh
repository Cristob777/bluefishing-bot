#!/usr/bin/env bash
# Actualiza el código de la rama de deploy y re-ejecuta el instalador idempotente.
set -euo pipefail
cd "$(dirname "$0")/../.."
BRANCH="${BLUEFISHING_BRANCH:-prod/hostinger-kvm4}"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
# install.sh respeta PROXY_MODE (traefik|nginx) de .env.production o del entorno.
# En modo nginx no toca Nginx: crm-bot.conf se gestiona aparte con nginx-site.sh.
exec bash deploy/hostinger/install.sh
