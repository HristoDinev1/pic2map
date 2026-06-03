variable "aws_region"   { type = string  default = "eu-central-1" }
variable "environment"  { type = string  default = "dev" }
variable "project"      { type = string  default = "pic2map" }

variable "db_name"      { type = string  default = "pic2map" }
variable "db_username"  { type = string  default = "pic2map" }
variable "db_password"  { type = string  sensitive = true }
variable "db_instance_class" { type = string default = "db.t4g.micro" }

variable "vpc_cidr"     { type = string  default = "10.20.0.0/16" }

variable "cognito_callback_urls" {
  type    = list(string)
  default = ["http://localhost:5173/callback", "https://app.example.com/callback"]
}
variable "cognito_logout_urls" {
  type    = list(string)
  default = ["http://localhost:5173", "https://app.example.com"]
}
