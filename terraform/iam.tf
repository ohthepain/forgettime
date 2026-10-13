resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name_prefix}-execution"
  assume_role_policy = local.ecs_assume_role_policy
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_secrets" {
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters"]
      Resource = local.app_secret_arns
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-task"
  assume_role_policy = local.ecs_assume_role_policy
}

resource "aws_iam_role_policy" "ses" {
  count = var.ses_identity_arn != "" ? 1 : 0
  role  = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = var.ses_identity_arn
      Condition = {
        StringEquals = { "ses:FromAddress" = var.ses_from_email }
      }
    }]
  })
}

# Master credentials are accessible only to this separate provisioning role.
resource "aws_iam_role" "database_setup_execution" {
  name               = "${local.name_prefix}-db-setup"
  assume_role_policy = local.ecs_assume_role_policy
}

resource "aws_iam_role_policy_attachment" "database_setup_execution" {
  role       = aws_iam_role.database_setup_execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "database_setup_secrets" {
  role = aws_iam_role.database_setup_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = data.terraform_remote_state.shared.outputs.rds_master_secret_arn
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameters"]
        Resource = aws_ssm_parameter.database_password.arn
      }
    ]
  })
}
