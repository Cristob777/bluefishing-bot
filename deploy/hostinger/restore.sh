#!/usr/bin/env bash
# shellcheck disable=SC2016  # $POSTGRES_* se expanden dentro del contenedor, a propósito
# Restore REAL (destructivo) de un backup de crm-bot. Exige CONFIRM=yes.
# Uso: CONFIRM=yes deploy/hostinger/restore.sh AAAA-MM-DD_HHMM
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE="${ENV_FILE:-.env.production}"; DEST="${BACKUP_DIR:-/var/backups/crm-bot}"; TS="${1:?uso: restore.sh <timestamp>}"
[[ "${CONFIRM:-}" == "yes" ]] || { echo "Destructivo: reemplaza las bases actuales. Repite con CONFIRM=yes." >&2; exit 1; }
# shellcheck source=deploy/hostinger/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"; set_dc  # respeta PROXY_MODE
"${DC[@]}" stop app maintenance chatwoot-rails chatwoot-sidekiq
restore_db() {
  "${DC[@]}" exec -T "$1" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' < "$2"
}
restore_db db "$DEST/bot-$TS.dump"
[[ -f "$DEST/chatwoot-$TS.dump" ]] && restore_db chatwoot-postgres "$DEST/chatwoot-$TS.dump"
if [[ -f "$DEST/chatwoot-storage-$TS.tar.gz" ]]; then
  "${DC[@]}" run --rm --no-deps -T -l traefik.enable=false --entrypoint sh chatwoot-rails -c 'tar -C /app/storage -xzf -' < "$DEST/chatwoot-storage-$TS.tar.gz"
fi
"${DC[@]}" up -d
echo "Restore completo ($TS). Recuerda: CREDENTIALS_MASTER_KEY debe ser la misma del backup."
