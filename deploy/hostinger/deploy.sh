#!/usr/bin/env bash
# Actualiza el código de la rama de deploy y re-ejecuta el instalador idempotente.
set -euo pipefail
cd "$(dirname "$0")/../.."
BRANCH="${BLUEFISHING_BRANCH:-prod/hostinger-kvm4}"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
exec bash deploy/hostinger/install.sh
