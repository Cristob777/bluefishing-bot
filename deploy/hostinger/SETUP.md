# SETUP — Blue Fishing bot en Hostinger KVM4 (checklist)

Quién hace qué:
- **Tú (operador):** deploy, `.env.production`, Traefik, webhook de Meta y, si se usan, Chatwoot y Atomic CRM.
- **Dueño de la empresa:** entra a `https://TU-DOMINIO/panel`, crea su cuenta y conecta su tienda y su WhatsApp. No te entrega claves.

> Nunca pegues claves en chats ni las subas al repo. Todas viven solo en `.env.production` en el VPS (`chmod 600`).

---

## 0. Requisitos
- [ ] VPS con Docker y Docker Compose v2 (`docker compose version`). KVM4 (4 CPU / 16 GB) alcanza para bot + Chatwoot.
- [ ] Dos subdominios con registro **A** al VPS: `BOT_DOMAIN` (ej. `bot.bluefishing.cl`) y `CHATWOOT_DOMAIN` (ej. `chat.bluefishing.cl`).
- [ ] Elige el proxy con `PROXY_MODE` (ver §4): **`nginx` recomendado en el VPS de Blue Fishing** (Nginx ya ocupa 80/443). Con `traefik` (valor por defecto, compatible con lo anterior):
- [ ] El Traefik existente **running y healthy** (el instalador aborta si no; nunca lo modifica). Anota su red y su certresolver:
  ```bash
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -i traefik
  docker inspect <traefik> -f '{{json .NetworkSettings.Networks}}'      # -> TRAEFIK_NETWORK
  docker inspect <traefik> -f '{{json .Config.Cmd}}' | tr , '\n' | grep -i certresolver   # -> TRAEFIK_CERTRESOLVER
  ```
  Si Traefik se está reiniciando, arréglalo primero (`docker logs <traefik>`); el preflight detecta el bucle de reinicios.
- [ ] Opcional: `bash deploy/hostinger/harden-host.sh` para endurecer el host.

## 1. Clonar (proyecto aislado `crm-bot` en `/opt/crm-bot`)
```bash
sudo git clone -b prod/hostinger-kvm4 https://github.com/Cristob777/bluefishing-bot.git /opt/crm-bot
cd /opt/crm-bot
```
Todo vive en el proyecto Compose `crm-bot` (`name:` en `docker-compose.yml`): contenedores `crm-bot-*`, volúmenes `crm-bot_*` propios (`postgres_data`, `chatwoot_postgres_data`, `chatwoot_redis_data`, `chatwoot_storage`). No reutiliza ni modifica contenedores de otros proyectos y **no publica puertos al host**.

## Resumen: del clon al login
```bash
cd /opt/crm-bot
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production                      # completa todos los CHANGE_ME (paso 2)
bash deploy/hostinger/install.sh          # instalador idempotente (paso 3)
sudo cat /root/.crm-bot/chatwoot_admin_password   # password inicial del admin de Chatwoot (no se imprime)
```
Luego: `https://CHATWOOT_DOMAIN` → login con `CHATWOOT_ADMIN_EMAIL` + ese password → cámbialo en Perfil. `https://BOT_DOMAIN/admin` con `ADMIN_DASHBOARD_USER`. `/panel` pide primero el basic auth de Traefik.

## 2. Variables de entorno
```bash
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```
**Obligatorias (12)** + las de Traefik y Chatwoot (`TRAEFIK_ADMIN_BASICAUTH_USERS`, `CHATWOOT_DOMAIN`, `CHATWOOT_SECRET_KEY_BASE` (`openssl rand -hex 64`), `CHATWOOT_POSTGRES_PASSWORD`, `CHATWOOT_REDIS_PASSWORD`, `CHATWOOT_ADMIN_EMAIL`, `CHATWOOT_WEBHOOK_SECRET`). `install.sh` no arranca si falta alguna o queda `CHANGE_ME`. `CHATWOOT_BOT_TOKEN`, `CHATWOOT_ACCOUNT_ID` y `CHATWOOT_INBOX_ID` los escribe el instalador.

