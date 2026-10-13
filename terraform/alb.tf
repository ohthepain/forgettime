resource "aws_security_group" "app" {
  name        = "${local.name_prefix}-app"
  description = "Forgettime app tasks in the shared VPC"
  vpc_id      = data.terraform_remote_state.shared.outputs.vpc_id
  ingress {
    description     = "HTTP from the shared ALB only"
    protocol        = "tcp"
    from_port       = 3000
    to_port         = 3000
    security_groups = [data.terraform_remote_state.shared.outputs.alb_security_group_id]
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb_target_group" "app" {
  name                 = "${local.name_prefix}-tg"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = data.terraform_remote_state.shared.outputs.vpc_id
  deregistration_delay = 30
  health_check {
    path                = "/api/healthz"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }
}

resource "aws_lb_listener_rule" "app" {
  listener_arn = data.terraform_remote_state.shared.outputs.https_listener_arn
  priority     = var.alb_listener_rule_priority
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
  condition {
    host_header { values = [local.app_hostname] }
  }
  depends_on = [terraform_data.configuration]
}

resource "aws_lb_listener_certificate" "app" {
  count           = var.attach_alb_certificate ? 1 : 0
  listener_arn    = data.terraform_remote_state.shared.outputs.https_listener_arn
  certificate_arn = var.alb_certificate_arn
}
