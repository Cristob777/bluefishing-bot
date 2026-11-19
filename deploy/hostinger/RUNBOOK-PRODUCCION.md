## Runbook: Puesta en producción de Matías (Blue Fishing)
**Owner:** Cristóbal (operador) | **Frecuencia:** una vez + actualizaciones a demanda
**Last Updated:** 2026-11-19 | **Last Run:** pendiente

### Purpose
Dejar a Matías respondiendo por WhatsApp en `bot.bluefishing.cl`, con:
- stock en vivo desde **Bsale** (fuente de verdad del stock),
- catálogo, precio y links desde la **web** (WooCommerce, sin claves: Store API pública),
- CRM en `/admin` con ventas atribuidas desde **Bsale** (web + tienda física),
- bandeja humana en **Chatwoot** (`chat.bluefishing.cl`) para los traspasos.

Todo corre en el VPS Hostinger como proyecto Docker `crm-bot`, publicado por **Cloudflare Tunnel**
(no toca el Nginx ni los puertos de las tiendas). Referencia detallada: [SETUP.md](SETUP.md).

### Prerequisites
Junta esto ANTES de entrar al VPS. Nunca lo pegues en chats ni en el repo.

- [ ] **VPS:** acceso root por SSH; Docker + Compose ≥ 2.24 (`docker compose version`).
- [ ] **Cloudflare:** `bluefishing.cl` administrado en Cloudflare + token del túnel (`eyJ...`) — ver paso 2.
- [ ] **OpenAI:** API key con **límite de gasto mensual** configurado en platform.openai.com.
- [ ] **Meta (WhatsApp Cloud API):**
  - [ ] `WHATSAPP_TOKEN`: token **permanente** de un usuario del sistema (Business Settings → Usuarios del sistema → Generar token, permisos `whatsapp_business_messaging` y `whatsapp_business_management`). Un token temporal muere a las 24 h.
  - [ ] `PHONE_NUMBER_ID`: WhatsApp → Configuración de la API.
  - [ ] `META_APP_SECRET`: tu app → Configuración → Básica → Clave secreta.
- [ ] **Bsale:** `BSALE_ACCESS_TOKEN` (configuración de API / integraciones de la cuenta; si no aparece, pedirlo a soporte Bsale).
- [ ] **Tienda física:** acordar con el equipo que **cada boleta registre el teléfono o correo del cliente**. Sin eso, una venta en tienda no se puede atribuir a Matías.

### Procedure

#### Step 1: Dejar el código listo (GitHub, 5 min)
1. Mergear el PR `feat/bsale-produccion` en `main`.
2. Repo a **privado**: GitHub → Settings → General → Danger Zone → Change visibility. (Hoy es público: cualquiera lee el prompt de ventas y las reglas anti-inyección.)
3. Como el repo queda privado, el VPS necesita una **deploy key de solo lectura**:
```bash
# En el VPS
ssh-keygen -t ed25519 -N "" -f /root/.ssh/crm-bot-deploy -C "crm-bot VPS"
cat /root/.ssh/crm-bot-deploy.pub    # pegar en GitHub → repo → Settings → Deploy keys → Add (sin "write access")
cat >> /root/.ssh/config <<'EOF'
Host github-crm-bot
  HostName github.com
  IdentityFile /root/.ssh/crm-bot-deploy
  IdentitiesOnly yes
EOF
```
**Expected result:** `ssh -T git@github-crm-bot` responde "successfully authenticated".
**If it fails:** revisa que la llave pública esté en *Deploy keys* del repo correcto.

#### Step 2: Crear el túnel en Cloudflare (10 min)
dash.cloudflare.com → Zero Trust → Networks → Tunnels → Create → Cloudflared → nombre `crm-bot` → elige Docker y **copia solo el token** (no ejecutes el comando). Public hostnames:

| Subdominio | Dominio | Tipo | URL |
|---|---|---|---|
| `bot` | `bluefishing.cl` | HTTP | `app:3000` |
| `chat` | `bluefishing.cl` | HTTP | `chatwoot-rails:3000` |

**Expected result:** los dos hostnames guardados; Cloudflare crea el DNS solo.
**If it fails:** si ya existen registros A para `bot`/`chat`, bórralos y reintenta. Detalle: [TUNEL-CLOUDFLARE.md](TUNEL-CLOUDFLARE.md).

