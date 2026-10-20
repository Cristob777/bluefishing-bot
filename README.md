# BlueFishing AI Sales Agent

BlueFishing is building **Matías**, an AI sales agent designed to help customers choose fishing products through WhatsApp using the real BlueFishing catalog.

The project combines product knowledge, conversational AI and commercial analytics so the store can answer customers faster, recommend products more consistently and understand what customers are looking for.

## What Matías does

Matías acts as a technical sales assistant for fishing products.

A customer can write something like:

```text
Busco una caña para corvina desde roca y uso señuelos de 30-50 g.
```

Matías can identify useful context such as:

- product type;
- target species;
- fishing position;
- technique;
- gram range;
- brand preference;
- budget;
- purchase intent.

It then searches the BlueFishing catalog and uses the available product information to prepare a concise recommendation.

The goal is to answer with real BlueFishing products and avoid inventing prices, links or technical specifications.

## What the customer sees

The customer interacts with Matías through a normal WhatsApp conversation.

Typical experience:

```text
Customer asks what they need
        ↓
Matías understands the fishing context
        ↓
Matías searches the BlueFishing catalog
        ↓
Matías recommends suitable products
        ↓
Customer receives a short explanation and product links
```

If information is missing, Matías can ask a relevant clarification.

If the request needs human attention, the conversation can be escalated to the BlueFishing team.

## Product knowledge

The agent uses structured product knowledge derived from the BlueFishing catalog and product information.

This can include:

- target species;
- water type;
- fishing position;
- technique;
- product weight range;
- rod characteristics;
- reel characteristics;
- lure type and action;
- use cases;
- supporting product information.

The objective is to make recommendations based on available product evidence instead of relying only on general model knowledge.

## BlueFishing Sales Console

The store owners have access to a private sales dashboard that helps them understand how customers interact with Matías.

The dashboard can show:

- number of customer interactions;
- active customers;
- recent conversations;
- detected customer intent;
- products recommended most often;
- species and fishing needs customers ask about;
- customers with stronger purchase intent;
- conversations that require human attention;
- operational AI usage;
- response performance.

Owners can also review individual conversations and the customer context detected by Matías.

The dashboard is intended as a visibility and decision-support tool for the store team.

## Business value

The project is designed to help BlueFishing:

- respond to customers faster;
- maintain more consistent technical product guidance;
- reduce repetitive sales questions handled manually;
- make the online catalog easier to navigate through conversation;
- identify what products and fishing needs generate the most interest;
- detect conversations that need a salesperson;
- create better commercial data from WhatsApp interactions.

## High-level flow

```text
Customer
   ↓
WhatsApp
   ↓
Matías AI Sales Agent
   ↓
BlueFishing product catalog and product knowledge
   ↓
Recommendation / clarification / human handoff
   ↓
Sales activity data
   ↓
BlueFishing Sales Console
   ↓
Store owners and sales team
```

## Current scope

The current version focuses on:

- WhatsApp sales assistance;
- website chat widget (same sales engine, sessions, telemetry and handoff as WhatsApp);
- CRM contact records per channel (WhatsApp and web);
- fishing-product recommendations;
- product catalog retrieval;
- structured product knowledge;
- conversational context;
- human handoff;
- usage and sales telemetry;
- owner-facing dashboard.

## Website chat widget

Embed on the store site:

```html
<script src="https://bot.bluefishing.cl/widget.js" defer></script>
```

- `GET /widget.js` serves the widget; `POST /chat` answers with the same engine as WhatsApp (`web:<sessionId>` sessions).
- Only origins listed in `ALLOWED_ORIGIN` may call `/chat` (CORS plus a server-side 403); leaving it empty disables web chat.
- Rate limited per IP and per session; uses the same body-size limit and log pseudonymisation as WhatsApp.

## Chatwoot (optional, behind `CHATWOOT_ENABLED`)

Chatwoot can act as the owner/sales inbox with Matías as its Agent Bot (`POST /chatwoot/webhook`, HMAC-signed).
The bot answers pending conversations and hands off to humans (status `open`, label `humano`, `handoff_requests`).
The direct WhatsApp webhook is unchanged; moving WhatsApp into Chatwoot is a later step. Setup: `deploy/chatwoot/README.md`.

## Atomic CRM (optional, behind `ATOMIC_CRM_ENABLED`)

