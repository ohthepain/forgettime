#!/usr/bin/env bash
# Sourced by the project helpers, never prints secret Terraform outputs.
set -euo pipefail
FORGETTIME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGETTIME_TF_DIR="$FORGETTIME_ROOT/terraform"
require_environment() {
  case "${1:-}" in staging|production) ;; *) echo 'Expected environment: staging or production.' >&2; exit 2 ;; esac
  FORGETTIME_ENV="$1"
}
select_environment() {
  require_environment "$1"
  terraform -chdir="$FORGETTIME_TF_DIR" workspace select "$FORGETTIME_ENV" >/dev/null
}
