#!/usr/bin/env bash
# Compila el frontend de Atomic CRM (SPA estática) en un commit fijado y lo deja en ATOMIC_CRM_OUTPUT_DIR.
# Uso: deploy/atomic-crm/build.sh    (requiere node 24 — ver .nvmrc de Atomic CRM —, git, rsync)
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Falta deploy/atomic-crm/.env (copiar .env.example)"; exit 1; }
set -a; . ./.env; set +a
case "${VITE_SB_PUBLISHABLE_KEY:-}" in
  "") echo "Falta VITE_SB_PUBLISHABLE_KEY"; exit 1;;
  sb_secret_*|*service_role*) echo "ERROR: eso es una clave SECRETA; usar la publicable"; exit 1;;
esac
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
git clone --quiet "$ATOMIC_CRM_REPO" "$WORK/atomic-crm"
git -C "$WORK/atomic-crm" checkout --quiet "$ATOMIC_CRM_REF"
cat > "$WORK/atomic-crm/.env.production.local" <<ENV
VITE_SUPABASE_URL=$VITE_SUPABASE_URL
VITE_SB_PUBLISHABLE_KEY=$VITE_SB_PUBLISHABLE_KEY
VITE_IS_DEMO=${VITE_IS_DEMO:-false}
VITE_ATTACHMENTS_BUCKET=${VITE_ATTACHMENTS_BUCKET:-attachments}
ENV
(cd "$WORK/atomic-crm" && npm ci --no-audit --no-fund && npm run build)
mkdir -p "$ATOMIC_CRM_OUTPUT_DIR"
rsync -a --delete "$WORK/atomic-crm/dist/" "$ATOMIC_CRM_OUTPUT_DIR/"
echo "OK: frontend en $ATOMIC_CRM_OUTPUT_DIR"
