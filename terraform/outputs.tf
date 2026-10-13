output "ecr_repository_url" { value = aws_ecr_repository.app.repository_url }
output "ecs_cluster_name" { value = aws_ecs_cluster.app.name }
output "ecs_service_name" { value = aws_ecs_service.app.name }
output "app_url" { value = var.app_origin }
output "aws_region" { value = var.aws_region }
output "shared_alb_dns_name" { value = data.terraform_remote_state.shared.outputs.alb_dns_name }
output "tenant_database_name" { value = local.tenant_database_name }
output "database_url_parameter_name" { value = aws_ssm_parameter.database_url.name }
output "database_setup_task_definition_arn" { value = aws_ecs_task_definition.database_setup.arn }
output "database_setup_cluster" { value = data.terraform_remote_state.shared.outputs.ops_cluster_name }
output "database_setup_log_group" { value = aws_cloudwatch_log_group.database_setup.name }
output "database_setup_network_configuration" {
  value = {
    awsvpcConfiguration = {
      subnets        = data.terraform_remote_state.shared.outputs.public_subnet_ids
      securityGroups = [data.terraform_remote_state.shared.outputs.ops_security_group_id]
      assignPublicIp = "ENABLED"
    }
  }
}