#### Step 3: Clonar en el VPS
```bash
tmux new -s crm
git clone -b main git@github-crm-bot:Cristob777/bluefishing-bot.git /opt/crm-bot
cd /opt/crm-bot
```
**Expected result:** carpeta `/opt/crm-bot` con el código.
**If it fails:** `Permission denied (publickey)` → vuelve al Step 1.3.

#### Step 4: Generar `.env.production`
```bash
bash deploy/hostinger/init-env.sh
```
Responde: dominios (Enter = `bot.bluefishing.cl` / `chat.bluefishing.cl`), tu email, usuario `/admin` (Enter), modo **1 (tunnel)**, y pega sin eco: token del túnel, OpenAI, App secret, WhatsApp token, Phone number ID y **token Bsale**. El script genera todos los secretos internos.

**Expected result:** termina con `Listo. Siguiente: bash deploy/hostinger/install.sh`.
**If it fails:** si lista "falta X", vuelve a correrlo (es idempotente; no pisa lo ya puesto).

#### Step 5: Instalar
```bash
bash deploy/hostinger/install.sh
sudo cat /root/.crm-bot/credenciales-iniciales       # acceso /admin
sudo cat /root/.crm-bot/chatwoot_admin_password      # acceso Chatwoot
```
**Expected result:** contenedores `crm-bot-*` healthy; `curl -s http://127.0.0.1:18080/health` responde; en Cloudflare el túnel aparece **HEALTHY**.
**If it fails:** `docker compose -p crm-bot logs --since 10m app cloudflared | tail -50`. Ver *Troubleshooting*.

#### Step 6: Verificar Bsale
```bash
docker exec crm-bot-app-1 node scripts/bsale-check.js
```
**Expected result:** `Token OK. Sucursales: ...` y `SKU encontrados en Bsale: N/M`.
- Si el stock de alguna sucursal (p. ej. bodega) no debe ofrecerse, agrega en `.env.production` `BSALE_OFFICE_IDS=<ids>` con los IDs que imprime el script y vuelve a correr `bash deploy/hostinger/install.sh`.
- Los productos sin SKU en la web o no encontrados en Bsale se ofrecen **sin afirmar stock**. Para subir la cobertura, carga el SKU (= código de variante Bsale) en WooCommerce.

**If it fails:** `bsale_http_401` → token mal copiado; `Ningún producto tiene SKU` → espera el primer sync de catálogo (`docker compose -p crm-bot logs catalog-sync | tail`).

#### Step 7: Conectar WhatsApp — elige UNA ruta
Meta admite un solo webhook por app. La decisión es **quién puede contestar cuando Matías traspasa a un vendedor**.

| | **A. WhatsApp → Chatwoot → Matías (recomendada)** | B. WhatsApp → Matías directo |
|---|---|---|
| Matías responde | Sí (Agent Bot) | Sí |
| Un vendedor contesta desde el mismo número | **Sí**, en Chatwoot; Matías se pausa en esa conversación | **No**: el traspaso queda en `/admin`, pero no hay desde dónde responder |
| Atribución de ventas | Sí (teléfono del contacto) | Sí |
| Probado en este repo | Flujo Chatwoot sí; inbox WhatsApp de Chatwoot: probar con el número de prueba primero | Sí |

**Ruta A (recomendada)**
1. Chatwoot → Settings → Inboxes → Add Inbox → **WhatsApp** → proveedor **WhatsApp Cloud**: Phone number ID, WABA ID y el token permanente.
2. Chatwoot muestra una **Webhook URL** y un **Verify token**: pégalos en developers.facebook.com → tu app → WhatsApp → Configuración → Webhook → **Verificar y guardar** → suscribir `messages`.
3. En ese inbox → **Bot Configuration** → elige **Matías** → Save. (Sin bot asignado, las conversaciones no llegan a Matías.)
4. Prueba: escribe al número → responde Matías. Escribe "quiero hablar con un vendedor" → la conversación pasa a **Open** con etiqueta `humano` y el vendedor responde desde Chatwoot. Para devolverla a Matías: estado **Pending**.

**Ruta B (directa)**
```bash
grep ^VERIFY_TOKEN= .env.production | cut -d= -f2
```
Webhook de Meta: URL `https://bot.bluefishing.cl/webhook`, token = el valor de arriba → Verificar y guardar → suscribir `messages`. (Rollback de A: volver a esta URL.)

**Expected result:** Meta muestra el webhook verificado y un mensaje de prueba recibe respuesta.
**If it fails:** `https://bot.bluefishing.cl/health` y `https://chat.bluefishing.cl` deben responder desde fuera; si no, el problema es el túnel (Step 2).

