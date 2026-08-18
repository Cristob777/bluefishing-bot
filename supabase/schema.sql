-- BlueFishing Bot — esquema de Supabase para el catálogo entrenable.
-- Correr una vez en el SQL Editor de Supabase (Project → SQL Editor → New query).
--
-- `products`            se llena SOLO por scripts/sync-catalogo.js (service role key),
--                        es el espejo de WooCommerce. El equipo nunca la edita a mano.
-- `product_attributes`  se llena por el equipo desde /admin (usuarios autenticados).
--                        Es el "cuestionario" — especie, agua, técnica, specs, etc.

create table if not exists public.products (
  url text primary key,
  name text not null,
  price text,
  category text,
  product_type text,
  brand text,
  updated_at timestamptz not null default now()
);

create table if not exists public.product_attributes (
  product_url text primary key references public.products(url) on delete cascade,
  target_species text[] not null default '{}',
  water_type text[] not null default '{}',
  fishing_position text[] not null default '{}',
  technique text[] not null default '{}',
  experience_level text,
  verified_notes text,
  -- specs propias de cada categoría (power, gear_ratio, lure_type, etc.),
  -- ver catalogo/schema-enriquecimiento.js → FIELDS_BY_PRODUCT_TYPE
  extra jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.product_attributes enable row level security;

-- Solo usuarios logueados (cuentas creadas a mano en Authentication → Users,
-- sin self-signup público) pueden leer o escribir. Nada es público.
drop policy if exists "authenticated read products" on public.products;
create policy "authenticated read products" on public.products
  for select to authenticated using (true);

drop policy if exists "authenticated read attributes" on public.product_attributes;
create policy "authenticated read attributes" on public.product_attributes
  for select to authenticated using (true);

drop policy if exists "authenticated insert attributes" on public.product_attributes;
create policy "authenticated insert attributes" on public.product_attributes
  for insert to authenticated with check (true);

drop policy if exists "authenticated update attributes" on public.product_attributes;
create policy "authenticated update attributes" on public.product_attributes
  for update to authenticated using (true) with check (true);

-- `products` solo se escribe con la service role key (bypassa RLS) desde
-- scripts/sync-catalogo.js — no se define policy de insert/update para
-- `authenticated` a propósito, así nadie desde /admin puede alterar el
-- espejo de WooCommerce, solo sus atributos de entrenamiento.

-- `chat_feedback` — correcciones que el equipo carga desde la pestaña
-- "Chat de prueba" de /admin cuando el bot responde algo incorrecto.
-- No entrena al bot automáticamente (no hay fine-tuning ni RAG de esto
-- todavía) — es una cola de revisión: el equipo la usa para decidir qué
-- producto entrenar en product_attributes o qué ajustar en el prompt.
create table if not exists public.chat_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_message text not null,
  bot_response text not null,
  correction text,
  -- snapshot de intent/contexto clasificado y productos mostrados en ese
  -- turno, para poder diagnosticar la causa sin tener que reproducir la
  -- conversación
  debug_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'flagged', -- 'flagged' | 'resolved'
  flagged_by text,
  resolved_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.chat_feedback enable row level security;

drop policy if exists "authenticated read feedback" on public.chat_feedback;
create policy "authenticated read feedback" on public.chat_feedback
  for select to authenticated using (true);

drop policy if exists "authenticated insert feedback" on public.chat_feedback;
create policy "authenticated insert feedback" on public.chat_feedback
  for insert to authenticated with check (true);

drop policy if exists "authenticated update feedback" on public.chat_feedback;
create policy "authenticated update feedback" on public.chat_feedback
  for update to authenticated using (true) with check (true);
