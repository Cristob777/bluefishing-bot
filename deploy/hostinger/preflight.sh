#!/usr/bin/env bash
# Preflight de solo lectura. Nunca modifica, reinicia ni conecta nada a Traefik ni a Nginx.
# - PROXY_MODE=traefik (defecto): aborta si el Traefik existente no está running+healthy o si su red no existe.
# - PROXY_MODE=nginx: no exige Traefik; verifica que BOT_LOCAL_PORT y CHATWOOT_LOCAL_PORT estén libres en
#   127.0.0.1 (o ya publicados por este mismo proyecto crm-bot, para que re-ejecutar install.sh funcione).
set -euo pipefail
ENV_FILE="${ENV_FILE:-.env.production}"
# shellcheck source=deploy/hostinger/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
MODE="$(proxy_mode)"

command -v docker >/dev/null || { echo "Preflight: falta docker." >&2; exit 1; }
docker compose version >/dev/null || { echo "Preflight: falta docker compose v2." >&2; exit 1; }

if [[ "$MODE" == "nginx" ]]; then
  # docker-compose.nginx.yml usa !reset/!override (Compose >= 2.24).
  ver="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
  if [[ "$(printf '%s\n2.24.0\n' "$ver" | sort -V | head -n1)" != "2.24.0" ]]; then
    echo "Preflight: PROXY_MODE=nginx requiere Docker Compose >= 2.24 (tienes $ver)." >&2; exit 1
  fi
  PROJECT="$(envval COMPOSE_PROJECT_NAME)"; PROJECT="${COMPOSE_PROJECT_NAME:-${PROJECT:-crm-bot}}"
  BP="$(envval BOT_LOCAL_PORT)"; BP="${BP:-18080}"
  CP="$(envval CHATWOOT_LOCAL_PORT)"; CP="${CP:-18081}"
  for p in "$BP" "$CP"; do
    [[ "$p" =~ ^[0-9]+$ ]] && (( p >= 1024 && p <= 65535 )) || { echo "Preflight: puerto local '$p' inválido (1024-65535)." >&2; exit 1; }
  done
  [[ "$BP" != "$CP" ]] || { echo "Preflight: BOT_LOCAL_PORT y CHATWOOT_LOCAL_PORT no pueden ser iguales ($BP)." >&2; exit 1; }
  port_busy() { # 0 si algo escucha en el puerto TCP (cualquier IP local)
    if command -v ss >/dev/null; then
      [[ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]]
    else
      (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
    fi
  }
  ours() { # 0 si el puerto lo publica un contenedor de este proyecto
    [[ -n "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "publish=$1" 2>/dev/null)" ]]
  }
  for pair in "BOT_LOCAL_PORT=$BP" "CHATWOOT_LOCAL_PORT=$CP"; do
    name="${pair%%=*}"; p="${pair#*=}"
    if port_busy "$p"; then
      if ours "$p"; then
        echo "Preflight: $name=$p ya lo publica el proyecto $PROJECT (re-instalación), OK."
      else
        echo "Preflight: $name=$p está ocupado por otro proceso (ss -ltnp 'sport = :$p'). Elige otro puerto libre en $ENV_FILE." >&2
        exit 1
      fi
    fi
  done
  if command -v nginx >/dev/null; then
    echo "Preflight: nginx encontrado ($(nginx -v 2>&1 | sed 's/^nginx version: //'))."
  else
    echo "Preflight: aviso, no encontré el binario nginx en este host (necesario para publicar los dominios)."
  fi
  echo "Preflight OK (PROXY_MODE=nginx): Traefik no requerido; puertos 127.0.0.1:$BP (bot) y 127.0.0.1:$CP (Chatwoot) disponibles."
  exit 0
fi

NET="$(envval TRAEFIK_NETWORK)"; NET="${NET:-traefik}"
if ! docker network inspect "$NET" >/dev/null 2>&1; then
  echo "Preflight: la red de Traefik '$NET' no existe (docker network ls). Ajusta TRAEFIK_NETWORK." >&2
  exit 1
fi

TC="$(envval TRAEFIK_CONTAINER)"
if [[ -z "$TC" ]]; then
  TC="$(docker ps -a --format '{{.Names}} {{.Image}}' | awk '$2 ~ /(^|\/)traefik(:|$)/ {print $1; exit}')"
fi
[[ -n "$TC" ]] || { echo "Preflight: no encontré el contenedor de Traefik. Define TRAEFIK_CONTAINER." >&2; exit 1; }

state() { docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$TC"; }
read -r status health restarts1 < <(state)
if [[ "$status" != "running" ]]; then
  echo "Preflight: Traefik ($TC) está '$status', no running. No se toca; revísalo antes de instalar." >&2
  exit 1
fi
if [[ "$health" != "healthy" ]]; then
  if [[ "$health" == "none" && "${TRAEFIK_ALLOW_NO_HEALTHCHECK:-0}" == "1" ]]; then
    echo "Preflight: Traefik sin healthcheck (permitido por TRAEFIK_ALLOW_NO_HEALTHCHECK=1)."
  else
    echo "Preflight: Traefik ($TC) health='$health' (se exige healthy). Si no tiene healthcheck, exporta TRAEFIK_ALLOW_NO_HEALTHCHECK=1 tras verificarlo a mano." >&2
    exit 1
  fi
fi
# Detecta bucle de reinicios: el contador no debe subir en la ventana de observación.
sleep "${TRAEFIK_OBSERVE_SECONDS:-15}"
read -r status2 _ restarts2 < <(state)
if [[ "$status2" != "running" || "$restarts2" != "$restarts1" ]]; then
  echo "Preflight: Traefik ($TC) se está reiniciando (RestartCount $restarts1 -> $restarts2). Abortando sin tocarlo." >&2
  exit 1
fi
echo "Preflight OK: Traefik '$TC' running/$health, red '$NET' existe."
