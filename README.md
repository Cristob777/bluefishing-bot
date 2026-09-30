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
- fishing-product recommendations;
- product catalog retrieval;
- structured product knowledge;
- conversational context;
- human handoff;
- usage and sales telemetry;
- owner-facing dashboard.

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
