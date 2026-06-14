# PHP backend on a single t3.micro EC2. Reached only via CloudFront (path /api/*),
# which restricts the security-group ingress to the CloudFront origin-facing IPs.

# AL2023 AMI id, fetched fresh each apply.
data "aws_ssm_parameter" "al2023_x86_backend" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# Managed prefix list of CloudFront origin-facing IPs.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "backend_http" {
  name_prefix = "${var.project}-backend-http-"
  vpc_id      = aws_vpc.main.id
  description = "HTTP from CloudFront only"

  ingress {
    description     = "HTTP from CloudFront origin-facing IPs"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Stable public IP — the CloudFront origin points at this.
resource "aws_eip" "backend" {
  domain = "vpc"
  tags   = { Name = "${var.project}-backend-${var.environment}" }
}

resource "aws_instance" "backend" {
  ami                    = data.aws_ssm_parameter.al2023_x86_backend.value
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.backend_http.id, aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  metadata_options {
    http_tokens = "required"
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    repo_url              = var.backend_repo_url
    repo_branch           = var.backend_repo_branch
    db_host               = aws_db_instance.mariadb.address
    db_name               = var.db_name
    db_user               = var.db_username
    db_password           = var.db_password
    aws_region            = var.aws_region
    s3_bucket             = aws_s3_bucket.media.bucket
    cognito_user_pool_id  = aws_cognito_user_pool.main.id
    cognito_client_id     = aws_cognito_user_pool_client.web.id
  })
  # Force replacement (and re-run of user-data) when bootstrap script changes.
  user_data_replace_on_change = true

  tags = { Name = "${var.project}-backend-${var.environment}" }
}

resource "aws_eip_association" "backend" {
  instance_id   = aws_instance.backend.id
  allocation_id = aws_eip.backend.id
}
