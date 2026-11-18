# Publicar el bot con Cloudflare Tunnel (PROXY_MODE=tunnel)

## Para qué sirve
El bot queda **independiente** de los otros sitios del VPS. No usa el Nginx que atiende
a las tiendas, no abre puertos y no necesita certbot.

```
Cliente / Meta ──https──► Cloudflare ──túnel──► contenedor cloudflared ──► bot / Chatwoot
                                                 (dentro del proyecto crm-bot)
```

Un contenedor (`cloudflared`) abre una conexión de **salida** hacia Cloudflare. El tráfico de
`bot.bluefishing.cl` y `chat.bluefishing.cl` entra por ahí. Cloudflare pone el HTTPS.

## Requisito
El dominio `bluefishing.cl` tiene que estar administrado en **Cloudflare** (sus nameservers
apuntan a Cloudflare). Si no lo está, **no muevas los nameservers sin revisar antes** el correo
y la tienda: cambiar los nameservers afecta a todo el dominio.

## 1. Crear el túnel en Cloudflare (10 min)
1. dash.cloudflare.com → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Tipo: **Cloudflared**. Nombre: `crm-bot`.
3. En "Install and run a connector", elige **Docker**. Aparece un comando con
   `--token eyJ...`. **Copia solo el token** (lo largo que empieza con `eyJ`).
   No ejecutes ese comando: el contenedor ya está en el repo.
4. **Public hostnames** → agrega dos:

   | Subdominio | Dominio | Tipo | URL |
   |---|---|---|---|
   | `bot` | `bluefishing.cl` | HTTP | `app:3000` |
   | `chat` | `bluefishing.cl` | HTTP | `chatwoot-rails:3000` |

   Cloudflare crea los registros DNS solo. **No crees registros A** para `bot` ni `chat`
   (si ya existen, bórralos antes, o Cloudflare no te deja guardar el hostname).

## 2. Instalar en el VPS
```bash
tmux new -s crm
git clone -b prod/hostinger-kvm4 https://github.com/Cristob777/bluefishing-bot.git /opt/crm-bot
cd /opt/crm-bot
bash deploy/hostinger/init-env.sh      # en "Cómo se publica": Enter (1 = tunnel) y pega el token
bash deploy/hostinger/install.sh
```
No hace falta `nginx-site.sh` ni `certbot`.

## 3. Comprobar
```bash
curl -s http://127.0.0.1:18080/health; echo                       # el bot, desde dentro del VPS
docker compose -p crm-bot logs --since 5m cloudflared | tail -20  # debe decir "Registered tunnel connection"
```
En el navegador: `https://bot.bluefishing.cl/health` y `https://chat.bluefishing.cl`.
En Cloudflare, el túnel aparece como **HEALTHY**.

## Notas
- `/panel` (apagado por defecto) no tiene basic auth en este modo: lo protege su propio login.
  Si quieres una capa extra, en Cloudflare → Zero Trust → **Access** crea una aplicación para
  `bot.bluefishing.cl/panel` que pida tu email.
- Los límites de intentos (rate limit) usan la IP real que entrega Cloudflare (`CF-Connecting-IP`).
- Apagar solo el bot: `docker compose -p crm-bot --env-file .env.production down`. Las tiendas no se tocan.
