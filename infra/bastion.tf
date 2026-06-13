# SSM-only bastion: lets developers tunnel to private RDS without exposing it.
# No SSH, no inbound rules, no public IP. Reach it via:
#   aws ssm start-session --target <id> --document-name AWS-StartPortForwardingSessionToRemoteHost ...

data "aws_ssm_parameter" "al2023_x86" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_security_group" "bastion" {
  name_prefix = "${var.project}-bastion-"
  vpc_id      = aws_vpc.main.id
  description = "Bastion: egress-only, reached via SSM"

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "bastion" {
  name_prefix = "${var.project}-bastion-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name_prefix = "${var.project}-bastion-"
  role        = aws_iam_role.bastion.name
}

resource "aws_instance" "bastion" {
  ami                         = data.aws_ssm_parameter.al2023_x86.value
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.private[0].id
  vpc_security_group_ids      = [aws_security_group.bastion.id]
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  associate_public_ip_address = false

  metadata_options {
    http_tokens = "required"
  }

  tags = { Name = "${var.project}-bastion-${var.environment}" }
}
