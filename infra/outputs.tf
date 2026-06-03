output "media_bucket"            { value = aws_s3_bucket.media.bucket }
output "rds_endpoint"            { value = aws_db_instance.postgres.endpoint }
output "cognito_user_pool_id"    { value = aws_cognito_user_pool.main.id }
output "cognito_client_id"       { value = aws_cognito_user_pool_client.web.id }
output "cognito_domain"          { value = "${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com" }
output "lambda_function"         { value = aws_lambda_function.image_processor.function_name }
output "vpc_id"                  { value = aws_vpc.main.id }
output "private_subnet_ids"      { value = aws_subnet.private[*].id }
