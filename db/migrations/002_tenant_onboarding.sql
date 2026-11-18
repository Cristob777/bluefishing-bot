-- Onboarding autoservicio multi-tenant (una empresa = un tenant).
-- Idempotente. Ejecutar con: psql "$DATABASE_URL" -f db/migrations/002_tenant_onboarding.sql
create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table if not exists tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  role text not null default 'owner' check (role in ('owner')),
  session_version int not null default 1,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Una fila por tenant. Todos los *_enc son AES-256-GCM (lib/secretBox.js),
-- con la clave maestra CREDENTIALS_MASTER_KEY. Nunca guardar texto plano.
create table if not exists tenant_credentials (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  woo_store_url text,
  woo_key_id bigint,
  woo_consumer_key_enc text,
  woo_consumer_secret_enc text,
  woo_key_permissions text,
  woo_connected_at timestamptz,
  wa_mode text check (wa_mode in ('own_app','embedded_signup')),
  wa_phone_number_id text unique,
  wa_waba_id text,
  wa_display_phone text,
  wa_access_token_enc text,
  wa_app_secret_enc text,
  wa_registration_pin_enc text,
  wa_verify_token_hash text unique,
  wa_connected_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Estados de un solo uso para callbacks (WooCommerce user_id, Embedded Signup).
create table if not exists onboarding_states (
  state_hash text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('woo','meta_es')),
  store_url text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_states_expires_idx on onboarding_states(expires_at);
