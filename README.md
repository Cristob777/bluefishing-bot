# BlueFishing Bot — AI Customer Service for WhatsApp

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
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Customer    │     │  Meta WhatsApp   │     │  Vercel         │
│  WhatsApp    │────▶│  Cloud API       │────▶│  Serverless     │
│              │     │  (webhook)       │     │  api/webhook.js │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │  Load catalog   │
                                              │  (208 products) │
                                              └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │  Claude Haiku   │
                                              │  4.5            │
                                              │  (system prompt │
                                              │  + catalog +    │
                                              │  last 10 msgs)  │
                                              └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │  Send response  │
                                              │  via WhatsApp   │
                                              │  Cloud API      │
                                              └─────────────────┘
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

The product catalog is built from a WooCommerce export:

```
WooCommerce CSV export → build-catalogo.js → catalogo_para_bot.txt
```

- **Input:** `wc-product-export.csv` (WooCommerce product export)
- **Transform:** `scripts/build-catalogo.js` extracts name, price, categories, and generates product URLs via slugification
- **Output:** `catalogo/catalogo_para_bot.txt` — 208 products across 6 categories
- **Categories covered:** Cañas, Carretes, Líneas, Combos, Señuelos, + brand-specific categories

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 18+ (Vercel Serverless Functions) |
| AI (primary) | Claude Haiku 4.5 via `@anthropic-ai/sdk` |
| AI (fallback) | Gemini 2.0 Flash via `@google/generative-ai` |
| Messaging | Meta WhatsApp Cloud API v18.0 |
| Catalog source | WooCommerce CSV → text pipeline |
| Deployment | Vercel (serverless, single function) |
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
- 208 products with prices and URLs across 6 categories
- Consultative sales persona with prompt injection defenses
- Gemini fallback if Anthropic key is unavailable
- Deployed on Vercel as a single serverless function

### Next milestones
- **Instagram DM support** — Meta Graph API integration (same webhook pattern)
- **Persistent memory** — Supabase for conversation history (currently in-process, lost on cold starts)
- **RAG with vector search** — Supabase pgvector + OpenAI embeddings when catalog exceeds context window
- **Catalog enrichment** — Claude Batch API to add structured fields (target species, fishing type, experience level) per product
- **HMAC signature validation** — verify Meta webhook authenticity on POST requests
- **Analytics dashboard** — conversation tracking, response quality, conversion metrics

---

## Project Context

This is a production chatbot built for a real e-commerce operation — BlueFishing.cl, a Chilean fishing gear brand with 15,000+ SKUs in their full catalog. The current deployment covers 208 key products across the most active categories. The system handles real customer conversations on WhatsApp 24/7.

**Built by:** Cristóbal — Data Engineer & BI Developer, MSc AI for Business (NCI, Dublin)

---

## License

This project is shared for portfolio and demonstration purposes. The system prompt and catalog data are proprietary to BlueFishing.cl.
