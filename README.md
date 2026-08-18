# BlueFishing Bot — AI Customer Service, an sales for WhatsApp

> Automated customer service chatbot for a fishing e-commerce brand, handling product queries and recommendations via WhatsApp using Claude AI with full catalog context.

[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000?logo=vercel)](https://vercel.com/)
[![Claude](https://img.shields.io/badge/Claude-Haiku_4.5-blueviolet?logo=anthropic)](https://anthropic.com/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Cloud_API-25D366?logo=whatsapp)](https://developers.facebook.com/docs/whatsapp/cloud-api)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs)](https://nodejs.org/)

---

## The Problem

BlueFishing.cl is a Chilean e-commerce brand selling fishing gear across 15,000+ SKUs. Before this chatbot:

- **Customer queries piled up on WhatsApp** — the team answered the same product questions manually, over and over: "¿Qué caña me recomiendas para pescar róbalo?", "¿Tienen líneas trenzadas?", "¿Hacen envíos a regiones?"
- **Response time was hours or days** — queries that arrived outside business hours went unanswered until the next day, losing potential sales
- **No product expertise at scale** — only 1-2 people on the team knew the full catalog well enough to make good recommendations. When they weren't available, customers got generic answers
- **Instagram DMs ignored** — no capacity to cover a second channel

---

## What the Bot Does

A WhatsApp-connected AI assistant ("Matías") that acts as a fishing gear expert for BlueFishing customers. It:

- **Answers product questions** using the real BlueFishing catalog — prices, categories, and direct product URLs
- **Makes personalized recommendations** by qualifying the customer first (type of fishing, target species, experience level) before suggesting 1-2 products
- **Handles FAQs** about shipping, policies, and store information
- **Escalates to human agents** when the query is outside scope or the customer requests it
- **Defends against prompt injection** — scoped strictly to fishing, products, and store policies

---

## Business Impact

| Metric | Impact |
|--------|--------|
| **Response time** | From hours/days → seconds, 24/7 availability |
| **Query capacity** | From 1-2 staff handling DMs manually → unlimited concurrent conversations |
| **Product coverage** | 208 products across 6 categories instantly queryable with prices and URLs |
| **Sales conversion** | Every recommendation includes direct product link + CTA — reducing friction from "interested" to "purchase" |
| **Staff time freed** | Repetitive "¿Qué caña me recomiendas?" queries handled automatically — team focuses on complex sales and fulfillment |
| **Consistency** | Every customer gets expert-level recommendations regardless of time of day or staff availability |

### What This Means for the Business

**Revenue protection:** Unanswered WhatsApp messages are lost sales. In Chilean e-commerce, WhatsApp is the primary pre-purchase channel — customers expect fast responses before buying. The bot ensures no query goes unanswered, especially outside business hours when competitors' DMs also go silent.

**Cost efficiency:** A single serverless function on Vercel's free tier + Claude Haiku (the most cost-efficient model in the Claude family) handles what would require a dedicated customer service hire. Estimated monthly cost: <$30 in API calls vs. ~$800+ for a part-time hire.

**Scalable expertise:** The bot has the entire catalog memorized with prices and URLs. A new hire would take weeks to learn 208 products across 6 categories. The bot does it from day one and never forgets.

---

## Architecture

```
┌─────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Customer    │   │  Meta WhatsApp   │   │  api/webhook.js  │
│  WhatsApp    │──▶│  Cloud API       │──▶│  (WhatsApp I/O)  │──┐
└─────────────┘   └──────────────────┘   └──────────────────┘  │
                                                                 │
┌─────────────┐   ┌──────────────────┐   ┌──────────────────┐  │   ┌────────────────────┐
│  Customer    │   │  /widget.js on   │   │  api/chat.js     │  ├──▶│  lib/salesEngine.js │
│  bluefishing │──▶│  bluefishing.cl  │──▶│  (web I/O, CORS) │──┘   │  classify → retrieve │
│  .cl         │   └──────────────────┘   └──────────────────┘      │  catalog → Claude    │
└─────────────┘                                                     └──────────┬───────────┘
                                                                                │
                                                                     ┌──────────▼───────────┐
                                                                     │  Send reply back on   │
                                                                     │  the same channel     │
                                                                     └───────────────────────┘
```

**Design decision:** The catalog (208 products) fits within Claude's context window, so the current approach uses prompt stuffing rather than RAG. This eliminates the complexity of embeddings, vector databases, and semantic search — while delivering accurate responses with exact prices and URLs. When the catalog grows beyond context window limits, the architecture is designed to evolve to RAG with Supabase pgvector.

---

## How It Works

1. **Customer sends a WhatsApp message** → Meta Cloud API forwards it to the Vercel webhook
2. **Webhook validates** — deduplicates messages, rejects stale messages (>300s old), sanitizes input (max 800 chars)
3. **Loads conversation history** — last 10 messages per phone number, kept in-memory
4. **Builds the prompt** — system prompt (identity, rules, commercial flow) + full catalog + conversation history
5. **Claude Haiku generates a response** — qualifies the customer, recommends 1-2 products with exact URLs, closes with CTA
6. **Response sent back** via WhatsApp Cloud API — formatted for mobile (max 3 short paragraphs, no markdown, max 4096 chars)

### The AI Persona: "Matías"

The bot operates as Matías, a fishing gear expert who follows a consultative sales flow:
- Qualifies first (what type of fishing? target species? experience level?)
- Asks maximum 2 questions before recommending
- Recommends 1-2 specific products with prices and direct URLs
- Closes with a CTA or follow-up question
- Escalates to human when needed

---

## Catalog Pipeline

The product catalog stays in sync with WooCommerce via a scheduled GitHub Action:

```
WooCommerce REST API → scripts/sync-catalogo.js → catalogo_para_bot.txt → git commit → Vercel redeploy
```

- **Source:** WooCommerce REST API (`/wp-json/wc/v3/products` + `/products/categories`), authenticated with a read-only Consumer Key/Secret
- **Transform:** `scripts/sync-catalogo.js` pulls published, in-stock products, resolves each product's category path (e.g. `Marcas > BADFISH`), and formats `name | price | category | permalink`
- **Automation:** `.github/workflows/sync-catalogo.yml` runs the sync daily (and on-demand via `workflow_dispatch`), commits `catalogo_para_bot.txt` if it changed, and pushes — Vercel picks up the push and redeploys automatically
- **Output:** `catalogo/catalogo_para_bot.txt` — 208 products across 6 categories
- **Categories covered:** Cañas, Carretes, Líneas, Combos, Señuelos, + brand-specific categories

**Setup:**
1. In WooCommerce → Settings → Advanced → REST API, create a key with **Read** permissions
2. Add `WC_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` as GitHub Actions repo secrets (Settings → Secrets and variables → Actions)
3. In repo Settings → Actions → General → Workflow permissions, enable **"Read and write permissions"** so the workflow can push the updated catalog
4. Trigger the workflow manually once (`Actions` tab → *Sync WooCommerce Catalog* → *Run workflow*) to verify it, or run `npm run sync-catalogo` locally with the same env vars set

Legacy manual path (`wc-product-export.csv` → `npm run build-catalogo`) still works as a fallback if the API isn't reachable.

---

## Training the Bot: `/admin` Catalog Enrichment

Product names alone don't say what a rod, reel, or lure is actually *for* — target species, water type, fishing technique, power rating, gear ratio, etc. Without that, the bot can only guess from keywords in the product name, which is how it ends up sounding incoherent (recommending a heavy jigging rod for light río fishing, or staying silent on species fit). `/admin` is where the team fills in that missing data per product, and the bot uses it directly instead of guessing.

### How it fits together

```
WooCommerce ──sync-catalogo.js──▶ Supabase `products` (mirror, read-only for staff)
                                         │
Staff logs into /admin ─────────────────┼──▶ Supabase `product_attributes` (the "questionnaire")
                                         │
Customer message ──▶ webhook.js ──▶ lib/catalog.js merges products + product_attributes
                                     ──▶ scores/ranks products using the curated fields
                                     ──▶ passes verified specs to Claude, flags unverified products
```

- `catalogo/schema-enriquecimiento.js` defines the questionnaire fields — common fields (target species, water type, fishing position, technique, experience level, verified notes) plus category-specific specs (rod power/action/length, reel gear ratio/drag, lure type/action/weight, etc.). `/admin` renders its form directly from this file, so adding a field there adds it to the UI automatically.
- `lib/catalog.js` prefers curated data over the old name-based regex guessing, but falls back to the regex heuristics for any product that hasn't been trained yet — nothing breaks for the untrained majority on day one.
- Products without a `product_attributes` row are sent to Claude tagged `[sin ficha técnica verificada]`, and the system prompt (`api/webhook.js`) explicitly forbids inventing technical specs for those.

### Setup (one-time)

1. Create a free project at [supabase.com](https://supabase.com)
2. In the SQL Editor, run `supabase/schema.sql` — creates `products` and `product_attributes` with RLS (nothing is publicly readable/writable, only logged-in staff)
3. In **Authentication → Providers**, disable public sign-ups (invite-only)
4. In **Authentication → Users**, add one account per team member who should be able to train the catalog
5. In **Project Settings → API**, copy the URL, `anon` key, and `service_role` key
6. Add to Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (client-safe, used by `/admin`), `SUPABASE_SERVICE_ROLE_KEY` (server-only — used by `scripts/sync-catalogo.js` and the webhook, never exposed to the browser)
7. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as GitHub Actions secrets too, so the daily WooCommerce sync keeps the `products` mirror current
8. Redeploy, then visit `/admin` and log in

### Day-to-day

Each team member logs into `/admin` with their own account, picks a product from the list (badge shows *Entrenado* vs *Pendiente*), fills in the questionnaire, and saves. Changes are live for the bot within ~5 minutes (`lib/enrichment.js` caches the attributes table for that long to avoid a DB round-trip on every WhatsApp message).

### Chat de prueba + Correcciones

`/admin` has two more tabs beyond the product catalog:

- **Chat de prueba** — a private chat window (`api/admin-chat.js`, auth-gated) where the team can talk to Matías directly, same brain as WhatsApp/web, to poke at it and see how it actually answers. Every bot reply has a "👎 Marcar incorrecta" button; clicking it opens a small form to write down what the correct answer should have been, and saves it — along with the classified intent/context and which products were retrieved — to the `chat_feedback` table.
- **Correcciones** — the review queue for everything flagged that way: what the customer asked, what the bot wrongly said, what it should have said, and who flagged it. Each item has a "Marcar resuelta" button for once the underlying issue is actually fixed (usually by training the relevant product in the Catálogo tab, sometimes by adjusting the prompt).

### Auto-training from resolved corrections

There's no fine-tuning of Claude here — that's not how this architecture improves, and continuous fine-tuning wouldn't make sense for a catalog this size anyway. What *is* automatic: the moment someone clicks **"Marcar resuelta"** on a correction, `lib/learnedExamples.js` picks it up (cached 5 min, same pattern as catalog enrichment) and every future sales reply — WhatsApp, web widget, or `/admin` test chat — gets it injected into the system prompt as a validated example ("a customer asked something like X, the team-verified correct answer was Y"). No code changes, no redeploy, no re-teaching the same lesson twice.

This deliberately keeps a human checkpoint: only `status = 'resolved'` corrections ever reach the prompt. A flagged-but-unreviewed correction (which could be mistyped, or the reviewer misjudged the situation) never touches a live customer conversation until someone confirms it via "Marcar resuelta". The queue caps at the 20 most recent resolved corrections to keep prompt size bounded.

---

## Web Chat Widget

Same bot, same catalog, same training data — now also embeddable directly on bluefishing.cl as a chat bubble, not just WhatsApp. `api/webhook.js` (WhatsApp) and `api/chat.js` (web) are both thin transport layers that call the same `lib/salesEngine.js`, so there's one sales brain and one system prompt behind both channels — no drift between what WhatsApp says and what the website says.

### Embed it

Add this snippet before `</body>` on the site (e.g. via the theme's footer, or a plugin like "Insert Headers and Footers" — no code changes needed elsewhere):

```html
<script src="https://<your-vercel-domain>/widget.js"
        data-color="#0b3d63"
        data-greeting="¡Hola! Soy Matías, el asistente de Bluefishing. ¿En qué te puedo ayudar?">
</script>
```

- `data-color` / `data-greeting` / `data-position` (`right` default, or `left`) are optional
- The widget auto-detects the API to call from its own `<script src>` — no need to hardcode a domain inside the snippet beyond the `src` itself
- Conversation history and a per-visitor session id are kept in `localStorage`, so reopening the widget across page views keeps context

### Setup (one-time)

1. Add `ALLOWED_ORIGIN` as a Vercel env var with the site's domain(s), comma-separated (e.g. `https://bluefishing.cl,https://www.bluefishing.cl`) — this is what the browser checks before allowing the widget to call `/chat`, and requests from any other origin are rejected
2. Redeploy, then paste the embed snippet on the site

### Notes

- Same guardrails as WhatsApp: no invented specs, no invented prices/stock, wholesale inquiries get routed to a human instead of a product pitch
- Conversation memory is in-process per serverless instance (same limitation as WhatsApp today — see Roadmap) — a visitor's context can reset on a cold start

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 18+ (Vercel Serverless Functions) |
| AI (primary) | Claude Haiku 4.5 via `@anthropic-ai/sdk` |
| AI (fallback) | Gemini 2.0 Flash via `@google/generative-ai` |
| Messaging | Meta WhatsApp Cloud API v18.0 + embeddable web widget (vanilla JS, no framework) |
| Catalog sync | WooCommerce REST API → GitHub Action (cron) → text pipeline + Supabase mirror |
| Catalog training | Supabase (Postgres + Auth) + `/admin` (vanilla JS, no framework) |
| Deployment | Vercel (serverless functions) |
| Memory | In-process (last 10 messages per phone number) |

---

## Configuration

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access (primary LLM) |
| `GEMINI_API_KEY` | Gemini API access (fallback LLM) |
| `WHATSAPP_TOKEN` | Meta WhatsApp Cloud API token |
| `PHONE_NUMBER_ID` | WhatsApp Business phone number ID |
| `VERIFY_TOKEN` | Webhook verification token |
| `WC_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` | WooCommerce REST API sync |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Catalog DB — safe to expose client-side in `/admin`, protected by RLS + login |
| `SUPABASE_SERVICE_ROLE_KEY` | Catalog DB — server-only, used by `sync-catalogo.js` and the webhook's retrieval |
| `ALLOWED_ORIGIN` | Comma-separated domains allowed to call `/chat` from the web widget (CORS) |

---

## Operational Limits

| Parameter | Value |
|-----------|-------|
| Max input length | 800 characters |
| Max response length | 4,096 characters |
| Conversation memory | 10 messages per user (in-process) |
| Message deduplication | 500 message IDs retained |
| Stale message threshold | 300 seconds |
| Claude max_tokens | 1,024 |
| Function timeout | 30 seconds |

---

## Current Status & Roadmap

### Operational today
- WhatsApp connected and responding via Claude Haiku 4.5
- Web chat widget (`/widget.js` + `/chat`) embeddable on bluefishing.cl, sharing the same sales brain (`lib/salesEngine.js`) and catalog as WhatsApp
- 208 products with prices and URLs across 6 categories, synced daily from WooCommerce
- `/admin` catalog training interface (Supabase-backed, per-user login) so the team can attach real specs — species, water type, technique, power, gear ratio — per product instead of the bot guessing from the name
- `/admin` test chat + corrections queue, with resolved corrections auto-injected into future replies as validated examples (human-checkpointed, no unsupervised self-editing)
- Consultative sales persona with prompt injection defenses + explicit "don't invent specs" guardrail
- Wholesale/reseller inquiries routed to a human instead of a product pitch
- Gemini fallback if Anthropic key is unavailable
- Deployed on Vercel as serverless functions

### Next milestones
- **Instagram DM support** — Meta Graph API integration (same `lib/salesEngine.js` pattern as WhatsApp/web)
- **Persistent memory** — Supabase for conversation history (currently in-process, lost on cold starts)
- **RAG with vector search** — Supabase pgvector + OpenAI embeddings when catalog exceeds context window
- **HMAC signature validation** — verify Meta webhook authenticity on POST requests
- **Analytics dashboard** — conversation tracking, response quality, conversion metrics

---

## Project Context

This is a production chatbot built for a real e-commerce operation — BlueFishing.cl, a Chilean fishing gear brand with 15,000+ SKUs in their full catalog. The current deployment covers 208 key products across the most active categories. The system handles real customer conversations on WhatsApp 24/7.

**Built by:** Cristóbal — Solution Engineer, MSc AI for Business (NCI, Dublin)

---

## License

This project is shared for portfolio and demonstration purposes. The system prompt and catalog data are proprietary to BlueFishing.cl.
