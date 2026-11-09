#!/usr/bin/env bash
# Server blocks de Nginx para PROXY_MODE=nginx. Crea SOLO un archivo nuevo (crm-bot.conf) en conf.d y un
# htpasswd propio; nunca edita archivos existentes de Nginx. Nunca recarga sin un `nginx -t` exitoso antes.
#
# Uso (desde la raíz del repo, en el VPS como root):
#   bash deploy/hostinger/nginx-site.sh render [ARCHIVO]   # genera la config (stdout o ARCHIVO), no toca Nginx
#   bash deploy/hostinger/nginx-site.sh install            # escribe conf.d/crm-bot.conf + htpasswd, nginx -t, reload
#   bash deploy/hostinger/nginx-site.sh uninstall          # rollback: borra lo creado, nginx -t, reload
#
# Variables (entorno o .env.production): BOT_DOMAIN, CHATWOOT_DOMAIN, BOT_LOCAL_PORT (18080),
# CHATWOOT_LOCAL_PORT (18081), TRAEFIK_ADMIN_BASICAUTH_USERS (usuario:hash bcrypt, $$ -> $),
# TRAEFIK_ADMIN_IP_ALLOWLIST, NGINX_BOT_MAX_BODY (2m), NGINX_CHATWOOT_MAX_BODY (40m).
# Rutas/comandos configurables: NGINX_CONF_DIR (/etc/nginx/conf.d), NGINX_HTPASSWD (/etc/nginx/crm-bot.htpasswd),
# NGINX_HTPASSWD_GROUP (www-data/nginx), NGINX_TEST_CMD ("nginx -t"), NGINX_RELOAD_CMD ("systemctl reload nginx" o "nginx -s reload").
set -euo pipefail
cd "$(dirname "$0")/../.."
export ENV_FILE="${ENV_FILE:-.env.production}"
# shellcheck source=deploy/hostinger/lib.sh
source deploy/hostinger/lib.sh
val() { local v="${!1:-}"; [[ -n "$v" ]] || v="$(envval "$1")"; printf '%s' "${v:-${2:-}}"; }

CONF_DIR="$(val NGINX_CONF_DIR /etc/nginx/conf.d)"
CONF="$CONF_DIR/crm-bot.conf"
HTPASSWD="$(val NGINX_HTPASSWD /etc/nginx/crm-bot.htpasswd)"
TEST_CMD="$(val NGINX_TEST_CMD "nginx -t")"
if [[ -z "$(val NGINX_RELOAD_CMD)" ]] && command -v systemctl >/dev/null && systemctl is-active --quiet nginx 2>/dev/null; then
  RELOAD_CMD="systemctl reload nginx"
else
  RELOAD_CMD="$(val NGINX_RELOAD_CMD "nginx -s reload")"
fi
MARK="CRMBOT-MANAGED"

render() {
  local bd cd bp cp allow="" ip
  bd="$(val BOT_DOMAIN)"; cd="$(val CHATWOOT_DOMAIN)"
  bp="$(val BOT_LOCAL_PORT 18080)"; cp="$(val CHATWOOT_LOCAL_PORT 18081)"
  local re='^[A-Za-z0-9.-]+$'
  [[ "$bd" =~ $re && "$cd" =~ $re && "$bd" != CHANGE_ME* && "$cd" != CHANGE_ME* ]] || { echo "BOT_DOMAIN/CHATWOOT_DOMAIN faltan o son inválidos." >&2; return 1; }
  [[ "$bp" =~ ^[0-9]+$ && "$cp" =~ ^[0-9]+$ ]] || { echo "BOT_LOCAL_PORT/CHATWOOT_LOCAL_PORT inválidos." >&2; return 1; }
  IFS=',' read -ra ips <<< "$(val TRAEFIK_ADMIN_IP_ALLOWLIST "0.0.0.0/0,::/0")"
  for ip in "${ips[@]}"; do
    ip="${ip// /}"; [[ -z "$ip" ]] && continue
    [[ "$ip" =~ ^[0-9A-Fa-f:./]+$ ]] || { echo "IP/CIDR inválida en TRAEFIK_ADMIN_IP_ALLOWLIST: $ip" >&2; return 1; }
    allow+="        allow $ip;"$'\n'
  done
  allow+="        deny all;"
  local bmb cmb
  bmb="$(val NGINX_BOT_MAX_BODY 2m)"; cmb="$(val NGINX_CHATWOOT_MAX_BODY 40m)"
  awk -v bd="$bd" -v cd="$cd" -v bp="$bp" -v cp="$cp" -v ht="$HTPASSWD" -v bmb="$bmb" -v cmb="$cmb" -v allow="$allow" '
    { gsub(/__BOT_DOMAIN__/, bd); gsub(/__CHATWOOT_DOMAIN__/, cd); gsub(/__BOT_LOCAL_PORT__/, bp);
      gsub(/__CHATWOOT_LOCAL_PORT__/, cp); gsub(/__HTPASSWD_FILE__/, ht); gsub(/__BOT_MAX_BODY__/, bmb);
      gsub(/__CHATWOOT_MAX_BODY__/, cmb);
      if ($0 ~ /__ALLOW_RULES__/) { print allow; next } print }' deploy/hostinger/nginx/crm-bot.conf.template
}

