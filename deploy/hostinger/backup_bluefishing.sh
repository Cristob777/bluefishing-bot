#!/usr/bin/env bash
# shellcheck disable=SC2016  # $POSTGRES_* se expanden dentro del contenedor, a propósito
# Backup del proyecto crm-bot: DB del bot, DB de Chatwoot y storage de Chatwoot.
# Sin secretos: las credenciales se leen dentro de cada contenedor.
# Cron sugerido (03:15 diario):
#   15 3 * * * cd /opt/crm-bot && deploy/hostinger/backup_bluefishing.sh >> /var/log/crm-bot-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE="${ENV_FILE:-.env.production}"
DEST="${BACKUP_DIR:-/var/backups/crm-bot}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DC=(docker compose --env-file "$ENV_FILE")
umask 077
# Directorio de backups: se crea ya con 0700 y dueño = usuario actual (sin chmod posterior que pueda fallar).
# Si ya existe y es de otro usuario, no se intenta chmod: solo se exige que sea escribible.
if [[ ! -d "$DEST" ]]; then
  install -d -m 700 "$DEST" || { echo "ERROR: no se pudo crear $DEST (ejecuta como root o define BACKUP_DIR)." >&2; exit 1; }
elif [[ -O "$DEST" ]]; then
  [[ "$(stat -c %a "$DEST")" == 700 ]] || chmod 700 "$DEST"
elif [[ ! -w "$DEST" ]]; then
  echo "ERROR: $DEST existe pero no es escribible por $(id -un) (ejecuta como root o define BACKUP_DIR)." >&2; exit 1
else
  echo "Aviso: $DEST pertenece a otro usuario; se usa sin cambiar permisos." >&2
fi
TS="$(date +%F_%H%M)"
dump() { # dump servicio archivo
  "${DC[@]}" exec -T "$1" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$2"
  [[ -s "$2" ]] || { echo "ERROR: dump vacío $2" >&2; rm -f "$2"; exit 1; }
}
dump db "$DEST/bot-$TS.dump"
if [[ -n "$("${DC[@]}" ps -q chatwoot-postgres)" ]]; then
  dump chatwoot-postgres "$DEST/chatwoot-$TS.dump"
  # chatwoot-rails puede no estar arriba (p. ej. backup previo en install.sh): se usa un contenedor efímero.
  if [[ -n "$("${DC[@]}" ps -q --status running chatwoot-rails)" ]]; then
    "${DC[@]}" exec -T chatwoot-rails tar -C /app/storage -czf - . > "$DEST/chatwoot-storage-$TS.tar.gz"
  else
    "${DC[@]}" run --rm --no-deps -T -l traefik.enable=false --entrypoint tar chatwoot-rails \
      -C /app/storage -czf - . > "$DEST/chatwoot-storage-$TS.tar.gz"
  fi
fi
chmod 600 "$DEST"/*-"$TS".* 
find "$DEST" -type f \( -name '*.dump' -o -name '*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) OK $TS -> $DEST"
# Recomendado: copia fuera del VPS (rclone/rsync cifrado de $DEST).