| Variable | Qué poner |
|---|---|
| `BOT_DOMAIN` | `bot.bluefishing.cl` (sin https) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `OPENAI_API_KEY` | tu clave de OpenAI |
| `VERIFY_TOKEN` | texto aleatorio (`openssl rand -hex 16`); se repite en Meta |
| `META_APP_SECRET` | Meta → tu app → Configuración → Básica → Clave secreta |
| `WHATSAPP_TOKEN` | token permanente de usuario del sistema |
| `PHONE_NUMBER_ID` | WhatsApp → Configuración de la API |
| `HEALTHCHECK_TOKEN`, `LOG_HASH_KEY`, `ADMIN_SESSION_SECRET` | `openssl rand -hex 32` (uno distinto para cada una) |
| `ADMIN_DASHBOARD_USER` / `ADMIN_DASHBOARD_PASSWORD` | usuario y contraseña larga para `/admin` |

**Panel de autoservicio (`/panel`)**, recomendado. Si se deja vacío, `/panel` responde 404 y el bot sigue funcionando.

| Variable | Qué poner |
|---|---|
| `CREDENTIALS_MASTER_KEY` | `openssl rand -hex 32` — **guárdala en un lugar seguro**: sin ella no se pueden descifrar las credenciales de los dueños |
| `PANEL_SESSION_SECRET` | `openssl rand -base64 48` |
| `PUBLIC_BASE_URL` | vacío = `https://$BOT_DOMAIN` |
| `WA_EMBEDDED_SIGNUP_ENABLED` | `false` (fase 2, requiere verificación de negocio) |

**Opcionales:**
- `WC_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`: tienda propia. Si el dueño conecta su tienda desde `/panel`, puedes dejarlas vacías.
- `ALLOWED_ORIGIN`: chat web, ver el paso 7.
- `CHATWOOT_*`: paso 8.
- `ATOMIC_CRM_*`: paso 9.

