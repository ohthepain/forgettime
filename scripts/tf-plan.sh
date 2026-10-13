#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tf-common.sh"
select_environment "${1:-}"
if [[ ! -f "$FORGETTIME_TF_DIR/environments/$FORGETTIME_ENV/terraform.tfvars" ]]; then
  echo 'Configure the environment terraform.tfvars from its .example file first.' >&2
  exit 1
fi
# Plan files contain sensitive values. Restrict permissions and keep them ignored.
umask 077
terraform -chdir="$FORGETTIME_TF_DIR" plan \
  -var-file="environments/$FORGETTIME_ENV/terraform.tfvars" \
  -out="$FORGETTIME_ENV.tfplan"
