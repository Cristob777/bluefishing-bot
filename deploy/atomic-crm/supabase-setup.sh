#!/usr/bin/env bash
# Aplica migraciones y edge functions de Atomic CRM a un proyecto Supabase cloud EXISTENTE
# (equivale a "Using An Existing Supabase Instance" de la doc oficial). Correr desde un PC del equipo, no en CI.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
: "${SUPABASE_PROJECT_REF:?definir SUPABASE_PROJECT_REF}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
git clone --quiet "$ATOMIC_CRM_REPO" "$WORK/atomic-crm"
git -C "$WORK/atomic-crm" checkout --quiet "$ATOMIC_CRM_REF"
cd "$WORK/atomic-crm"
npm ci --no-audit --no-fund
npx supabase login
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase secrets set SB_PUBLISHABLE_KEY="$VITE_SB_PUBLISHABLE_KEY"
npx supabase db push
npx supabase functions deploy
echo "OK. Ahora correr stages.sql en el SQL Editor (o configurar etapas en Settings)."
