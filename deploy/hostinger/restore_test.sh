#!/usr/bin/env bash
# shellcheck disable=SC2016  # $POSTGRES_* se expanden dentro del contenedor, a propósito
# Prueba de restore SIN tocar producción: restaura los dumps en DBs temporales, cuenta filas y las borra.
# Uso: deploy/hostinger/restore_test.sh AAAA-MM-DD_HHMM   (marca de tiempo de backup_bluefishing.sh)
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE="${ENV_FILE:-.env.production}"; DEST="${BACKUP_DIR:-/var/backups/crm-bot}"; TS="${1:?uso: restore_test.sh <timestamp>}"
DC=(docker compose --env-file "$ENV_FILE")
try() { # try servicio dump consulta
  local svc="$1" f="$2" q="$3"
  [[ -f "$f" ]] || { echo "skip $f (no existe)"; return; }
  "${DC[@]}" exec -T "$svc" sh -c 'dropdb -U "$POSTGRES_USER" --if-exists restore_test && createdb -U "$POSTGRES_USER" restore_test'
  "${DC[@]}" exec -T "$svc" sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_test --no-owner --exit-on-error' < "$f"
  "${DC[@]}" exec -T "$svc" sh -c "psql -U \"\$POSTGRES_USER\" -d restore_test -Atc \"$q\""
  "${DC[@]}" exec -T "$svc" sh -c 'dropdb -U "$POSTGRES_USER" restore_test'
  echo "Restore OK: $f"
}
try db "$DEST/bot-$TS.dump" "select 'contacts', count(*) from contacts union all select 'tenants', count(*) from tenants"
try chatwoot-postgres "$DEST/chatwoot-$TS.dump" "select 'accounts', count(*) from accounts union all select 'conversations', count(*) from conversations"
S="$DEST/chatwoot-storage-$TS.tar.gz"
if [[ -f "$S" ]]; then tar -tzf "$S" >/dev/null && echo "Storage OK: $S ($(tar -tzf "$S" | wc -l) entradas)"; fi
