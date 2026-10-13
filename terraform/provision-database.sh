#!/bin/sh
set -eu
# psql reads the secret directly from the container environment; never echo it.
# Existing roles/passwords/databases are deliberately preserved.
psql -X -v ON_ERROR_STOP=1 -d postgres <<'SQL'
\getenv tenant TENANT_DATABASE
\getenv tenant_password TENANT_PASSWORD
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'tenant', :'tenant_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'tenant')
\gexec
-- PostgreSQL 16+ requires SET membership to create a database owned by another role.
SELECT format('GRANT %I TO %I WITH SET TRUE', :'tenant', current_user)
WHERE NOT pg_has_role(current_user, :'tenant', 'SET')
\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'tenant', :'tenant')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'tenant')
\gexec
SELECT pg_get_userbyid(datdba) = :'tenant' AS owner_matches
FROM pg_database WHERE datname = :'tenant'
\gset
\if :owner_matches
\else
  \echo 'Existing database has a different owner; refusing to alter it.'
  -- ON_ERROR_STOP makes this an actual non-zero exit; psql \quit has no status argument.
  SELECT 1 / 0 AS incompatible_existing_database;
\endif
SQL
# Confirm the generated application credentials work even if the role existed.
PGUSER="$TENANT_DATABASE" PGPASSWORD="$TENANT_PASSWORD" \
  psql -X -v ON_ERROR_STOP=1 -d "$TENANT_DATABASE" -c 'SELECT 1 AS connection_verified;'
echo 'Tenant database is ready; existing data was preserved.'