## 3. Instalar / actualizar
```bash
bash deploy/hostinger/install.sh      # primera vez y cuando quieras (idempotente)
bash deploy/hostinger/deploy.sh       # actualizaciones: git pull --ff-only de la rama + install.sh
```
`install.sh` (con `set -euo pipefail`), en orden:
1. Valida variables obligatorias y formato de `CREDENTIALS_MASTER_KEY` / `PANEL_SESSION_SECRET`.
2. **Preflight** (`preflight.sh`, solo lectura): aborta si la red `TRAEFIK_NETWORK` no existe o si el contenedor de Traefik (`TRAEFIK_CONTAINER` o autodetectado por imagen) no está `running` + `healthy`, o si su `RestartCount` sube durante 15 s. Si tu Traefik no tiene healthcheck y lo verificaste a mano: `TRAEFIK_ALLOW_NO_HEALTHCHECK=1 bash deploy/hostinger/install.sh`.
3. `compose config`, build del bot, levanta `db`, `chatwoot-postgres` y `chatwoot-redis` y espera sus healthchecks (`pg_isready`, `redis-cli ping`).
4. Backup previo solo si ya hay datos (ya existe `schema_migrations` o hay filas en `contacts`/`tenants`); en una instalación nueva se omite con el mensaje «Backup previo: omitido, instalación nueva sin datos» (`SKIP_BACKUP=1` para omitir siempre) y migraciones del bot con `migrate.sh`: tabla `schema_migrations`, aplica `db/schema.sql` (`001_schema`) y `db/migrations/*.sql` una vez cada una en transacción; las migraciones también son idempotentes (`IF NOT EXISTS`, `drop view if exists`).
5. `bundle exec rails db:chatwoot_prepare` (crea o migra la base de Chatwoot).
6. `compose up -d` y espera a `chatwoot-rails` y `app` healthy.
7. Con `rails runner` (`deploy/hostinger/chatwoot/bootstrap.rb`), idempotente: cuenta `CHATWOOT_ACCOUNT_NAME`, admin humano `CHATWOOT_ADMIN_EMAIL` con nombre `CHATWOOT_ADMIN_NAME` (por defecto «Equipo Blue Fishing»; nunca «Matías», que es el bot: si el admin ya existía con ese nombre se renombra) (password generado en `/root/.crm-bot/chatwoot_admin_password`, 0600, **nunca en stdout**; `SECRETS_DIR` para cambiar la carpeta), Agent Bot «Matías» con webhook `https://BOT_DOMAIN/chatwoot/webhook` (o `CHATWOOT_BOT_WEBHOOK_URL`), inbox «Bot API» conectado al bot. **Después de crear el admin cierra el onboarding público de Chatwoot** («Howdy, Welcome to Chatwoot», `/installation/onboarding`) con `Redis::Alfred.delete(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)` e `install.sh` lo verifica por HTTP (`/` y `/installation/onboarding` ya no redirigen al onboarding); si sigue abierto, aborta con «ERROR CRÍTICO». La firma HMAC usa `CHATWOOT_WEBHOOK_SECRET` (el endpoint existente `/chatwoot/webhook` ya verifica `X-Chatwoot-Signature`, `sha256=HMAC(secret, "timestamp.body")`).
8. Guarda `CHATWOOT_BOT_TOKEN`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID` (y el secreto si Chatwoot generó uno) en `.env.production` sin imprimirlos, recrea `app` y corre catálogo y retención.

**Pasos que no se automatizan (manuales):**
- DNS de `BOT_DOMAIN` y `CHATWOOT_DOMAIN` y que el certresolver de Traefik pueda emitir (HTTP/TLS challenge).
- Generar los secretos (`openssl rand ...`) y el hash de basic auth, y respaldarlos fuera del VPS.
- Meta: webhook y tokens de WhatsApp (paso 5); inbox de WhatsApp en Chatwoot si se migra el canal (ver `deploy/chatwoot/README.md`).
- Cambiar el password del admin de Chatwoot tras el primer login e invitar agentes (Settings → Agents).
- Si tu versión de Chatwoot no tiene columna `secret` en Agent Bots, la firma HMAC del webhook no se puede fijar desde el instalador: revisa en Settings → Bots que el bot use el secreto, o deja `CHATWOOT_WEBHOOK_SECRET` igual al que muestre Chatwoot.
- Cron de backups (abajo).

Migraciones a mano: `bash deploy/hostinger/migrate.sh`.

## 4. Proxy público: `PROXY_MODE`
| `PROXY_MODE` | Cuándo | Qué hace |
|---|---|---|
| `traefik` (**por defecto**, si la variable falta o está vacía) | Traefik existente sano en Docker | Red externa + labels (ver §4b). Igual que antes de esta opción. |
| `nginx` (**recomendado para este VPS**) | Nginx del host ya ocupa 80/443 (Traefik en bucle de reinicios) | Sin labels ni red de Traefik; bot en `127.0.0.1:BOT_LOCAL_PORT` (18080) y Chatwoot en `127.0.0.1:CHATWOOT_LOCAL_PORT` (18081) vía `docker-compose.nginx.yml`. Nginx publica los dominios. |

Todos los scripts (`install.sh`, `deploy.sh`, `migrate.sh`, `backup_bluefishing.sh`, `restore*.sh`, `preflight.sh`) leen `PROXY_MODE` de `.env.production` (o del entorno) y usan los archivos Compose correctos. A mano, en modo nginx: `docker compose -f docker-compose.yml -f docker-compose.nginx.yml --env-file .env.production ps`. Requiere Docker Compose ≥ 2.24.

### 4a. Instalación en modo nginx (paso a paso, como root en `/opt/crm-bot`)
1. **Backup previo** si ya había una instalación: `bash deploy/hostinger/backup_bluefishing.sh`. Anota el commit actual: `git rev-parse HEAD > /root/crm-bot-commit-anterior`.
2. En `.env.production`: `PROXY_MODE=nginx`, y si 18080/18081 están ocupados, otros `BOT_LOCAL_PORT` / `CHATWOOT_LOCAL_PORT` libres (`ss -ltnp`). `TRAEFIK_ADMIN_BASICAUTH_USERS` (hash bcrypt con `$$`) y `TRAEFIK_ADMIN_IP_ALLOWLIST` se reutilizan para `/panel` y `/admin-chat` en Nginx.
3. Si el Traefik que está en bucle es de un proyecto viejo que ya no se usa, detenerlo es decisión aparte (este instalador **no lo toca**).
4. `bash deploy/hostinger/install.sh` — el preflight **no exige Traefik**; verifica Compose ≥ 2.24 y que los dos puertos locales estén libres (o ya publicados por el propio `crm-bot`, para re-ejecutar). Aborta si otro proceso los ocupa.
5. Comprobar en el host: `curl -s http://127.0.0.1:18080/health` y `curl -sI http://127.0.0.1:18081/ | head -1`.
6. **Nginx, fase HTTP**: `bash deploy/hostinger/nginx-site.sh render` (solo muestra la config) y luego `bash deploy/hostinger/nginx-site.sh install`. Crea **solo** `/etc/nginx/conf.d/crm-bot.conf` y `/etc/nginx/crm-bot.htpasswd` (no edita ningún archivo existente), corre `nginx -t` y **solo si pasa** recarga Nginx; si falla, borra el archivo nuevo y no recarga. Incluye: `server_name` para `BOT_DOMAIN` y `CHATWOOT_DOMAIN`, `client_max_body_size` (2m bot / 40m Chatwoot; `NGINX_BOT_MAX_BODY`, `NGINX_CHATWOOT_MAX_BODY`), cabeceras `Host`, `X-Real-IP`, `X-Forwarded-For/Proto/Host/Port`, websocket de Chatwoot en `/cable` (`Upgrade`/`Connection`) y `/panel`, `/admin-chat` con allowlist + basic auth.
   - Si tu Nginx no incluye `conf.d/*.conf` (p. ej. solo `sites-enabled`), revisa `nginx -T | grep include` y usa `NGINX_CONF_DIR=/etc/nginx/sites-enabled` (archivo nuevo igualmente).
