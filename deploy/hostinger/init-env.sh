#!/usr/bin/env bash
# Crea o completa .env.production para el primer deploy.
#
#   bash deploy/hostinger/init-env.sh
#
# - Genera TODOS los secretos internos (Postgres, sesiones, cifrado, Chatwoot, basic auth).
# - Pregunta solo lo que viene de afuera: dominios, email del admin, OpenAI y Meta.
#   Las claves se piden sin eco (no quedan en pantalla ni en el historial).
# - Idempotente: solo completa claves vacías o con CHANGE_ME. Nunca pisa un valor ya puesto.
# - Las contraseñas de acceso humano (/admin y basic auth de /panel) se guardan en
#   $SECRETS_DIR/credenciales-iniciales (0600), nunca se imprimen.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE="${ENV_FILE:-.env.production}"
SECRETS_DIR="${SECRETS_DIR:-/root/.crm-bot}"
CREDS_FILE="$SECRETS_DIR/credenciales-iniciales"

command -v openssl >/dev/null || { echo "Falta openssl." >&2; exit 1; }
umask 077

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.production.example "$ENV_FILE"
  echo "Creado $ENV_FILE desde la plantilla."
fi
chmod 600 "$ENV_FILE"
mkdir -p "$SECRETS_DIR" && chmod 700 "$SECRETS_DIR"

current() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true; }
missing() { local v; v="$(current "$1")"; [[ -z "$v" || "$v" == CHANGE_ME* ]]; }
set_kv() { # set_kv KEY VALUE — reemplaza o agrega sin imprimir el valor (ENVIRON: sin escapes de awk)
  local tmp; tmp="$(mktemp "${ENV_FILE}.XXXX")"
  K="$1" V="$2" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]; d=0}
    index($0, k"=")==1 {print k"="v; d=1; next} {print} END{if(!d) print k"="v}' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$ENV_FILE"
}
gen() { missing "$1" && set_kv "$1" "$2" && echo "  generado  $1" || echo "  ya estaba $1"; }
hex() { openssl rand -hex "$1"; }
b64() { openssl rand -base64 "$1" | tr -d '\n'; }
ask() { # ask KEY "pregunta" [default] — texto visible
  missing "$1" || { echo "  ya estaba $1"; return 0; }
  local ans; read -r -p "$2${3:+ [$3]}: " ans; ans="${ans:-${3:-}}"
  [[ -n "$ans" ]] && set_kv "$1" "$ans" || echo "  (vacío) $1 — complétalo antes de install.sh"
}
ask_secret() { # ask_secret KEY "pregunta" — sin eco
  missing "$1" || { echo "  ya estaba $1"; return 0; }
  local ans; read -r -s -p "$2 (no se muestra; Enter para dejar pendiente): " ans; echo
  [[ -n "$ans" ]] && set_kv "$1" "$ans" || echo "  (pendiente) $1 — complétalo antes de install.sh"
}
bcrypt() { # bcrypt USER PASS -> user:hash (formato htpasswd)
  if command -v htpasswd >/dev/null; then htpasswd -nbB "$1" "$2"
  elif command -v docker >/dev/null; then docker run --rm httpd:2.4-alpine htpasswd -nbB "$1" "$2"
  else echo "Necesito htpasswd (apt install apache2-utils) o docker para el hash bcrypt." >&2; return 1; fi
}

echo "== Datos externos =="
ask BOT_DOMAIN "Dominio del bot (sin https)" "bot.bluefishing.cl"
ask CHATWOOT_DOMAIN "Dominio de Chatwoot (sin https)" "chat.bluefishing.cl"
ask CHATWOOT_ADMIN_EMAIL "Email del admin de Chatwoot"
ask ADMIN_DASHBOARD_USER "Usuario para /admin" "admin"
if [[ "$(current PROXY_MODE)" != "tunnel" && "$(current PROXY_MODE)" != "nginx" ]]; then
  echo "Cómo se publica el bot en internet:"
  echo "  1) tunnel — Cloudflare Tunnel: independiente del Nginx de otros sitios del VPS (recomendado)"
  echo "  2) nginx  — usa el Nginx del host + certbot"
  read -r -p "Elige 1 o 2 [1]: " pm
  case "${pm:-1}" in 2) set_kv PROXY_MODE nginx ;; *) set_kv PROXY_MODE tunnel ;; esac
  echo "  PROXY_MODE=$(current PROXY_MODE)"
