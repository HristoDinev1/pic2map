# OpenTofu / Terraform-compatible.  Run with:  tofu init && tofu apply
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws    = { source = "hashicorp/aws",    version = "~> 5.50" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Recommended: remote state
  # backend "s3" {
  #   bucket = "pic2map-tfstate"
  #   key    = "pic2map/terraform.tfstate"
  #   region = "eu-central-1"
  # }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "PIC2MAP"
      Environment = var.environment
      ManagedBy   = "OpenTofu"
    }
  }
}