7. Probar por HTTP: `curl -sI http://BOT_DOMAIN/health`, `curl -sI http://CHATWOOT_DOMAIN/`.
8. **Certificados**: `certbot --nginx -d BOT_DOMAIN -d CHATWOOT_DOMAIN` (agrega `listen 443 ssl` y el redirect dentro de `crm-bot.conf`). Después, `nginx-site.sh install` detecta «managed by Certbot» y no sobrescribe el archivo.
9. Verificación final (§11) por `https://`.

Nunca: `nginx -s reload` / `systemctl reload nginx` sin un `nginx -t` exitoso antes.

### 4a-bis. Rollback del modo nginx
```bash
cd /opt/crm-bot
bash deploy/hostinger/nginx-site.sh uninstall   # borra conf.d/crm-bot.conf + htpasswd, nginx -t y, solo si pasa, reload
# (equivalente manual: rm /etc/nginx/conf.d/crm-bot.conf /etc/nginx/crm-bot.htpasswd && nginx -t && systemctl reload nginx)
docker compose -f docker-compose.yml -f docker-compose.nginx.yml --env-file .env.production down   # sin -v: conserva datos
git checkout "$(cat /root/crm-bot-commit-anterior)"   # versión anterior
# volver a PROXY_MODE=traefik (o quitar la línea) y reinstalar la versión anterior:
bash deploy/hostinger/install.sh
# si hubo daño de datos: CONFIRM=yes bash deploy/hostinger/restore.sh <timestamp del backup del paso 1>
```
Los certificados emitidos por certbot quedan en `/etc/letsencrypt` (inofensivos); `certbot delete --cert-name <nombre>` si se quieren borrar.

