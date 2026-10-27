#!/usr/bin/env bash
# Preflight de solo lectura: aborta si el Traefik existente no está running+healthy o si su red no existe.
# Nunca modifica, reinicia ni conecta nada a Traefik.
set -euo pipefail
ENV_FILE="${ENV_FILE:-.env.production}"
envval() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true; }

command -v docker >/dev/null || { echo "Preflight: falta docker." >&2; exit 1; }
docker compose version >/dev/null || { echo "Preflight: falta docker compose v2." >&2; exit 1; }

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
