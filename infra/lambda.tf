resource "aws_security_group" "lambda" {
  name_prefix = "${var.project}-lambda-"
  vpc_id      = aws_vpc.main.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Package the image-processor. In CI you would build node_modules (incl. a
# linux-x64 sharp binary) before zipping. Here we zip the source dir.
data "archive_file" "image_processor" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/image-processor"
  output_path = "${path.module}/build/image-processor.zip"
}

resource "aws_lambda_function" "image_processor" {
  function_name = "${var.project}-image-processor-${var.environment}"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  filename      = data.archive_file.image_processor.output_path
  source_code_hash = data.archive_file.image_processor.output_base64sha256
  timeout       = 60
  memory_size   = 1024

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      S3_BUCKET    = aws_s3_bucket.media.bucket
      DATABASE_URL = "mysql://${var.db_username}:${var.db_password}@${aws_db_instance.mariadb.endpoint}/${var.db_name}"
      DB_SSL       = "true"
    }
  }
}

resource "aws_lambda_permission" "allow_s3" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.image_processor.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.media.arn
}