## 4b. Traefik (dominio → bot) — `PROXY_MODE=traefik`
**Opción por defecto (recomendada): red externa + labels.** `docker-compose.yml` conecta `app` a la red externa de Traefik y declara los labels (router, servicio, puerto interno 3000, TLS). La app escucha en `0.0.0.0:3000` dentro del contenedor y **no publica ningún puerto al host**. Postgres sigue solo en la red `internal`.

Variables (en `.env.production`):
| Variable | Default | Qué es |
|---|---|---|
| `TRAEFIK_NETWORK` | `traefik` | Red Docker de Traefik. Ver con `docker network ls` / `docker inspect <contenedor-traefik>` |
| `TRAEFIK_ENTRYPOINT` | `websecure` | Entrypoint HTTPS de Traefik |
| `TRAEFIK_CERTRESOLVER` | `letsencrypt` | Nombre del certresolver configurado en Traefik |
| `TRAEFIK_ADMIN_BASICAUTH_USERS` | (obligatoria) | `usuario:hash` bcrypt para `/panel` y `/admin-chat` |
| `TRAEFIK_ADMIN_IP_ALLOWLIST` | `0.0.0.0/0,::/0` | IPs/CIDR permitidas para `/panel` y `/admin-chat` |

Traefik debe tener el provider Docker activo (`--providers.docker=true`). Si usa `exposedByDefault=false`, el label `traefik.enable=true` ya está puesto.

**Alternativas** (si la opción por defecto no encaja con tu Traefik):
- **Traefik en el host o con `network_mode: host`:** publica la app en loopback con el override `docker-compose.hostport.yml` (`docker compose -f docker-compose.yml -f docker-compose.hostport.yml --env-file .env.production up -d`) y apunta un router de Traefik (file provider) a `http://127.0.0.1:18080`.
- **Atar el puerto a la IP del bridge (`172.17.0.1`)**: posible editando el override, pero expone el puerto a cualquier contenedor del host. No recomendado.
- Nota: `127.0.0.1:18080` **no** es alcanzable desde un Traefik en contenedor sin `network_mode: host`, ni vía `172.17.0.1` si el puerto está atado a loopback.

### Protección de `/panel` y `/admin-chat`
Un router de mayor prioridad (`bluefishing-protegido`) aplica a esas rutas dos middlewares: `ipallowlist` (`TRAEFIK_ADMIN_IP_ALLOWLIST`) y `basicauth` (`TRAEFIK_ADMIN_BASICAUTH_USERS`). El resto de rutas (webhook de Meta, `/chat`, `/widget.js`, `/health`, `/admin`) va por el router público. Generar el hash (en tu máquina o en el VPS, **nunca lo pegues en chats**):
```bash
htpasswd -nB admin                                         # apache2-utils
# o: docker run --rm httpd:2-alpine htpasswd -nbB admin 'CLAVE_LARGA'
```
Pega el resultado en `.env.production` **duplicando cada `$` (`$$`)**, porque compose interpola el archivo. Ejemplo de forma: `TRAEFIK_ADMIN_BASICAUTH_USERS=admin:$$2y$$05$$...`. Si los dueños de las empresas entran a `/panel` desde cualquier lugar, deja la allowlist abierta y compárteles la clave de basic auth (luego cada uno usa su login del panel), o restringe por IP si solo lo usas tú.

Comprobar:
```bash
curl -sI https://chat.bluefishing.cl | head -1   # Chatwoot 200/302
curl -s https://bot.bluefishing.cl/health
curl -I https://bot.bluefishing.cl/panel        # 401 sin credenciales
curl -I -u admin https://bot.bluefishing.cl/panel   # 200/302 con credenciales
```

