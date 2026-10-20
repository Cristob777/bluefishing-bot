# SETUP — Blue Fishing bot en Hostinger KVM4 (checklist)

Quién hace qué:
- **Tú (operador):** deploy, `.env.production`, Traefik, webhook de Meta y, si se usan, Chatwoot y Atomic CRM.
- **Dueño de la empresa:** entra a `https://TU-DOMINIO/panel`, crea su cuenta y conecta su tienda y su WhatsApp. No te entrega claves.

> Nunca pegues claves en chats ni las subas al repo. Todas viven solo en `.env.production` en el VPS (`chmod 600`).

---

## 0. Requisitos
- [ ] VPS con Docker y Docker Compose v2 (`docker compose version`).
- [ ] Un dominio o subdominio (ej. `bot.bluefishing.cl`) con un registro **A** apuntando a la IP del VPS.
- [ ] Traefik de Hostinger funcionando (ya entrega HTTPS con Let's Encrypt).
- [ ] Opcional: `bash deploy/hostinger/harden-host.sh` para endurecer el host.

## 1. Clonar
```bash
git clone -b prod/hostinger-kvm4 https://github.com/Cristob777/bluefishing-bot.git
cd bluefishing-bot
```

## 2. Variables de entorno
```bash
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```
**Obligatorias (12).** `deploy.sh` no arranca si falta alguna.

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

## 3. Deploy
```bash
bash deploy/hostinger/deploy.sh
curl -s http://127.0.0.1:18080/health          # debe responder OK
docker compose --env-file .env.production logs -f app
```
`deploy.sh` valida las variables, construye la imagen, levanta Postgres y la app en `127.0.0.1:18080`, y aplica todas las migraciones `db/migrations/*.sql` (idempotentes).

## 4. Traefik (dominio → bot)
La app escucha **solo** en `127.0.0.1:18080`. En el Traefik de Hostinger crea un router:
- Host: `bot.bluefishing.cl` → servicio `http://127.0.0.1:18080` (o la IP del host vista desde el contenedor de Traefik, p. ej. `http://172.17.0.1:18080`).
- Entrypoint `websecure` con TLS (certresolver Let's Encrypt), más una redirección de http a https.

Comprobar:
```bash
curl -I https://bot.bluefishing.cl/panel        # 200
```

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

## 8. Chatwoot (opcional: bandeja y traspaso a humanos)
Guía completa: `deploy/chatwoot/README.md`.
1. Levantar Chatwoot en el VPS con `deploy/chatwoot/docker-compose.yml` y crear un router de Traefik para `chat.bluefishing.cl`.
2. En Chatwoot: crear la cuenta y el inbox. En **Settings → Bots** crear "Matías" con el webhook `https://bot.bluefishing.cl/chatwoot/webhook`.
3. `.env.production`: `CHATWOOT_ENABLED=true`, `CHATWOOT_BASE_URL=https://chat.bluefishing.cl`, `CHATWOOT_BOT_TOKEN` y `CHATWOOT_WEBHOOK_SECRET`.
4. Crear la etiqueta `humano` y agregar a los vendedores como agentes. Luego volver a desplegar.

## 9. Atomic CRM (opcional: embudo de ventas en Supabase)
Guía completa: `deploy/atomic-crm/README.md`. El `Caddyfile.snippet` sirve solo como referencia: en este VPS el proxy es Traefik.
1. Crear un proyecto en Supabase (plan Free), configurar SMTP y correr `deploy/atomic-crm/supabase-setup.sh` y `stages.sql`.
2. Publicar el frontend con `deploy/atomic-crm/build.sh` y servir `/srv/atomic-crm` por Traefik (o un nginx estático) en `crm.bluefishing.cl`.
3. `.env.production`: `ATOMIC_CRM_ENABLED=true`, `ATOMIC_CRM_SUPABASE_URL`, `ATOMIC_CRM_SUPABASE_SECRET_KEY` (clave **secreta**, solo en el VPS).
4. Levantar el sincronizador:
   ```bash
   docker compose --env-file .env.production --profile atomic-crm up -d
   ```

## 10. Verificación final
- [ ] `https://bot.bluefishing.cl/health` responde.
- [ ] `/admin`: entras con el usuario del paso 2 y ves "Panel de ventas".
- [ ] `/panel`: un dueño de prueba crea su cuenta, conecta la tienda y ve "2 de 2 listos".
- [ ] Un mensaje de WhatsApp recibe respuesta, y la conversación aparece en `/admin`.
- [ ] Chat web (si aplica): la burbuja responde en tu sitio.
- [ ] Respaldo de `.env.production` y de `CREDENTIALS_MASTER_KEY` fuera del VPS.

## Problemas comunes
| Síntoma | Causa probable |
|---|---|
| `deploy.sh`: "Security preflight failed: X" | falta la variable X o quedó `CHANGE_ME` |
| `/panel` da 404 | faltan `CREDENTIALS_MASTER_KEY` / `PANEL_SESSION_SECRET`, o `PUBLIC_BASE_URL` no es https |
| Meta no verifica el webhook | `VERIFY_TOKEN` distinto, o Traefik no enruta a `127.0.0.1:18080` |
| El chat web no responde (403) | el dominio no está en `ALLOWED_ORIGIN` (debe incluir `https://`) |
| "Meta rechazó los datos" en el panel | token sin permisos `whatsapp_business_*`, IDs cruzados, o App secret mal copiado |
