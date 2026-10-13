#!/bin/sh
set -eu
# Shared RDS is private. Run migrations inside the VPC before the HTTP server starts.
pnpm db:migrate:deploy
exec "$@"
