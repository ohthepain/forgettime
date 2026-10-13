#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tf-common.sh"
select_environment "${1:-}"
command -v aws >/dev/null
command -v jq >/dev/null
region="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw aws_region)"
cluster="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw database_setup_cluster)"
task_definition="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw database_setup_task_definition_arn)"
network="$(terraform -chdir="$FORGETTIME_TF_DIR" output -json database_setup_network_configuration)"
log_group="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw database_setup_log_group)"
result="$(aws ecs run-task --region "$region" --cluster "$cluster" \
  --task-definition "$task_definition" --launch-type FARGATE --platform-version 1.4.0 \
  --network-configuration "$network" --output json)"
if [[ "$(jq '.failures | length' <<< "$result")" != 0 ]]; then
  jq '.failures' <<< "$result" >&2
  exit 1
fi
task="$(jq -er '.tasks[0].taskArn' <<< "$result")"
printf 'Started database setup task: %s\n' "$task"
aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$task"
result="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task" --output json)"
if [[ "$(jq -r '.tasks[0].containers[0].exitCode // -1' <<< "$result")" != 0 ]]; then
  jq '.tasks[0] | {stopCode, stoppedReason, containers: [.containers[] | {name, reason, exitCode}]}' <<< "$result" >&2
  printf 'Inspect setup logs in CloudWatch: %s\n' "$log_group" >&2
  exit 1
fi
printf 'Tenant database verified. Logs: %s\n' "$log_group"
