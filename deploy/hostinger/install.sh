#!/usr/bin/env bash
# shellcheck disable=SC2016  # $POSTGRES_* se expanden dentro del contenedor, a propósito
# Instalador único e idempotente del proyecto Compose "crm-bot" (bot + Postgres + Chatwoot).
# Uso (en el VPS, desde la raíz del repo, p. ej. /opt/crm-bot):  bash deploy/hostinger/install.sh
# Se puede repetir: salta lo ya hecho (migraciones, admin, bot, tokens).
set -euo pipefail
cd "$(dirname "$0")/../.."
export ENV_FILE="${ENV_FILE:-.env.production}"
SECRETS_DIR="${SECRETS_DIR:-/root/.crm-bot}"
# shellcheck source=deploy/hostinger/lib.sh
source deploy/hostinger/lib.sh
MODE="$(proxy_mode)" || exit 1
set_dc   # PROXY_MODE=nginx agrega docker-compose.nginx.yml (sin Traefik, puertos solo en 127.0.0.1)
echo "PROXY_MODE=$MODE"

[[ -f "$ENV_FILE" ]] || { echo "Falta $ENV_FILE: cp .env.production.example $ENV_FILE y completa." >&2; exit 1; }
chmod 600 "$ENV_FILE"
set_env() { # set_env KEY VALUE  (reemplaza o agrega, sin imprimir el valor)
  local key="$1" val="$2" tmp
  tmp="$(mktemp "${ENV_FILE}.XXXX")"
  awk -v k="$key" -v v="$val" 'BEGIN{d=0} $0 ~ "^"k"=" {print k"="v; d=1; next} {print} END{if(!d) print k"="v}' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$ENV_FILE"
}

# 0) Variables obligatorias.
required=(BOT_DOMAIN POSTGRES_PASSWORD OPENAI_API_KEY VERIFY_TOKEN META_APP_SECRET WHATSAPP_TOKEN PHONE_NUMBER_ID
  HEALTHCHECK_TOKEN LOG_HASH_KEY ADMIN_DASHBOARD_USER ADMIN_DASHBOARD_PASSWORD ADMIN_SESSION_SECRET
  TRAEFIK_ADMIN_BASICAUTH_USERS CHATWOOT_DOMAIN CHATWOOT_SECRET_KEY_BASE CHATWOOT_POSTGRES_PASSWORD
  CHATWOOT_REDIS_PASSWORD CHATWOOT_ADMIN_EMAIL CHATWOOT_WEBHOOK_SECRET)
for key in "${required[@]}"; do
  value="$(envval "$key")"
  if [[ -z "$value" || "$value" == CHANGE_ME* ]]; then
    echo "Preflight: $key falta o sigue con placeholder." >&2; exit 1
  fi