fi
if [[ "$(current PROXY_MODE)" == "tunnel" ]]; then
  ask_secret CLOUDFLARE_TUNNEL_TOKEN "CLOUDFLARE_TUNNEL_TOKEN (Cloudflare → Zero Trust → Networks → Tunnels → tu túnel)"
fi
ask_secret OPENAI_API_KEY "OPENAI_API_KEY"
ask_secret META_APP_SECRET "META_APP_SECRET (Meta → app → Configuración → Básica)"
ask_secret WHATSAPP_TOKEN "WHATSAPP_TOKEN (token permanente del usuario del sistema)"
ask PHONE_NUMBER_ID "PHONE_NUMBER_ID (WhatsApp → Configuración de la API)"

echo "== Secretos internos =="
gen POSTGRES_PASSWORD "$(hex 24)"
gen VERIFY_TOKEN "$(hex 16)"
gen HEALTHCHECK_TOKEN "$(hex 32)"
gen LOG_HASH_KEY "$(hex 32)"
gen ADMIN_SESSION_SECRET "$(hex 32)"
gen CREDENTIALS_MASTER_KEY "$(hex 32)"
gen PANEL_SESSION_SECRET "$(b64 48)"
gen CHATWOOT_SECRET_KEY_BASE "$(hex 64)"
gen CHATWOOT_POSTGRES_PASSWORD "$(hex 24)"
gen CHATWOOT_REDIS_PASSWORD "$(hex 24)"
gen CHATWOOT_WEBHOOK_SECRET "$(hex 32)"

# Contraseñas de acceso humano: se generan y se guardan aparte (0600), nunca en pantalla.
if missing ADMIN_DASHBOARD_PASSWORD; then
  p="$(b64 24 | tr -d '/+=')"; set_kv ADMIN_DASHBOARD_PASSWORD "$p"
  printf '/admin  usuario=%s  password=%s\n' "$(current ADMIN_DASHBOARD_USER)" "$p" >> "$CREDS_FILE"
  echo "  generado  ADMIN_DASHBOARD_PASSWORD"
else echo "  ya estaba ADMIN_DASHBOARD_PASSWORD"; fi
if missing TRAEFIK_ADMIN_BASICAUTH_USERS; then
  u="operador"; p="$(b64 24 | tr -d '/+=')"
  line="$(bcrypt "$u" "$p")"
  set_kv TRAEFIK_ADMIN_BASICAUTH_USERS "${line//\$/\$\$}"   # compose interpola $: escribir $$
  printf '/panel (basic auth del proxy)  usuario=%s  password=%s\n' "$u" "$p" >> "$CREDS_FILE"
  echo "  generado  TRAEFIK_ADMIN_BASICAUTH_USERS"
else echo "  ya estaba TRAEFIK_ADMIN_BASICAUTH_USERS"; fi
[[ -f "$CREDS_FILE" ]] && chmod 600 "$CREDS_FILE"

echo
echo "== Pendientes =="
pending=0
needed=(BOT_DOMAIN CHATWOOT_DOMAIN CHATWOOT_ADMIN_EMAIL OPENAI_API_KEY META_APP_SECRET WHATSAPP_TOKEN PHONE_NUMBER_ID)
[[ "$(current PROXY_MODE)" == "tunnel" ]] && needed+=(CLOUDFLARE_TUNNEL_TOKEN)
for k in "${needed[@]}"; do
  missing "$k" && { echo "  falta $k"; pending=1; }
done
echo
echo "VERIFY_TOKEN para Meta (webhook):  grep ^VERIFY_TOKEN= $ENV_FILE | cut -d= -f2"
echo "Accesos iniciales (/admin, /panel): sudo cat $CREDS_FILE"
echo "Respalda FUERA del VPS: $ENV_FILE (sobre todo CREDENTIALS_MASTER_KEY) y $CREDS_FILE."
if [[ $pending -eq 0 ]]; then echo "Listo. Siguiente: bash deploy/hostinger/install.sh"
else echo "Completa los pendientes (vuelve a correr este script o edita $ENV_FILE) y luego: bash deploy/hostinger/install.sh"; fi