Sales pipeline for the owner on Atomic CRM (Supabase cloud + static SPA). A one-way, idempotent job
(`scripts/atomic-crm-sync.js`, compose profile `atomic-crm`) syncs contacts, inferred stages, deals and handoff notes. Setup: `deploy/atomic-crm/README.md`.

## Future phase

A full CRM is intentionally left for a later phase.

The initial objective is to put Matías into real use, observe actual customer conversations and understand how BlueFishing's sales workflow behaves in practice.

That production data can then be used to define the right CRM workflow for:

- leads;
- follow-up;
- opportunities;
- customer history;
- sales pipeline;
- salesperson assignment.

## Project principle

Matías is not designed to be a general-purpose chatbot.

It is a focused sales assistant for BlueFishing whose role is to understand the customer's fishing need, use the store's own product information and help move the conversation toward the right product or the right human salesperson.

## Onboarding autoservicio (multi-tenant)

`/panel` permite que el dueño de cada empresa cree su cuenta (correo + contraseña, scrypt) y conecte sus cuentas sin entregarle claves a nadie. Cada empresa es un tenant.

- **Conectar tienda (WooCommerce):** redirige a `{tienda}/wc-auth/v1/authorize` con `scope=read`. WooCommerce hace POST a `/panel/woo/callback` con `consumer_key`/`consumer_secret`; el `user_id` es un state aleatorio de un solo uso (15 min) que identifica al tenant. Las claves se validan con una lectura a `/wp-json/wc/v3/products` antes de guardarse.
- **WhatsApp fase 1 (app propia del cliente):** el dueño pega token permanente de System User, Phone number ID, WABA ID y App secret. Se validan contra la Graph API (el número debe pertenecer al WABA), se hace `POST /{waba}/subscribed_apps` y se muestra la URL del webhook y un verify token propio del tenant.
- **WhatsApp fase 2 (Embedded Signup, opcional):** detrás de `WA_EMBEDDED_SIGNUP_ENABLED=true` (apagado por defecto). Intercambia el `code` por un business token, suscribe el WABA y registra el número.
- **Webhook:** `/webhook` enruta por `metadata.phone_number_id` al tenant correcto, valida la firma con el app secret de ese tenant (o `META_APP_SECRET`) y responde con su token. El número de `PHONE_NUMBER_ID` del `.env` sigue funcionando como antes.
- **Credenciales:** tabla `tenant_credentials`, una fila por tenant, cifradas con AES-256-GCM (`CREDENTIALS_MASTER_KEY`), con AAD `tenant:campo`. La key de OpenAI sigue siendo global.

Migración: `npm run db:migrate` (`db/migrations/002_tenant_onboarding.sql`, idempotente).

| Variable | Uso |
|---|---|
| `PUBLIC_BASE_URL` | URL https pública del bot. Opcional: por defecto `https://$BOT_DOMAIN`. |
| `CREDENTIALS_MASTER_KEY` | 32 bytes (hex o base64) para AES-256-GCM. `openssl rand -hex 32`. Necesaria para activar `/panel`. |
| `PANEL_SESSION_SECRET` | ≥32 caracteres, firma las sesiones del panel. Necesaria para activar `/panel`. |
| `WA_EMBEDDED_SIGNUP_ENABLED` | `true` activa la fase 2. Por defecto apagado. |
| `META_APP_ID` | App ID de Meta (fase 2). |
| `META_ES_CONFIG_ID` | `config_id` de Facebook Login for Business (fase 2). |

Todas son opcionales para el deploy: si faltan, `/panel` responde 404 y el bot sigue funcionando igual con `WHATSAPP_TOKEN`/`PHONE_NUMBER_ID`. `deploy/hostinger/deploy.sh` valida su formato solo si están puestas y aplica `db/migrations/*.sql` (idempotentes). `/panel` lo sirve el mismo proceso Node que `/webhook` (puerto 3000 del contenedor, `127.0.0.1:18080` en el host), así que el proxy (Traefik de Hostinger) no necesita reglas nuevas: basta con que enrute el dominio al app.

Overrides solo para pruebas locales (no definir en producción): `GRAPH_API_BASE_URL`, `OPENAI_BASE_URL` (apuntan a mocks) y `WOO_ALLOW_LOCAL_TEST_STORE=1` (acepta `http://127.0.0.1` como tienda; se ignora con `NODE_ENV=production`).

Limitación actual: Matías usa el catálogo de BlueFishing para todos los tenants; el catálogo por tenant (usando sus claves de WooCommerce) queda para un PR posterior.
