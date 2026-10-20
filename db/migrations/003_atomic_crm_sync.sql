-- Atomic CRM sync: mapa idempotente entre filas del bot y filas en Atomic CRM (Supabase).
-- Idempotente. Instalaciones existentes: psql "$DATABASE_URL" -f db/migrations/003_atomic_crm_sync.sql
create table if not exists atomic_crm_sync (
  entity text not null check (entity in ('contact','deal','handoff_note')),
  source_id text not null,
  target_id bigint not null,
  payload_hash text,
  synced_at timestamptz not null default now(),
  primary key (entity, source_id)
);
create index if not exists atomic_crm_sync_synced_idx on atomic_crm_sync(synced_at desc);
