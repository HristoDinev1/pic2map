variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "environment" {
  type    = string
  default = "dev"
}
variable "project" {
  type    = string
  default = "pic2map"
}

variable "db_name" {
  type    = string
  default = "pic2map"
}
variable "db_username" {
  type    = string
  default = "pic2map"
}
variable "db_password" {
  type      = string
  sensitive = true
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "cognito_callback_urls" {
  type    = list(string)
  default = ["http://localhost:5173/callback"]
}
variable "cognito_logout_urls" {
  type    = list(string)
  default = ["http://localhost:5173"]
}

# Globally-unique prefix for the Cognito hosted-UI domain
# (https://<prefix>.auth.<region>.amazoncognito.com). The Cognito-prefix-domain
# namespace is shared across ALL AWS accounts, so this MUST be unique per
# deployment. No default on purpose — `terraform apply` should fail loudly
# until each environment picks its own value.
variable "cognito_domain_prefix" {
  type = string
}

# Origins allowed to PUT originals to the media bucket via presigned URLs.
# List exactly the frontend origins that will hit S3 directly (browser PUT),
# e.g. http://localhost:5173 in dev and your real app origin in prod.
variable "s3_cors_allowed_origins" {
  type    = list(string)
  default = ["http://localhost:5173"]
}

# Public Git URL the backend EC2 clones on first boot.
variable "backend_repo_url" {
  type    = string
  default = "https://github.com/HristoDinev1/pic2map.git"
}
variable "backend_repo_branch" {
  type    = string
  default = "us-east-1-dev-more-aws"
}

