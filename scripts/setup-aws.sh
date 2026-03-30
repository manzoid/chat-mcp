#!/usr/bin/env bash
set -euo pipefail

# One-time setup: create ECR repo and ECS service for chat-mcp
# on the existing humand cluster.
#
# This reuses: VPC, subnets, ECS cluster, EFS filesystem from humand-sandbox.
# It creates: ECR repo, ALB, target group, security groups, EFS access point,
#             ECS task definition, and ECS service.
#
# After running this, use deploy-aws.sh to push images.

ACCOUNT=396181386568
REGION=ap-northeast-1
CLUSTER=humand
PROFILE="${AWS_PROFILE:-${ACCOUNT}_AdministratorAccess}"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

AWS="aws --region $REGION --profile $PROFILE"

# --- Discover existing resources from humand stack ---
echo "→ Discovering existing infrastructure..."

VPC_ID=$($AWS ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
echo "  VPC: ${VPC_ID}"

SUBNET_IDS=$($AWS ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" --query 'Subnets[*].SubnetId' --output text)
echo "  Subnets: ${SUBNET_IDS}"

# Get the existing EFS filesystem (used by humand)
EFS_ID=$($AWS efs describe-file-systems --query "FileSystems[?Name=='humand-data'].FileSystemId" --output text)
echo "  EFS: ${EFS_ID}"

# Get humand ALB security group (to reference its pattern)
HUMAND_ALB_SG=$($AWS ec2 describe-security-groups --filters Name=group-name,Values=humand-alb --query 'SecurityGroups[0].GroupId' --output text)
echo "  Humand ALB SG: ${HUMAND_ALB_SG}"

# ECS execution role ARN (reuse humand's)
EXEC_ROLE_ARN=$($AWS iam get-role --role-name humand-ecs-execution --query 'Role.Arn' --output text)
TASK_ROLE_ARN=$($AWS iam get-role --role-name humand-ecs-task --query 'Role.Arn' --output text)
echo "  Execution role: ${EXEC_ROLE_ARN}"
echo "  Task role: ${TASK_ROLE_ARN}"

# --- 1. ECR Repository ---
echo ""
echo "→ Creating ECR repository..."
$AWS ecr describe-repositories --repository-names chat-mcp 2>/dev/null || \
  $AWS ecr create-repository --repository-name chat-mcp --image-scanning-configuration scanOnPush=true
echo "  ECR: ${ECR}/chat-mcp"

# --- 2. Security Groups ---
echo ""
echo "→ Creating security groups..."

# ALB security group
ALB_SG=$($AWS ec2 describe-security-groups --filters Name=group-name,Values=chat-mcp-alb --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [ "$ALB_SG" = "None" ] || [ -z "$ALB_SG" ]; then
  ALB_SG=$($AWS ec2 create-security-group --group-name chat-mcp-alb --description "chat-mcp ALB" --vpc-id "$VPC_ID" --query 'GroupId' --output text)
  $AWS ec2 authorize-security-group-ingress --group-id "$ALB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0
fi
echo "  ALB SG: ${ALB_SG}"

# App security group
APP_SG=$($AWS ec2 describe-security-groups --filters Name=group-name,Values=chat-mcp-app --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [ "$APP_SG" = "None" ] || [ -z "$APP_SG" ]; then
  APP_SG=$($AWS ec2 create-security-group --group-name chat-mcp-app --description "chat-mcp app" --vpc-id "$VPC_ID" --query 'GroupId' --output text)
  # Allow all ports from ALB (bridge networking uses dynamic host ports)
  $AWS ec2 authorize-security-group-ingress --group-id "$APP_SG" --protocol tcp --port 0-65535 --source-group "$ALB_SG"
fi
echo "  App SG: ${APP_SG}"

# Allow chat-mcp ALB to reach the ECS instance (which uses humand-app SG)
HUMAND_APP_SG=$($AWS ec2 describe-security-groups --filters Name=group-name,Values=humand-app --query 'SecurityGroups[0].GroupId' --output text)
echo "  Adding chat-mcp ALB to humand-app SG ingress..."
$AWS ec2 authorize-security-group-ingress --group-id "$HUMAND_APP_SG" --protocol tcp --port 0-65535 --source-group "$ALB_SG" 2>/dev/null || echo "  (already exists)"

# Allow app to reach EFS (add ingress to humand-efs SG)
EFS_SG=$($AWS ec2 describe-security-groups --filters Name=group-name,Values=humand-efs --query 'SecurityGroups[0].GroupId' --output text)
echo "  Adding chat-mcp-app to EFS SG ingress..."
$AWS ec2 authorize-security-group-ingress --group-id "$EFS_SG" --protocol tcp --port 2049 --source-group "$APP_SG" 2>/dev/null || echo "  (already exists)"

# --- 3. EFS Access Point (separate from humand's) ---
echo ""
echo "→ Creating EFS access point..."
AP_ID=$($AWS efs describe-access-points --file-system-id "$EFS_ID" --query "AccessPoints[?RootDirectory.Path=='/chat-mcp-data'].AccessPointId" --output text)
if [ -z "$AP_ID" ] || [ "$AP_ID" = "None" ]; then
  AP_ID=$($AWS efs create-access-point \
    --file-system-id "$EFS_ID" \
    --posix-user Uid=1001,Gid=1001 \
    --root-directory "Path=/chat-mcp-data,CreationInfo={OwnerUid=1001,OwnerGid=1001,Permissions=755}" \
    --query 'AccessPointId' --output text)
fi
echo "  Access Point: ${AP_ID}"

# --- 4. ALB + Target Group ---
echo ""
echo "→ Creating ALB..."
ALB_ARN=$($AWS elbv2 describe-load-balancers --names chat-mcp --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
if [ "$ALB_ARN" = "None" ] || [ -z "$ALB_ARN" ]; then
  SUBNET_ARGS=""
  for s in $SUBNET_IDS; do SUBNET_ARGS="$SUBNET_ARGS $s"; done
  ALB_ARN=$($AWS elbv2 create-load-balancer \
    --name chat-mcp \
    --subnets $SUBNET_ARGS \
    --security-groups "$ALB_SG" \
    --scheme internet-facing \
    --type application \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
fi

ALB_DNS=$($AWS elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].DNSName' --output text)
echo "  ALB: ${ALB_DNS}"

# Target group
TG_ARN=$($AWS elbv2 describe-target-groups --names chat-mcp --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
if [ "$TG_ARN" = "None" ] || [ -z "$TG_ARN" ]; then
  TG_ARN=$($AWS elbv2 create-target-group \
    --name chat-mcp \
    --protocol HTTP \
    --port 8808 \
    --vpc-id "$VPC_ID" \
    --target-type instance \
    --health-check-path /health \
    --health-check-interval-seconds 10 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --health-check-timeout-seconds 5 \
    --matcher HttpCode=200 \
    --query 'TargetGroups[0].TargetGroupArn' --output text)
  # Set short deregistration delay
  $AWS elbv2 modify-target-group-attributes --target-group-arn "$TG_ARN" \
    --attributes Key=deregistration_delay.timeout_seconds,Value=10
fi
echo "  Target Group: ${TG_ARN}"

# HTTP listener
LISTENER_ARN=$($AWS elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[0].ListenerArn' --output text 2>/dev/null || true)
if [ "$LISTENER_ARN" = "None" ] || [ -z "$LISTENER_ARN" ]; then
  $AWS elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=forward,TargetGroupArn="$TG_ARN"
fi
echo "  Listener: HTTP:80 → :8808"

# --- 5. SSM Parameter for SUPER_ADMIN_KEY ---
echo ""
echo "→ Setting up SSM parameter..."
$AWS ssm put-parameter \
  --name /chat-mcp/super-admin-key \
  --type SecureString \
  --value "${SUPER_ADMIN_KEY:-placeholder}" \
  --overwrite \
  --query 'Version' --output text
echo "  /chat-mcp/super-admin-key stored (update with your real key if placeholder)"

# Grant execution role permission to read /chat-mcp/* SSM params
echo "  Adding SSM read permission for /chat-mcp/* to execution role..."
$AWS iam put-role-policy \
  --role-name humand-ecs-execution \
  --policy-name chat-mcp-ssm-read \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"ssm:GetParameters\", \"ssm:GetParameter\"],
      \"Resource\": \"arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/chat-mcp/*\"
    }]
  }"

# --- 6. CloudWatch Log Group ---
echo ""
echo "→ Creating log group..."
$AWS logs create-log-group --log-group-name /ecs/chat-mcp 2>/dev/null || echo "  (already exists)"

# --- 7. ECS Task Definition ---
echo ""
echo "→ Registering task definition..."
cat > /tmp/chat-mcp-task.json <<TASK
{
  "family": "chat-mcp",
  "networkMode": "bridge",
  "executionRoleArn": "${EXEC_ROLE_ARN}",
  "taskRoleArn": "${TASK_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "chat-mcp",
      "image": "${ECR}/chat-mcp:latest",
      "memory": 512,
      "portMappings": [{ "containerPort": 8808, "hostPort": 0, "protocol": "tcp" }],
      "environment": [
        { "name": "PORT", "value": "8808" },
        { "name": "DB_PATH", "value": "/data/chat.db" },
        { "name": "ATTACHMENT_PATH", "value": "/data/attachments" }
      ],
      "secrets": [
        { "name": "SUPER_ADMIN_KEY", "valueFrom": "arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/chat-mcp/super-admin-key" }
      ],
      "mountPoints": [
        { "sourceVolume": "chat-mcp-data", "containerPath": "/data" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/chat-mcp",
          "awslogs-region": "${REGION}",
          "awslogs-stream-prefix": "chat-mcp"
        }
      },
      "essential": true
    }
  ],
  "volumes": [
    {
      "name": "chat-mcp-data",
      "efsVolumeConfiguration": {
        "fileSystemId": "${EFS_ID}",
        "transitEncryption": "ENABLED",
        "authorizationConfig": { "accessPointId": "${AP_ID}", "iam": "ENABLED" }
      }
    }
  ]
}
TASK

$AWS ecs register-task-definition --cli-input-json file:///tmp/chat-mcp-task.json --query 'taskDefinition.taskDefinitionArn' --output text
rm /tmp/chat-mcp-task.json

# --- 8. ECS Service ---
echo ""
echo "→ Creating ECS service..."
SERVICE_STATUS=$($AWS ecs describe-services --cluster "$CLUSTER" --services chat-mcp --query 'services[?status==`ACTIVE`].serviceName' --output text 2>/dev/null || true)
if [ -z "$SERVICE_STATUS" ]; then
  $AWS ecs create-service \
    --cluster "$CLUSTER" \
    --service-name chat-mcp \
    --task-definition chat-mcp \
    --desired-count 1 \
    --launch-type EC2 \
    --load-balancers "targetGroupArn=${TG_ARN},containerName=chat-mcp,containerPort=8808" \
    --enable-execute-command \
    --query 'service.serviceName' --output text
else
  echo "  (service already exists, forcing new deployment)"
  $AWS ecs update-service --cluster "$CLUSTER" --service chat-mcp --force-new-deployment \
    --query 'service.deployments[0].rolloutState' --output text
fi

echo ""
echo "============================================"
echo "  chat-mcp server URL: http://${ALB_DNS}"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Update /chat-mcp/super-admin-key in SSM with your real SSH public key"
echo "  2. Push an image:  ./scripts/deploy-aws.sh"
echo "  3. Point clients at http://${ALB_DNS}"
