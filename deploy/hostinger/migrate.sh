#!/usr/bin/env bash
# shellcheck disable=SC2016  # $POSTGRES_* se expanden dentro del contenedor, a propósito
# Aplica db/schema.sql + db/migrations/*.sql una sola vez cada una, registrándolas en
# schema_migrations. Seguro de repetir: lo ya aplicado se salta, y cada migración
# es además idempotente (IF NOT EXISTS) por si la base vino de docker-entrypoint-initdb.d.
# Uso (desde la raíz del repo): deploy/hostinger/migrate.sh
set -euo pipefail
ENV_FILE="${ENV_FILE:-.env.production}"
DC=(docker compose --env-file "$ENV_FILE")
psql_db() { "${DC[@]}" exec -T db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" '"$*"; }

psql_db <<'SQL'
create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
SQL

apply() {
  local version="$1" file="$2"
  if [[ "$(psql_db -Atc "\"select 1 from schema_migrations where version = '$version'\"")" == "1" ]]; then
    echo "skip  $version (ya aplicada)"
    return
  fi
  echo "apply $version"
  { echo "begin;"; cat "$file"; printf "\ninsert into schema_migrations(version) values ('%s') on conflict do nothing;\ncommit;\n" "$version"; } \
    | psql_db
}

apply "001_schema" db/schema.sql
for migration in db/migrations/*.sql; do
  [[ -f "$migration" ]] || continue
  apply "$(basename "$migration" .sql)" "$migration"
done
echo "Migraciones al día."