#### Step 8: Chatwoot (bandeja humana)
1. `https://chat.bluefishing.cl` → login con tu email + password del Step 5 → cambia la contraseña.
2. Crea la etiqueta `humano` (Settings → Labels).
3. Invita a los vendedores (Settings → Agents).
4. **No configures un inbox de Email por IMAP** (CVE abierto, ver SETUP §8b).

#### Step 9: Backups diarios
```bash
crontab -e
# agregar:
15 3 * * * cd /opt/crm-bot && bash deploy/hostinger/backup_bluefishing.sh >> /var/log/crm-bot-backup.log 2>&1
```
Respalda **fuera del VPS** (gestor de contraseñas): `.env.production` y `/root/.crm-bot/credenciales-iniciales`.

### Verification
- [ ] `https://bot.bluefishing.cl/health` responde.
- [ ] Desde tu celular: "Hola, busco caña para corvina desde roca, señuelos de 30-50 g" → Matías recomienda productos reales con precio y link de bluefishing.cl.
- [ ] Pregunta "¿tienen stock?" de un producto con SKU → responde con stock confirmado; de uno sin SKU → no lo afirma.
- [ ] `https://bot.bluefishing.cl/admin` → la conversación aparece en Contactos/Embudo.
- [ ] `/admin` → Resultados → **Sincronizar pedidos ahora** → "Fuente: Bsale (web + tienda física)" con ventas totales.
- [ ] Pide "quiero hablar con un vendedor" → Ruta A: aparece en Chatwoot como Open/`humano` y un vendedor responde desde ahí. Ruta B: aparece en `/admin` → Derivados a humano.
- [ ] Backup manual corre: `bash deploy/hostinger/backup_bluefishing.sh`.

### Troubleshooting
| Symptom | Likely Cause | Fix |
|---|---|---|
| Meta no verifica el webhook | `VERIFY_TOKEN` distinto o túnel caído | Copia de nuevo el token; `docker compose -p crm-bot logs cloudflared` debe decir "Registered tunnel connection" |
| WhatsApp no responde pasadas 24 h | `WHATSAPP_TOKEN` temporal | Genera token permanente de usuario del sistema y `install.sh` |
| Matías nunca afirma stock | `BSALE_ACCESS_TOKEN` vacío o SKU faltantes | `docker exec crm-bot-app-1 node scripts/bsale-check.js` |
| Producto agotado no aparece | Comportamiento esperado | Bsale confirmó 0 unidades: Matías ofrece otro |
| Ventas de tienda no se atribuyen | Boleta sin teléfono/correo del cliente | Registrar al cliente en la boleta; ventana: `ATTRIBUTION_WINDOW_DAYS` (30) |
| `install.sh`: "Security preflight failed: X" | Variable X vacía o `CHANGE_ME` | `bash deploy/hostinger/init-env.sh` |
| Respuestas lentas o errores de IA | Límite de gasto OpenAI alcanzado | Revisa usage en platform.openai.com |

### Rollback
```bash
cd /opt/crm-bot
bash deploy/hostinger/backup_bluefishing.sh                 # respaldo antes de tocar nada
git log --oneline -5                                        # elige el commit anterior
git checkout <commit-anterior> && bash deploy/hostinger/install.sh
# Apagar solo el bot (las tiendas no se tocan; sin -v se conservan los datos):
docker compose -p crm-bot --env-file .env.production down
# Daño de datos:
CONFIRM=yes bash deploy/hostinger/restore.sh <timestamp>
```
Para desactivar solo Bsale sin redeploy de código: deja `BSALE_ACCESS_TOKEN=` vacío y corre `install.sh` (vuelve al comportamiento anterior: sin stock en vivo, ventas desde WooCommerce si hay claves).

### Updates (después del primer deploy)
```bash
cd /opt/crm-bot && BLUEFISHING_BRANCH=main bash deploy/hostinger/deploy.sh
```

### Escalation
| Situation | Contact | Method |
|---|---|---|
| Número bloqueado / límites de mensajería | Meta Business Support | business.facebook.com → Ayuda |
| API Bsale sin acceso o token inválido | Soporte Bsale | Ticket desde la cuenta Bsale |
| Túnel no conecta | Cloudflare | Zero Trust → Tunnels → estado del conector |
| VPS caído | Hostinger | hPanel → soporte |

### History
| Date | Run By | Notes |
|---|---|---|
| | Cristóbal | Primer deploy a producción |
