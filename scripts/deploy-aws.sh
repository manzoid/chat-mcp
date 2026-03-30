#!/usr/bin/env bash
set -euo pipefail

# Deploy chat-mcp server to AWS ECS (same account/cluster as humand-sandbox)
#
# Prerequisites:
#   1. ECR repo "chat-mcp" exists in the account
#   2. ECS service "chat-mcp" exists on the "humand" cluster
#   3. AWS CLI configured with the correct profile
#
# Setup (one-time):
#   See scripts/setup-aws.sh to create the ECR repo and ECS service.

ACCOUNT=396181386568
REGION=ap-northeast-1
CLUSTER=humand
SERVICE=chat-mcp
PROFILE="${AWS_PROFILE:-${ACCOUNT}_AdministratorAccess}"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
REPO="${ECR}/${SERVICE}"

echo "→ ECR login"
aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
  | docker login --username AWS --password-stdin "$ECR"

echo "→ Building image"
docker build --platform linux/arm64 -t "${SERVICE}:latest" "$(dirname "$0")/.."

echo "→ Pushing to ECR"
docker tag "${SERVICE}:latest" "${REPO}:latest"
docker push "${REPO}:latest"

echo "→ Deploying to ECS"
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query 'service.deployments[0].rolloutState' \
  --output text

echo "✓ Deploy started. Watch with:"
echo "  aws ecs describe-services --cluster ${CLUSTER} --services ${SERVICE} --region ${REGION} --profile ${PROFILE} --query 'services[0].deployments[*].[status,runningCount,rolloutState]' --output table"