done
CMK="$(envval CREDENTIALS_MASTER_KEY)"; PSS="$(envval PANEL_SESSION_SECRET)"
if [[ -n "$CMK" || -n "$PSS" ]]; then
  if ! [[ "$CMK" =~ ^[0-9a-fA-F]{64}$ ]] && [[ "$(printf '%s' "$CMK" | base64 -d 2>/dev/null | wc -c)" -ne 32 ]]; then
    echo "Preflight: CREDENTIALS_MASTER_KEY debe ser de 32 bytes (openssl rand -hex 32)." >&2; exit 1
  fi
  [[ ${#PSS} -ge 32 ]] || { echo "Preflight: PANEL_SESSION_SECRET debe tener 32+ caracteres." >&2; exit 1; }
fi

# 1) Preflight (solo lectura): Traefik en modo traefik; puertos locales libres en modo nginx.
bash deploy/hostinger/preflight.sh

export APP_COMMIT_SHA="${APP_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
"${DC[@]}" config --quiet
"${DC[@]}" build --pull app

wait_healthy() { # wait_healthy servicio [timeout]
  local svc="$1" timeout="${2:-180}" deadline id st
  deadline=$((SECONDS + timeout))
  echo "Esperando a $svc (máx ${timeout}s)..."
  while :; do
    id="$("${DC[@]}" ps -q "$svc")"
    st="$( [[ -n "$id" ]] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    [[ "$st" == "healthy" ]] && { echo "$svc healthy."; return 0; }
    (( SECONDS >= deadline )) && { echo "$svc no quedó healthy ($st). Revisa: docker compose logs $svc" >&2; return 1; }
    sleep 3
  done
}

# 2) Bases de datos y Redis.
"${DC[@]}" up -d db chatwoot-postgres chatwoot-redis
wait_healthy db; wait_healthy chatwoot-postgres; wait_healthy chatwoot-redis

# 3) Backup previo (solo si ya había datos) y migraciones del bot con schema_migrations.
# Una base nueva ya trae las tablas (initdb), así que "hay tabla contacts" no basta: se mira si migrate.sh
# ya corrió alguna vez (schema_migrations) o si hay filas reales.
HAS_DATA="$("${DC[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (to_regclass('"'"'public.schema_migrations'"'"') is not null) or exists(select 1 from contacts) or exists(select 1 from tenants)"' 2>/dev/null || echo f)"
if [[ "${SKIP_BACKUP:-0}" == "1" ]]; then
  echo "Backup previo: omitido (SKIP_BACKUP=1)."
elif [[ "$HAS_DATA" == "t" ]]; then
  bash deploy/hostinger/backup_bluefishing.sh
else
  echo "Backup previo: omitido, instalación nueva sin datos (no hay nada que respaldar)."
fi
bash deploy/hostinger/migrate.sh

# 4) Chatwoot: crea o migra su base (idempotente).
"${DC[@]}" run --rm --no-deps -l traefik.enable=false chatwoot-rails bundle exec rails db:chatwoot_prepare

# 5) Todo arriba y healthchecks.
"${DC[@]}" up -d
wait_healthy chatwoot-rails 600; wait_healthy app 240

# 6) Admin de Chatwoot + Agent Bot + webhook HMAC (idempotente). El password nunca va a stdout.
install -d -m 700 "$SECRETS_DIR"
PASS_FILE="$SECRETS_DIR/chatwoot_admin_password"
if [[ ! -s "$PASS_FILE" ]]; then
  ( umask 077; openssl rand -base64 24 | tr -d '\n' > "$PASS_FILE"; printf 'Aa1!' >> "$PASS_FILE" )
fi
chmod 600 "$PASS_FILE"
BOT_URL="$(envval CHATWOOT_BOT_WEBHOOK_URL)"; BOT_URL="${BOT_URL:-http://app:3000/chatwoot/webhook}"  # interna (red chatwoot), no sale por Traefik
LABELS_EMAIL="$(envval CHATWOOT_LABELS_EMAIL)"; LABELS_EMAIL="${LABELS_EMAIL:-crmbot-labels@$(envval CHATWOOT_DOMAIN)}"
RAILS_ID="$("${DC[@]}" ps -q chatwoot-rails)"
docker cp deploy/hostinger/chatwoot/bootstrap.rb "$RAILS_ID":/tmp/crmbot_bootstrap.rb
result="$(CW_ADMIN_PASSWORD="$(cat "$PASS_FILE")" CW_WEBHOOK_SECRET="$(envval CHATWOOT_WEBHOOK_SECRET)" \
  CW_ACCOUNT_NAME="$(envval CHATWOOT_ACCOUNT_NAME)" CW_ADMIN_NAME="$(envval CHATWOOT_ADMIN_NAME)" CW_ADMIN_NAME_DEFAULT="Equipo Blue Fishing" \
  CW_ADMIN_EMAIL="$(envval CHATWOOT_ADMIN_EMAIL)" CW_BOT_URL="$BOT_URL" \
  CW_LABELS_EMAIL="${LABELS_EMAIL}" \
  "${DC[@]}" exec -T -e CW_ADMIN_PASSWORD -e CW_WEBHOOK_SECRET -e CW_ACCOUNT_NAME -e CW_ADMIN_NAME -e CW_ADMIN_NAME_DEFAULT -e CW_ADMIN_EMAIL -e CW_BOT_URL -e CW_LABELS_EMAIL \
  chatwoot-rails bundle exec rails runner /tmp/crmbot_bootstrap.rb | grep '^CRMBOT_RESULT ' | tail -n1)"
[[ -n "$result" ]] || { echo "Bootstrap de Chatwoot no devolvió resultado. Revisa: docker compose logs chatwoot-rails" >&2; exit 1; }

# 6b) Onboarding de Chatwoot ("Howdy, Welcome to Chatwoot"): bootstrap.rb lo cierra tras crear el admin.
# Se verifica por HTTP: si sigue abierto, cualquiera podría crear la cuenta admin. Falla ruidosamente.
onboarding_open() { # imprime el motivo y devuelve 0 si está abierto o no se pudo verificar (falla cerrado)
  "${DC[@]}" exec -T chatwoot-rails ruby -rnet/http -e '
    begin
      root = Net::HTTP.get_response(URI("http://127.0.0.1:3000/"))
      onb  = Net::HTTP.get_response(URI("http://127.0.0.1:3000/installation/onboarding"))
    rescue => e
      puts "no se pudo verificar: #{e.class}"; exit 0
    end
    if root["location"].to_s.include?("installation/onboarding") || onb.code == "200"
      puts "GET / -> #{root.code} #{root["location"]}; GET /installation/onboarding -> #{onb.code}"; exit 0
    end
    exit 1'
}
if why="$(onboarding_open)"; then
  echo "ERROR CRÍTICO: el onboarding de Chatwoot sigue abierto ($why). Cualquiera podría crear el admin." >&2
  echo "Ciérralo: docker compose exec chatwoot-rails bundle exec rails runner 'Redis::Alfred.delete(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)'" >&2
  exit 1
fi
echo "Onboarding de Chatwoot cerrado (verificado por HTTP)."

# 7) Guardar tokens en .env.production (idempotente, sin imprimirlos).
for kv in ${result#CRMBOT_RESULT }; do
  k="${kv%%=*}"; v="${kv#*=}"
  [[ -n "$v" ]] && set_env "$k" "$v"
done
[[ -n "$(envval CHATWOOT_BASE_URL)" ]] || set_env CHATWOOT_BASE_URL "http://chatwoot-rails:3000"
set_env CHATWOOT_ENABLED true
"${DC[@]}" up -d --force-recreate --no-deps app
wait_healthy app 240

# 8) Catálogo y retención (no bloquean).
"${DC[@]}" exec -T app node scripts/sync-catalogo.js || true
"${DC[@]}" exec -T app node scripts/enrich-catalogo.js || true
"${DC[@]}" exec -T app node scripts/security-retention.js || true

"${DC[@]}" ps
if [[ "$MODE" == "nginx" ]]; then
  cat <<MSG

PROXY_MODE=nginx: el bot escucha en 127.0.0.1:$(envval BOT_LOCAL_PORT | grep . || echo 18080) y Chatwoot en 127.0.0.1:$(envval CHATWOOT_LOCAL_PORT | grep . || echo 18081).
Publicar los dominios (una vez; crea solo conf.d/crm-bot.conf, nginx -t antes de recargar):
  sudo bash deploy/hostinger/nginx-site.sh install
  sudo certbot --nginx -d $(envval BOT_DOMAIN) -d $(envval CHATWOOT_DOMAIN)
MSG
fi
cat <<MSG

Instalación completa.
- Bot:      https://$(envval BOT_DOMAIN)/health
- Chatwoot: https://$(envval CHATWOOT_DOMAIN)  usuario $(envval CHATWOOT_ADMIN_EMAIL)
- Password del admin de Chatwoot: archivo $PASS_FILE (0600). Cámbialo tras el primer login.
MSG
