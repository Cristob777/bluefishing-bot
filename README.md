# BlueFishing WhatsApp Sales Bot

Production-focused WhatsApp sales assistant for [BlueFishing.cl](https://bluefishing.cl).

The bot does not treat the language model as the catalog database. It classifies the customer's intent, retrieves compatible products from BlueFishing's catalog and technical knowledge layer, then uses OpenAI to write a short grounded sales response.

## Production scope

- Channel: WhatsApp Cloud API only
- Runtime: Vercel Functions, Node.js 22
- AI: OpenAI Responses API
- Default model: `gpt-6-luna`
- Catalog: versioned BlueFishing catalog
- Product knowledge: scraped product pages + structured extraction
- Persistence: Supabase when configured, with safe runtime fallbacks
- CI: GitHub Actions tests + catalog/enrichment validation

The previous web widget and admin routes are not exposed by the production Vercel routing configuration.

## Request flow

```text
Customer WhatsApp
       |
       v
Meta WhatsApp Cloud API
       |
       v
/api/webhook.js
  - verifies ingress
  - rejects stale/duplicate messages
  - sanitizes text
       |
       v
lib/salesEngine.js
       |
       +--> lib/classifier.js
       |       intent + customer context
       |
       +--> lib/catalog.js
       |       evidence-based compatible-product retrieval
       |
       +--> lib/ai.js
               OpenAI Responses API
       |
       v
Meta WhatsApp Cloud API
       |
       v
Customer
```

## Product knowledge

`catalogo/catalogo_para_bot.txt` contains the sellable catalog snapshot.

`catalogo/product_knowledge.json` contains structured technical knowledge keyed by product URL. The enrichment pipeline extracts fields such as:

- target species
- water type
- fishing position
- fishing technique
- use case
- rod/reel/lure-specific specifications
- evidence
- extraction confidence

The bot may recommend only products returned by retrieval. Missing technical information is treated as unknown; the model is explicitly instructed not to invent specifications.

### Refresh pipeline

```text
WooCommerce REST API (preferred)
        |
        +-- unavailable --> preserve last known valid catalog
        |
        v
catalogo_para_bot.txt
        |
        v
BlueFishing product pages / JSON-LD
        |
        v
OpenAI structured extraction
        |
        +-- OpenAI unavailable --> conservative heuristic extraction
        |
        v
product_knowledge.json
        |
        +--> optional Supabase mirror
```

Commands:

```bash
npm run sync-catalogo
npm run enrich-catalogo
npm run catalog:refresh
npm test
```

GitHub Actions runs tests and a small enrichment sample on pull requests. Scheduled/manual runs perform the full refresh and may commit updated catalog knowledge.

## Retrieval rules

Recommendations are ranked using evidence including:

- product type
- exact/partial product name
- brand
- target species
- water type
- fishing position
- technique
- lure/rod weight compatibility
- customer budget
- requested attribute

There is no "first five products" fallback. If nothing compatible scores, the assistant says it cannot make a safe recommendation from the retrieved catalog.

## Persistence and operations

When Supabase is configured:

- `bot_sessions` stores conversation context
- `processed_whatsapp_messages` makes webhook processing idempotent
- `product_attributes` stores automatic and human-reviewed product knowledge
- `bot_events` stores operational telemetry
- `handoff_requests` stores human handoff requests
- `chat_feedback` stores reviewed corrections

When Supabase is unavailable, product knowledge still loads from the versioned JSON file. The assistant does not claim a human handoff was registered unless persistence actually succeeded.

## Required production environment

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-luna

VERIFY_TOKEN=
WEBHOOK_INGRESS_SECRET=
WHATSAPP_TOKEN=
PHONE_NUMBER_ID=
GRAPH_API_VERSION=v24.0

# Recommended for durable sessions / handoff / telemetry
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Optional preferred catalog source
WC_URL=https://bluefishing.cl
WC_CONSUMER_KEY=
WC_CONSUMER_SECRET=
```

Never commit secrets to the repository.

The Meta callback URL is expected to use the ingress secret:

```text
https://<production-domain>/webhook?ingress=<WEBHOOK_INGRESS_SECRET>
```

The Meta webhook verification token must match `VERIFY_TOKEN`.

## Health check

`GET /health` returns the production readiness state without exposing secret values.

Expected states:

- `ok`: required configuration present and persistent store available
- `degraded`: WhatsApp/OpenAI/catalog ready but persistent store unavailable
- `not_ready`: one or more required production inputs missing

Do not promote a new production release until the health endpoint is at least `degraded`; for the intended production architecture it should be `ok`.

## Tests

The repository includes Node tests for:

- product-page/JSON-LD extraction
- technical knowledge heuristics
- catalog URL discovery
- CLP price formatting
- gram-range compatibility
- budget matching
- truthful handoff behavior

CI also syntax-checks production entrypoints.

## Deployment

The repository is connected to Vercel through GitHub. Pull requests produce preview deployments. Merging to `main` should be treated as a production release and should happen only after:

1. CI is green.
2. Catalog/enrichment validation is green.
3. Required Vercel environment variables are present.
4. `/health` is healthy.
5. Meta's production WhatsApp callback points to the production deployment.
6. A real inbound/outbound WhatsApp smoke test succeeds.

## Security notes

- No default verification token is committed.
- Webhook ingress requires a secret query parameter in addition to Meta verification.
- Duplicate WhatsApp message IDs are persisted when Supabase is available.
- The bot does not expose web-chat endpoints in the production routing configuration.
- Product recommendations are grounded in retrieved catalog records and verified/enriched technical data.
- The OpenAI API key, WhatsApp token, WooCommerce credentials and Supabase service role must remain server-side.


## Hostinger KVM4 production deployment

The preferred production target is now BlueFishing's own Hostinger KVM4 VPS.

Stack:

```text
Internet / Meta WhatsApp
        |
        v
Caddy :443
 automatic TLS
        |
        v
Node.js 22 app :3000
        |
        v
PostgreSQL 17
```

The VPS deployment is defined by:

- `Dockerfile`
- `docker-compose.yml`
- `Caddyfile`
- `.env.production.example`
- `db/schema.sql`
- `deploy/hostinger/deploy.sh`

### Initial VPS setup

Install Docker Engine + Docker Compose plugin, clone the repository, then:

```bash
git checkout prod/hostinger-kvm4
cp .env.production.example .env.production
nano .env.production
chmod +x deploy/hostinger/deploy.sh
./deploy/hostinger/deploy.sh
```

DNS must point `BOT_DOMAIN` (recommended: `bot.bluefishing.cl`) to the KVM4 public IP before Caddy can obtain HTTPS certificates.

The production Meta callback becomes:

```text
https://bot.bluefishing.cl/webhook
```

POST callbacks are authenticated using Meta's `X-Hub-Signature-256` and `META_APP_SECRET`.

PostgreSQL on the VPS replaces Supabase as the preferred persistence backend for sessions, duplicate-message protection, telemetry and human handoff. Supabase remains supported as a compatibility fallback.

The `catalogo` directory is bind-mounted so generated product knowledge survives container rebuilds.
