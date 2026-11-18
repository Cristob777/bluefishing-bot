# shellcheck shell=bash
# Funciones comunes de los scripts de deploy/hostinger. Se carga con:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# Requiere ENV_FILE definido (por defecto .env.production) y cwd = raíz del repo.

envval() { grep -E "^$1=" "${ENV_FILE:-.env.production}" 2>/dev/null | head -n1 | cut -d= -f2- || true; }

# PROXY_MODE: traefik (por defecto, compatible con lo existente) | nginx (Nginx del host como único proxy)
#           | tunnel (Cloudflare Tunnel: no usa el Nginx ni los puertos 80/443 del host).
# Prioridad: variable de entorno > .env.production > traefik.
proxy_mode() {
  local m="${PROXY_MODE:-$(envval PROXY_MODE)}"
  m="${m:-traefik}"
  case "$m" in
    traefik|nginx|tunnel) printf '%s' "$m" ;;
    *) echo "PROXY_MODE='$m' inválido (usa traefik, nginx o tunnel)." >&2; return 1 ;;
  esac
}

# Llena el array DC con el comando docker compose correcto para el modo.
set_dc() {
  local mode; mode="$(proxy_mode)" || exit 1
  DC=(docker compose --env-file "${ENV_FILE:-.env.production}" -f docker-compose.yml)
  # tunnel reutiliza el override nginx (sin Traefik, puertos solo en 127.0.0.1) y agrega cloudflared.
  [[ "$mode" == "nginx" || "$mode" == "tunnel" ]] && DC+=(-f docker-compose.nginx.yml)
  [[ "$mode" == "tunnel" ]] && DC+=(-f docker-compose.tunnel.yml)
  return 0
}
