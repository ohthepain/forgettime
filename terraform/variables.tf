variable "environment" {
  description = "Must equal the selected Terraform workspace."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Use staging or production."
  }
}

variable "aws_region" {
  type    = string
  default = "eu-central-1"
}

variable "shared_state_bucket" {
  description = "Existing shared-aws state bucket. This stack never creates shared resources."
  type        = string
}

variable "shared_state_key" {
  type    = string
  default = "shared/terraform.tfstate"
}

variable "app_origin" {
  description = "Public HTTPS origin, without a trailing slash, used for routing and Better Auth."
  type        = string
  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.app_origin))
    error_message = "Provide an HTTPS origin containing only the hostname (no path or trailing slash)."
  }
}

variable "alb_certificate_arn" {
  description = "Existing ACM certificate covering app_origin in aws_region."
  type        = string
}

variable "attach_alb_certificate" {
  description = "False when this exact certificate is already owned/attached by shared-aws or another tenant state."
  type        = bool
  default     = true
}

variable "alb_listener_rule_priority" {
  description = "An unused priority on the shared HTTPS listener; coordinate with shared-aws before applying."
  type        = number
  validation {
    condition     = var.alb_listener_rule_priority >= 1 && var.alb_listener_rule_priority <= 50000 && floor(var.alb_listener_rule_priority) == var.alb_listener_rule_priority
    error_message = "Listener priority must be an integer from 1 through 50000."
  }
}

variable "ecs_desired_count" {
  description = "Start at 0 until the tenant database and image exist, then set to 1."
  type        = number
  default     = 1
}

variable "ecs_cpu" {
  type    = number
  default = 256
}

variable "ecs_memory" {
  type    = number
  default = 512
}

variable "google_client_id_parameter_arn" {
  description = "Optional existing project-specific SSM SecureString ARN. Set both Google parameters together."
  type        = string
  default     = ""
}

variable "google_client_secret_parameter_arn" {
  description = "Optional existing project-specific SSM SecureString ARN; value never enters Terraform state."
  type        = string
  default     = ""
}

variable "ses_from_email" {
  description = "Optional sender on an already verified SES identity. Required when verification is enabled."
  type        = string
  default     = ""
}

variable "ses_identity_arn" {
  description = "Optional verified SES identity ARN that the application may use to send authentication emails."
  type        = string
  default     = ""
}

variable "auth_require_email_verification" {
  type    = bool
  default = false
}
