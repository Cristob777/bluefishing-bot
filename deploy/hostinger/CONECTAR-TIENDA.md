# Conectar la tienda WooCommerce del operador (sin pasar claves)

Objetivo: que el bot lea **pedidos** (ventas atribuidas, etapa «Compró» del CRM) y el
catálogo por la API privada, sin que el dueño copie ni envíe claves o contraseñas.
El dueño aprueba un acceso de **solo lectura** en su propio WordPress; WooCommerce envía
las claves directamente al bot, que las guarda cifradas (`CREDENTIALS_MASTER_KEY`).

Requisitos: un usuario **administrador** de la tienda, y en `.env.production`:
`PUBLIC_BASE_URL=https://<BOT_DOMAIN>`, `CREDENTIALS_MASTER_KEY`, `PANEL_SESSION_SECRET`
(los valida `install.sh`).

## Pasos (5 minutos, con el dueño o con acceso admin a su WordPress)

1. En el VPS, encender el panel temporalmente y redesplegar:
   ```bash
   cd /opt/crm-bot
   sed -i 's/^PANEL_ENABLED=.*/PANEL_ENABLED=true/' .env.production
   bash deploy/hostinger/deploy.sh
   # modo nginx: además
   bash deploy/hostinger/nginx-site.sh render && bash deploy/hostinger/nginx-site.sh install
   ```
2. Abrir `https://<BOT_DOMAIN>/panel` (pide el basic auth del proxy) → «Crea la cuenta de tu empresa».
3. «Conectar tienda» → `https://bluefishing.cl` → en WordPress, **Aprobar**.
   El panel debe mostrar la tienda como conectada.
4. Volver a apagar el panel (las claves quedan en la base; el sync no necesita el panel):
   ```bash
   sed -i 's/^PANEL_ENABLED=.*/PANEL_ENABLED=false/' .env.production
   docker compose -p crm-bot --env-file .env.production up -d app
   ```
5. Forzar un ciclo y verificar:
   ```bash
   docker compose -p crm-bot --env-file .env.production restart catalog-sync
   docker compose -p crm-bot logs --since 5m catalog-sync
   ```
   Esperado: `"source":"woocommerce_api_panel"` (catálogo) y `[Woo] operador (panel): { ok: true, ... }` (pedidos).

## Cómo se atribuye una venta

Un pedido `completed`/`processing` se atribuye al bot si su teléfono (últimos 9 dígitos) o su
correo coincide con un contacto que habló con Matías antes del pedido, dentro de
`ATTRIBUTION_WINDOW_DAYS` (30 por defecto). El contacto pasa solo a «Compró» y el monto
aparece en `/admin` → Resultados y Contactos.

La tienda conectada se trata como **la del operador**: sus pedidos se guardan en el mismo
ámbito que los contactos del WhatsApp del operador (`PHONE_NUMBER_ID`). Con más de una empresa
conectada, definir `WOO_OPERATOR_TENANT_ID` con el UUID de la que es del operador.

## Revocar

WordPress → WooCommerce → Ajustes → Avanzado → REST API → borrar la clave «BlueFishing Bot».
El bot vuelve solo a la Store API pública / scraping para el catálogo; los pedidos dejan de sincronizarse.
