# Media bucket: originals/ thumbs/ medium/ large/ imported/
resource "aws_s3_bucket" "media" {
  bucket = "${var.project}-media-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CORS so the browser can PUT originals via presigned URLs.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.cognito_logout_urls
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Fire the image-processor Lambda whenever an original lands.
resource "aws_s3_bucket_notification" "media_events" {
  bucket = aws_s3_bucket.media.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.image_processor.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "originals/"
  }
  depends_on = [aws_lambda_permission.allow_s3]
}