### Backups (bot + Chatwoot)
Scripts en `deploy/hostinger/` (sin secretos: las credenciales se leen dentro de cada contenedor):
- `backup_bluefishing.sh`: `pg_dump -Fc` de la DB del bot (`bot-TS.dump`) y de Chatwoot (`chatwoot-TS.dump`) + tar del storage de Chatwoot (`chatwoot-storage-TS.tar.gz`) en `BACKUP_DIR` (default `/var/backups/crm-bot`, 700/600). El directorio se crea con `install -d -m 700` (dueño = quien ejecuta, normalmente root); si ya existe y es de otro usuario no se hace `chmod`, solo se exige que sea escribible. Borra lo de más de `KEEP_DAYS` (14) días.
- `restore_test.sh TS`: restaura cada dump en una DB temporal `restore_test`, cuenta filas, la borra y valida el tar. **No toca producción.**
- `restore.sh TS` (destructivo, exige `CONFIRM=yes`): para servicios, restaura ambas bases con `--clean` y el storage, y vuelve a levantar.

```bash
bash deploy/hostinger/backup_bluefishing.sh
bash deploy/hostinger/restore_test.sh 2026-11-01_0315
CONFIRM=yes bash deploy/hostinger/restore.sh 2026-11-01_0315
```
Cron diario (03:15), `crontab -e` como root:
```
15 3 * * * cd /opt/crm-bot && bash deploy/hostinger/backup_bluefishing.sh >> /var/log/crm-bot-backup.log 2>&1
```
Recomendado: copia fuera del VPS (rclone/rsync cifrado de `/var/backups/crm-bot`) y una prueba de restore al mes.

### Respaldo de `CREDENTIALS_MASTER_KEY` (crítico)
`tenant_credentials` guarda los tokens de cada empresa cifrados con AES-256-GCM usando `CREDENTIALS_MASTER_KEY`. **Si esa clave se pierde, las credenciales cifradas son irrecuperables**, aunque tengas los backups de la base: cada empresa tendría que volver a conectar sus integraciones.
- Guárdala en un gestor de contraseñas (fuera del VPS), **separada de los dumps** (quien tenga dump + clave puede descifrar).
- No la rotes sin un plan de re-cifrado: cambiarla deja ilegibles las credenciales existentes.
- Respáldala junto con `.env.production`, nunca en el repo ni en chats.

## 5. Webhook de Meta (WhatsApp)
1. developers.facebook.com → tu app → WhatsApp → **Configuración** → Webhook → Editar.
2. URL de devolución: `https://bot.bluefishing.cl/webhook`.
3. Token de verificación: el mismo `VERIFY_TOKEN` del `.env.production`.
4. Verificar y guardar. Luego, en **Campos del webhook**, suscribir `messages`.
5. Probar: escribe al número desde tu teléfono y mira los logs.

> Sin verificación de negocio: el número de prueba funciona, y un número real puede iniciar conversaciones con hasta 250 destinatarios únicos cada 24 h. Las respuestas dentro de la ventana de 24 h no cuentan para ese límite.

Si cada dueño conecta su propio WhatsApp desde `/panel`, el panel le muestra **su propia** URL y token de verificación para pegarlos en su app de Meta.

## 6. Conectar WooCommerce (lo hace el dueño)
1. El dueño entra a `https://bot.bluefishing.cl/panel` y crea su cuenta (empresa, correo y contraseña de 12+ caracteres).
2. En **Paso 1 · Tu tienda** escribe `https://sutienda.cl` y aprieta **Conectar tienda**.
3. WordPress le pide aprobar un acceso de **solo lectura** y, al aprobar, vuelve al panel con "Tienda conectada".
   - Requisitos: la tienda debe estar en https y tener los enlaces permanentes activados (no "Simple").
4. **Paso 2 · Tu WhatsApp**: pega el token, el Phone number ID, el WABA ID y el App secret. La ayuda "¿Dónde encuentro estos datos?" explica dónde está cada uno. Al conectar, el panel suscribe el webhook automáticamente.

## 7. Chat web (opcional)
1. `.env.production`: `ALLOWED_ORIGIN=https://bluefishing.cl,https://www.bluefishing.cl`. Si queda vacío, `/chat` responde 403.
2. En la web (WordPress → pie de página o un plugin de código):
   ```html
   <script src="https://bot.bluefishing.cl/widget.js" async></script>
   ```
   Opcionales: `data-color="#0b3d63"`, `data-position="left"`, `data-greeting="..."`.
