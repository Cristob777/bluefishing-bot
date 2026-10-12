-- CRM PR1: persistencia de contactos, conversaciones y mensajes del bot.
-- Aplicar MANUALMENTE en Supabase (SQL Editor). Idempotente.
-- Escritura: solo service role (el bot, que bypassa RLS).
-- Lectura: usuarios autenticados del equipo (/admin). Anónimos: sin acceso.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'web', 'instagram')),
  external_id text not null,
  name text,
  phone text,
  stage text not null default 'nuevo'
    check (stage in ('nuevo', 'interesado', 'cotizado', 'compro', 'perdido')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (channel, external_id)
);
create index if not exists contacts_last_seen_idx on public.contacts (last_seen_at desc);
create index if not exists contacts_stage_idx on public.contacts (stage);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null,
  status text not null default 'bot' check (status in ('bot', 'human', 'closed')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists conversations_contact_idx on public.conversations (contact_id, last_message_at desc);
create index if not exists conversations_last_msg_idx on public.conversations (last_message_at desc);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  role text not null check (role in ('user', 'bot', 'human')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "team read contacts" on public.contacts;
create policy "team read contacts" on public.contacts for select to authenticated using (true);
drop policy if exists "team read conversations" on public.conversations;
create policy "team read conversations" on public.conversations for select to authenticated using (true);
drop policy if exists "team read messages" on public.messages;
create policy "team read messages" on public.messages for select to authenticated using (true);
