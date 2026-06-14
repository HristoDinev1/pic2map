# ---- Lambda execution role ----
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.project}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# CloudWatch logs + VPC ENI management for the Lambda
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "lambda_s3" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }
}
resource "aws_iam_role_policy" "lambda_s3" {
  name   = "${var.project}-lambda-s3"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_s3.json
}

# ---- App (API) role: S3 presign + Cognito admin + read RDS creds ----
data "aws_iam_policy_document" "app_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com", "apprunner.amazonaws.com", "ec2.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "app" {
  name               = "${var.project}-app-role"
  assume_role_policy = data.aws_iam_policy_document.app_assume.json
}

data "aws_iam_policy_document" "app_policy" {
  statement {
    sid       = "S3"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }
  statement {
    sid     = "Cognito"
    actions = [
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:ListUsers",
    ]
    resources = [aws_cognito_user_pool.main.arn]
  }
}
resource "aws_iam_role_policy" "app_policy" {
  name   = "${var.project}-app-policy"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app_policy.json
}

# Lets you `aws ssm start-session --target <backend-instance-id>` to shell in.
resource "aws_iam_role_policy_attachment" "app_ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Instance profile so EC2 can assume the app role.
resource "aws_iam_instance_profile" "app" {
  name_prefix = "${var.project}-app-"
  role        = aws_iam_role.app.name
}