3. Vuelve a ejecutar `bash deploy/hostinger/deploy.sh`.

## 8. Chatwoot (bandeja y traspaso a humanos)
Chatwoot ya viene en el proyecto `crm-bot` y lo configura `install.sh` (paso 3): cuenta, admin, Agent Bot «Matías», inbox «Bot API», webhook firmado y tokens en `.env.production`. El bot habla con Chatwoot por la red interna (`CHATWOOT_BASE_URL=http://chatwoot-rails:3000`).
Manual: crear la etiqueta `humano`, invitar a los vendedores como agentes y, si se migra WhatsApp a Chatwoot, seguir `deploy/chatwoot/README.md` (el `deploy/chatwoot/docker-compose.yml` queda como referencia legada; no lo levantes junto a `crm-bot`).

## 8b. Seguridad de imágenes (Trivy) y riesgos aceptados

Auditoría Trivy del 2026-10-31 (antes/después en el PR `fix/trivy-hardening`).

- **Imagen del bot:** la etapa final no trae npm, npx, corepack ni yarn. El runtime solo ejecuta `node server.js`, y los scripts se corren con `docker compose exec app node scripts/<script>.js`, no con `npm run`. La base `node:22-alpine` está fijada por digest y se le aplica `apk upgrade`. Corre como el usuario `node` (no root) y tiene `HEALTHCHECK` contra `/health`.
- **Imágenes de terceros fijadas por digest:** `postgres:17.11-alpine` (bot), `pgvector/pgvector:0.8.7-pg16-bookworm` (Chatwoot; se mantiene en PG16 y en Debian bookworm, la misma base que `pg16`, así que no cambia la collation) y `redis:7-alpine`. Para actualizarlas: `docker pull <imagen>:<tag>`, reemplaza el digest en `docker-compose.yml`, re-escanea con `trivy image`, haz un backup y corre `install.sh`.
- **Chatwoot `v4.19.1` (la última v4.x al 2026-10-31):** tiene 2 CRITICAL sin parche publicado por Chatwoot:
  - `net-imap` CVE-2026-42257 (además de 3 HIGH del mismo paquete);
  - la gema `zlib` CVE-2026-27820.

  **Mitigación obligatoria:** **no configures un inbox de Email por IMAP** en Chatwoot. Usa solo los canales de WhatsApp, chat web y API. Esto es un riesgo aceptado hasta que salga una v4.x que actualice `net-imap` (≥ 0.5.14) y `zlib` (≥ 3.2.3). Cuando salga, cambia `CHATWOOT_IMAGE_TAG`, haz un backup y corre `install.sh`. Las migraciones se aplican solas.
- Los contenedores de Chatwoot, Postgres y Redis corren con `no-new-privileges`.
- **Riesgos aceptados (sin fix upstream, red interna, no expuestos):**
  - el `gosu` (Go stdlib) de las imágenes de Postgres, que solo se usa en el entrypoint;
  - los paquetes Debian sin parche de pgvector, como util-linux, libxml2, libsqlite3 y perl.

## 9. Atomic CRM (opcional: embudo de ventas en Supabase)
Guía completa: `deploy/atomic-crm/README.md`. El `Caddyfile.snippet` sirve solo como referencia: en este VPS el proxy es Traefik.
1. Crear un proyecto en Supabase (plan Free), configurar SMTP y correr `deploy/atomic-crm/supabase-setup.sh` y `stages.sql`.
2. Publicar el frontend con `deploy/atomic-crm/build.sh` y servir `/srv/atomic-crm` por Traefik (o un nginx estático) en `crm.bluefishing.cl`.
3. `.env.production`: `ATOMIC_CRM_ENABLED=true`, `ATOMIC_CRM_SUPABASE_URL`, `ATOMIC_CRM_SUPABASE_SECRET_KEY` (clave **secreta**, solo en el VPS).
4. Levantar el sincronizador:
   ```bash
   docker compose --env-file .env.production --profile atomic-crm up -d
   ```

