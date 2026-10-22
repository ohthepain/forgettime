#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tf-common.sh"
select_environment "${1:-}"
mode="${2:-}"
if [[ -n "$mode" && "$mode" != '--push-only' ]]; then
  echo 'Usage: scripts/deploy.sh <staging|production> [--push-only]' >&2
  exit 2
fi
command -v aws >/dev/null
command -v docker >/dev/null
command -v jq >/dev/null
if [[ -n "$(git -C "$FORGETTIME_ROOT" status --porcelain)" ]]; then
  echo "Commit source changes before deploying so the image SHA tag identifies the deployed source." >&2
  git -C "$FORGETTIME_ROOT" status --short >&2
  exit 1
fi
region="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw aws_region)"
repository="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw ecr_repository_url)"
revision="$(git -C "$FORGETTIME_ROOT" rev-parse HEAD)"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "${repository%%/*}"
# Environment tag matches the Terraform task; SHA tag retains an explicit rollback target.
docker buildx build --platform linux/arm64 --push \
  -t "$repository:$revision" -t "$repository:$FORGETTIME_ENV" "$FORGETTIME_ROOT"
if [[ "$mode" == '--push-only' ]]; then
  echo 'Image pushed. Set ecs_desired_count=1 in the environment tfvars, then review/apply a new Terraform plan.'
  exit 0
fi
cluster="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw ecs_cluster_name)"
service="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw ecs_service_name)"
count="$(aws ecs describe-services --region "$region" --cluster "$cluster" --services "$service" --query 'services[0].desiredCount' --output text)"
if [[ "$count" == 0 || "$count" == None ]]; then
  echo 'Service is not activated. Set ecs_desired_count=1 and review/apply Terraform before deploying.' >&2
  exit 1
fi
deployment="$(aws ecs update-service --region "$region" --cluster "$cluster" --service "$service" --force-new-deployment --query 'service.deployments[?status==`PRIMARY`].id | [0]' --output text)"
aws ecs wait services-stable --region "$region" --cluster "$cluster" --services "$service"
# A rollback can also look stable; ensure this specific deployment completed.
result="$(aws ecs describe-services --region "$region" --cluster "$cluster" --services "$service" --output json)"
if ! jq -e --arg id "$deployment" '.services[0].deployments[] | select(.id == $id and .status == "PRIMARY" and .rolloutState == "COMPLETED")' <<< "$result" >/dev/null; then
  echo 'Deployment did not complete successfully; inspect ECS events before retrying.' >&2
  exit 1
fi
origin="$(terraform -chdir="$FORGETTIME_TF_DIR" output -raw app_url)"
curl --fail --silent --show-error --retry 3 "$origin/api/healthz"
printf '\nDeployed %s to %s\n' "$revision" "$origin"
