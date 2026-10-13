# This consumes the shared ops cluster and network without owning them.
# The task runs only when scripts/deploy-provision-db.sh is explicitly invoked.
resource "aws_cloudwatch_log_group" "database_setup" {
  name              = "/ecs/${local.name_prefix}-database-setup"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "database_setup" {
  family                   = "${local.name_prefix}-database-setup"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.database_setup_execution.arn
  container_definitions = jsonencode([{
    name      = "postgres"
    image     = "postgres:18-alpine"
    essential = true
    command   = ["sh", "-ec", file("${path.module}/provision-database.sh")]
    environment = [
      { name = "PGHOST", value = data.terraform_remote_state.shared.outputs.rds_endpoint },
      { name = "PGPORT", value = tostring(data.terraform_remote_state.shared.outputs.rds_port) },
      { name = "PGSSLMODE", value = "require" },
      { name = "TENANT_DATABASE", value = local.tenant_database_name },
    ]
    secrets = [
      { name = "PGUSER", valueFrom = "${data.terraform_remote_state.shared.outputs.rds_master_secret_arn}:username::" },
      { name = "PGPASSWORD", valueFrom = "${data.terraform_remote_state.shared.outputs.rds_master_secret_arn}:password::" },
      { name = "TENANT_PASSWORD", valueFrom = aws_ssm_parameter.database_password.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.database_setup.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "setup"
      }
    }
  }])
}