## 10. CRM multiempresa y ventas atribuidas
- **Migración 005** (la aplica `deploy.sh`): agrega `tenant_id` a los contactos, la clave del widget por empresa, el historial de etapas y los pedidos de WooCommerce. Es **idempotente** y el backfill es seguro:
  - los contactos sin empresa quedan como **cuenta del operador** (`tenant_id` vacío, es decir el número y la tienda del `.env`);
  - un contacto de WhatsApp se asigna a una empresa solo si ese teléfono habló **únicamente** con esa empresa. Si hay dudas, queda en el operador.
- **Chat web por empresa:** cada dueño, en `/panel → Ajustes`, escribe sus dominios y copia su línea:
  ```html
  <script src="https://bot.bluefishing.cl/widget.js" data-key="CLAVE-DE-LA-EMPRESA" async></script>
  ```
  Sin `data-key`, el widget usa la cuenta del operador y `ALLOWED_ORIGIN`.
- **Pedidos y ventas atribuidas** (solo lectura): el dueño aprieta «Sincronizar pedidos ahora» en Resultados, y tú puedes agendar un cron diario:
  ```bash
  0 6 * * * cd /ruta/bluefishing-bot && docker compose --env-file .env.production exec -T app node scripts/woo-orders-sync.js
  ```
  Un pedido se atribuye al bot cuando su teléfono (últimos 9 dígitos) o su correo coincide con un contacto de la misma empresa que habló con Matías como máximo `ATTRIBUTION_WINDOW_DAYS` (por defecto 30) antes del pedido. Solo cuentan los pedidos `completed` y `processing`, y el contacto pasa solo a «Compró».
- **Chatwoot y Atomic CRM** siguen siendo de la **cuenta del operador**: Atomic sincroniza solo los contactos sin empresa (un proyecto Supabase corresponde a una empresa). Para darle Chatwoot o Atomic a otra empresa hay que crearle su propia instancia; eso todavía no se automatiza.

## 11. Verificación final
- [ ] `https://bot.bluefishing.cl/health` responde.
- [ ] `/admin`: entras con el usuario del paso 2 y ves "Panel de ventas".
- [ ] `/panel`: un dueño de prueba crea su cuenta, conecta la tienda y ve "2 de 2 listos".
- [ ] Un mensaje de WhatsApp recibe respuesta, y la conversación aparece en `/admin`.
- [ ] Chat web (si aplica): la burbuja responde en tu sitio.
- [ ] `/panel → Contactos` y `Embudo` muestran solo los contactos de esa empresa, y «Mover» cambia la etapa.
- [ ] `/panel → Resultados → Sincronizar pedidos` termina con «Pedidos sincronizados».
- [ ] Respaldo de `.env.production` y de `CREDENTIALS_MASTER_KEY` fuera del VPS.

## Problemas comunes
| Síntoma | Causa probable |
|---|---|
| `deploy.sh`: "Security preflight failed: X" | falta la variable X o quedó `CHANGE_ME` |
| `/panel` da 404 | faltan `CREDENTIALS_MASTER_KEY` / `PANEL_SESSION_SECRET`, o `PUBLIC_BASE_URL` no es https |
| Meta no verifica el webhook | `VERIFY_TOKEN` distinto, o Traefik no llega a la app (revisa `TRAEFIK_NETWORK` y los logs de Traefik) |
| `/panel` da 401 siempre | hash de `TRAEFIK_ADMIN_BASICAUTH_USERS` sin `$$` o IP fuera de `TRAEFIK_ADMIN_IP_ALLOWLIST` |
| `deploy.sh`: "Postgres no quedó healthy" | revisa `docker compose logs db` (contraseña, disco, initdb) |
| El chat web no responde (403) | el dominio no está en `ALLOWED_ORIGIN` (debe incluir `https://`) |
| "Meta rechazó los datos" en el panel | token sin permisos `whatsapp_business_*`, IDs cruzados, o App secret mal copiado |
