#!/usr/bin/env bash
# Scale production ECS back up and recycle tasks.
set -euo pipefail

REGION="${AWS_REGION:-eu-central-1}"
PROJECT="${FORGETTIME_PROJECT_NAME:-forgettime}"
ENV=production
DESIRED="${ECS_DESIRED_COUNT:-1}"

CLUSTER="${PROJECT}-${ENV}-cluster"
SERVICE="${PROJECT}-${ENV}-service"

echo "Scaling ECS service ${SERVICE} to desired count ${DESIRED}..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --desired-count "$DESIRED" \
  --force-new-deployment \
  --region "$REGION" \
  --output text --query 'service.{desired:desiredCount,running:runningCount,status:status}'

echo "Done. Shared RDS is not started or stopped (shared-aws owns it)."
