#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tf-common.sh"
require_environment "${1:-}"
if [[ ! -f "$FORGETTIME_TF_DIR/backend.hcl" ]]; then
  echo 'Copy terraform/backend.hcl.example to backend.hcl and configure existing state storage first.' >&2
  exit 1
fi
terraform -chdir="$FORGETTIME_TF_DIR" init -backend-config=backend.hcl
if ! terraform -chdir="$FORGETTIME_TF_DIR" workspace select "$FORGETTIME_ENV"; then
  terraform -chdir="$FORGETTIME_TF_DIR" workspace new "$FORGETTIME_ENV"
fi
