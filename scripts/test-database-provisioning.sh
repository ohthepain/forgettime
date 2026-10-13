#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
# No published port or persistent volume; only this created container is removed.
container="$(docker run --rm -d --tmpfs /var/lib/postgresql:rw,size=512m \
  -e POSTGRES_PASSWORD=local-test-admin \
  -e POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256 --auth-local=trust" \
  --mount "type=bind,src=$project_root/terraform/provision-database.sh,dst=/provision-database.sh,readonly" \
  postgres:18-alpine)"
trap 'docker rm -f "$container" >/dev/null' EXIT
ready=false
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Temporary PostgreSQL did not become ready.' >&2; exit 1; }
admin_sql() { docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"; }
# A non-superuser CREATEDB/CREATEROLE admin exercises PostgreSQL 18 ownership rules.
admin_sql "CREATE ROLE provision_admin LOGIN CREATEDB CREATEROLE PASSWORD 'local-provision-admin';"
provision() {
  docker exec -e PGHOST=127.0.0.1 -e PGUSER=provision_admin -e PGPASSWORD=local-provision-admin \
    -e PGSSLMODE=disable -e TENANT_DATABASE=forgettime_staging -e "TENANT_PASSWORD=$1" \
    "$container" sh /provision-database.sh
}
tenant_sql() {
  docker exec -e PGPASSWORD=local-tenant-password "$container" \
    psql -X -h 127.0.0.1 -U forgettime_staging -d forgettime_staging -v ON_ERROR_STOP=1 -Atc "$1"
}
provision local-tenant-password
tenant_sql "CREATE TABLE preserved_marker (value integer); INSERT INTO preserved_marker VALUES (42);"
provision local-tenant-password
[[ "$(tenant_sql 'SELECT value FROM preserved_marker;')" == 42 ]]
if provision incorrect-password; then
  echo 'Expected existing password mismatch to fail.' >&2
  exit 1
fi
[[ "$(tenant_sql 'SELECT value FROM preserved_marker;')" == 42 ]]
admin_sql 'ALTER DATABASE forgettime_staging OWNER TO postgres;'
if provision local-tenant-password; then
  echo 'Expected existing owner mismatch to fail.' >&2
  exit 1
fi
[[ "$(tenant_sql 'SELECT value FROM preserved_marker;')" == 42 ]]
echo 'PASS: fresh provision, existing data preserved, wrong password refused, wrong owner refused.'
