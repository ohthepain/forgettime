provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "forgettime"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_partition" "current" {}

data "terraform_remote_state" "shared" {
  backend   = "s3"
  workspace = "default"
  config = {
    bucket = var.shared_state_bucket
    key    = var.shared_state_key
    region = var.aws_region
  }
}

locals {
  name_prefix          = "forgettime-${var.environment}"
  tenant_database_name = "forgettime_${var.environment}"
  ssm_prefix           = "/forgettime/${var.environment}"
  app_hostname         = trimprefix(var.app_origin, "https://")
  database_url         = "postgresql://${local.tenant_database_name}:${random_password.database.result}@${data.terraform_remote_state.shared.outputs.rds_endpoint}:${data.terraform_remote_state.shared.outputs.rds_port}/${local.tenant_database_name}?sslmode=require"
  app_secret_arns = concat([
    aws_ssm_parameter.database_url.arn,
    aws_ssm_parameter.better_auth_secret.arn,
  ], var.google_client_id_parameter_arn != "" ? [var.google_client_id_parameter_arn, var.google_client_secret_parameter_arn] : [])
  ecs_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# Preconditions block apply, unlike Terraform check blocks (which only warn).
resource "terraform_data" "configuration" {
  lifecycle {
    precondition {
      condition     = terraform.workspace == var.environment
      error_message = "Select the workspace matching var.environment before planning or applying."
    }
    precondition {
      condition     = (var.google_client_id_parameter_arn == "") == (var.google_client_secret_parameter_arn == "")
      error_message = "Configure both Google SSM parameter ARNs together."
    }
    precondition {
      condition     = !var.auth_require_email_verification || (var.ses_from_email != "" && var.ses_identity_arn != "")
      error_message = "Email verification requires a verified SES sender and identity ARN."
    }
  }
}
