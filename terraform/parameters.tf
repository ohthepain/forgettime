resource "random_password" "database" {
  length  = 40
  special = false
}

resource "random_password" "better_auth_secret" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "database_url" {
  name  = "${local.ssm_prefix}/DATABASE_URL"
  type  = "SecureString"
  value = local.database_url
}

# Used only by the one-shot provisioning task, never by the app task.
resource "aws_ssm_parameter" "database_password" {
  name  = "${local.ssm_prefix}/DATABASE_PASSWORD"
  type  = "SecureString"
  value = random_password.database.result
}

resource "aws_ssm_parameter" "better_auth_secret" {
  name  = "${local.ssm_prefix}/BETTER_AUTH_SECRET"
  type  = "SecureString"
  value = random_password.better_auth_secret.result
}
