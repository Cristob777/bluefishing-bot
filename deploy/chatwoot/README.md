# Chatwoot para BlueFishing (bandeja de conversaciones + traspaso a humanos)

Chatwoot es la bandeja donde el dueño y los vendedores ven las conversaciones, contactos y etiquetas.
Matías (el bot) se conecta como **Agent Bot**: responde mientras la conversación está **pending** y la pasa a **open**
(etiqueta `humano`) cuando el cliente pide una persona o el motor detecta handoff.

> Estado: integración detrás de `CHATWOOT_ENABLED=false` por defecto. **El webhook directo de WhatsApp (`/webhook`) no cambia.**

## 1. Requisitos y costo
- RAM: la doc oficial indica **4 GB como mínimo** (hasta ~10.000 conversaciones/día). Junto al bot (Postgres + app) se recomienda un VPS de **8 GB** (ej. Hostinger KVM 2 o superior). ⚠️ precios Hostinger no verificados.
- Disco: ≥ 20 GB libres (adjuntos en `storage_data`).
- Licencia: núcleo MIT (carpeta `enterprise/` con licencia propia; no se usa).

## 2. Instalación (VPS, fuera de este repo)
```bash
cd deploy/chatwoot
cp .env.example .env            # completar SECRET_KEY_BASE, contraseñas, FRONTEND_URL, SMTP
docker compose run --rm rails bundle exec rails db:chatwoot_prepare
docker compose up -d
curl -fsS http://127.0.0.1:3100/ >/dev/null && echo OK
```

## 3. Subdominio (proxy)
Publicar `https://chat.bluefishing.cl` → `127.0.0.1:3100` (Chatwoot usa WebSockets en `/cable`).

**Caddy** (si se usa el Caddyfile del bot, agregar un bloque):
```
chat.bluefishing.cl {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3100
}
```
**Traefik (proxy compartido de Hostinger)**: crear un router `Host(\`chat.bluefishing.cl\`)` hacia el servicio `rails:3000`
con TLS (certresolver) y conectar `rails` a la red de Traefik. ⚠️ El nombre de red/certresolver depende de la instalación del VPS (no está en el repo).

## 4. Configuración en Chatwoot
1. **Cuenta**: entrar a `https://chat.bluefishing.cl`, crear el usuario administrador (dueño) y la cuenta "BlueFishing".
2. **Inbox**: Settings → Inboxes → Add Inbox:
   - *Website*: para el chat del sitio (alternativa al widget propio `/widget.js`), o
   - *API*: para pruebas y para integrar otros canales.
   - (Más adelante) *WhatsApp* — ver §6.
3. **Agent Bot**: Settings → Bots → Add Bot. Nombre "Matías", Webhook URL: `https://bot.bluefishing.cl/chatwoot/webhook`.
   - Copiar el **secreto del webhook** → `CHATWOOT_WEBHOOK_SECRET` en `.env.production` del bot.
   - Copiar el **access token del bot** → `CHATWOOT_BOT_TOKEN`.
   - En el inbox → Bot Configuration → elegir "Matías" → Save.
4. **Etiqueta**: Settings → Labels → crear `humano` (las conversaciones traspasadas la reciben).
5. **Vendedores**: Settings → Agents → Add Agent (email). Roles:
   - *Administrator*: dueño (configuración, bots, inboxes, reportes).
   - *Agent*: vendedores (atienden conversaciones de los inboxes asignados).
   Asignar cada vendedor a los inboxes en Settings → Inboxes → Collaborators.
6. **Bot del lado de BlueFishing** (`.env.production` del bot):
   ```
   CHATWOOT_ENABLED=true
   CHATWOOT_BASE_URL=https://chat.bluefishing.cl
   CHATWOOT_BOT_TOKEN=...
   CHATWOOT_WEBHOOK_SECRET=...
   ```

## 5. Flujo
- Mensaje del cliente → conversación **pending** → Chatwoot llama al webhook firmado (`X-Chatwoot-Signature`) → el bot responde con el mismo motor (sesión `cw:<id de conversación>`, `bot_events`, contacto `chatwoot`).
- "Quiero hablar con un vendedor" o handoff del motor → mensaje de traspaso, etiqueta `humano`, estado **open**, fila en `handoff_requests`.
- En **open** o asignada, el bot no responde. Para devolverla al bot: cambiar el estado a **pending**.
- Si el bot falla, la conversación pasa a **open** para que un humano responda.

## 6. Fase siguiente: WhatsApp en Chatwoot (NO incluido)
Hoy WhatsApp va directo al bot (`/webhook`). Migrarlo requiere: crear inbox WhatsApp Cloud en Chatwoot con el mismo número,
cambiar el webhook en Meta a Chatwoot, conectar el Agent Bot a ese inbox y dejar `/webhook` como rollback. Probar primero con un número de prueba.

## 7. Backups
- Postgres diario: `docker compose exec -T postgres pg_dump -U postgres chatwoot | gzip > /backups/chatwoot-$(date +%F).sql.gz`
- Volumen `storage_data` (adjuntos): `docker run --rm -v bluefishing-chatwoot_storage_data:/d -v /backups:/b alpine tar czf /b/chatwoot-storage-$(date +%F).tgz -C /d .`
- Retener ≥ 7 días y copiar fuera del VPS. Probar restauración.
- Actualizar: cambiar `CHATWOOT_IMAGE_TAG`, `docker compose pull && docker compose run --rm rails bundle exec rails db:chatwoot_prepare && docker compose up -d` (con backup previo).
