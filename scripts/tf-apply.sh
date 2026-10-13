#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tf-common.sh"
select_environment "${1:-}"
plan="$FORGETTIME_TF_DIR/$FORGETTIME_ENV.tfplan"
if [[ ! -f "$plan" ]]; then
  echo "Run scripts/tf-plan.sh $FORGETTIME_ENV and review the plan first." >&2
  exit 1
fi
printf 'Apply the reviewed Forgettime %s plan? Type %s: ' "$FORGETTIME_ENV" "$FORGETTIME_ENV"
read -r confirmation
[[ "$confirmation" == "$FORGETTIME_ENV" ]] || { echo 'Cancelled.' >&2; exit 1; }
terraform -chdir="$FORGETTIME_TF_DIR" apply "$plan"
rm "$plan"