write_htpasswd() { # $1 destino. Convierte el formato compose ($$) al de htpasswd ($).
  local users; users="$(val TRAEFIK_ADMIN_BASICAUTH_USERS)"
  [[ -n "$users" && "$users" != CHANGE_ME* ]] || { echo "TRAEFIK_ADMIN_BASICAUTH_USERS falta (usuario:hash bcrypt)." >&2; return 1; }
  ( umask 027; printf '%s\n' "${users//\$\$/\$}" | tr ',' '\n' > "$1" )
  local grp; grp="$(val NGINX_HTPASSWD_GROUP)"   # grupo del worker de Nginx; vacío = www-data o nginx
  if [[ -z "$grp" ]]; then for g in www-data nginx; do getent group "$g" >/dev/null 2>&1 && { grp="$g"; break; }; done; fi
  [[ -n "$grp" ]] && { chgrp "$grp" "$1" || echo "Aviso: no pude asignar el grupo $grp a $1 (Nginx debe poder leerlo)." >&2; }
  chmod 640 "$1"
}

nginx_test() { echo "+ $TEST_CMD"; bash -c "$TEST_CMD"; }
nginx_reload() { echo "+ $RELOAD_CMD"; bash -c "$RELOAD_CMD"; }

case "${1:-}" in
  render)
    if [[ -n "${2:-}" ]]; then render > "$2"; echo "Config generada en $2"; else render; fi ;;
  install)
    [[ -d "$CONF_DIR" ]] || { echo "No existe $CONF_DIR (¿Nginx instalado?)." >&2; exit 1; }
    new="$(mktemp)"; trap 'rm -f "$new"' EXIT
    render > "$new"
    if [[ -f "$CONF" ]]; then
      if ! grep -q "$MARK" "$CONF"; then
        echo "$CONF existe y no es de crm-bot. No se toca." >&2; exit 1
      fi
      if grep -q "managed by Certbot" "$CONF"; then
        echo "$CONF ya tiene los certificados de certbot: no se sobrescribe (se perderían). Nada que hacer."
        echo "Para regenerar: bash deploy/hostinger/nginx-site.sh uninstall && ... install && certbot --nginx otra vez."
        nginx_test; exit 0
      fi
      if cmp -s "$new" "$CONF"; then echo "$CONF ya está al día."; write_htpasswd "$HTPASSWD"; nginx_test; exit 0; fi
      cp -p "$CONF" "$CONF.crmbot-prev"
    fi
    ht_existed=0; [[ -f "$HTPASSWD" ]] && ht_existed=1
    write_htpasswd "$HTPASSWD"
    install -m 644 "$new" "$CONF"
    if nginx_test; then
      nginx_reload
      echo "OK: $CONF instalado y Nginx recargado (solo HTTP). Siguiente: certbot --nginx -d $(val BOT_DOMAIN) -d $(val CHATWOOT_DOMAIN)"
    else
      echo "nginx -t falló: se revierte $CONF y NO se recarga Nginx." >&2
      if [[ -f "$CONF.crmbot-prev" ]]; then mv -f "$CONF.crmbot-prev" "$CONF"; else rm -f "$CONF"; fi
      [[ "$ht_existed" == 1 ]] || rm -f "$HTPASSWD"
      exit 1
    fi ;;
  uninstall)
    if [[ -f "$CONF" ]] && ! grep -q "$MARK" "$CONF"; then echo "$CONF no es de crm-bot. No se toca." >&2; exit 1; fi
    rm -f "$CONF" "$CONF.crmbot-prev" "$HTPASSWD"
    if nginx_test; then nginx_reload; echo "Rollback OK: $CONF eliminado y Nginx recargado."
    else echo "nginx -t falla incluso sin $CONF: el problema está en otra config. NO se recarga." >&2; exit 1; fi ;;
  *) sed -n '2,15p' "$0" >&2; exit 2 ;;
esac
