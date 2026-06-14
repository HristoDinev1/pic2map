# PIC2MAP — exam project

Hristo Dinev - 3MI0600383
Vaya Yandina - 5MI0600284
Valentina Petrova - 7MI0600307

---

## 1. What PIC2MAP is

PIC2MAP is a self-hostable photo-on-a-map web app. Each user uploads photos
through the browser; the server extracts the GPS coordinates from the image's
EXIF metadata, generates thumbnail / medium / large derivatives, and pins the
photo on a shared interactive map. Photos without EXIF GPS can be geotagged
manually by clicking the map.

### What it does, end to end

- **Accounts & roles** — sign-up / sign-in / forgot-password, with three
  roles: `USER` (default), `MODERATOR`, `ADMIN`. The first registered account
  becomes admin automatically. Two interchangeable auth backends ship in the
  same codebase: a self-hosted local driver (passwords stored as bcrypt
  hashes, HMAC-signed session tokens) and Amazon Cognito.
- **Upload pipeline** — the browser asks the API for a presigned PUT URL,
  uploads the original directly to object storage, and the server (or the
  image-processor Lambda, on AWS) extracts EXIF + generates 320 / 1024 /
  2048-px renditions.
- **Map** — slippy-map (OSM tiles) with clustered pins for every photo the
  caller is allowed to see (own photos always; other users' photos when
  marked `PUBLIC` and not rejected by a moderator).
- **Personal gallery, albums, search** — own photos in any state, public
  photos from anyone, filterable by username/email, album, title, date
  range, and bounding box.
- **Manual geotag editor** — drag a marker on the map to add / change / clear
  GPS coordinates on a photo that lacks them.
- **Moderation** — moderators see a queue of `PENDING` uploads and can
  approve, reject, or delete. The action log survives photo deletion.
- **Admin dashboard** — system-wide stats (users, photos, storage),
  user-role management.

### Tech stack

- **Frontend:** plain HTML/CSS/JavaScript (ES modules, no framework, no external libraries) — custom slippy-map over OSM tiles, custom EXIF parser, hash router.
- **Backend:** PHP (no framework) + PDO / MariaDB.
- **Image processing:** Node.js 20 + `sharp` + `exifr` (running as a Lambda).
- **Infrastructure-as-code:** OpenTofu (Terraform-compatible) for everything in `infra/`.

---

## 2. Repository contents

| Folder / file | Contents |
|---|---|
| `frontend/` | Static client (`js/`, `css/`, `index.html`) + tests (`test/`). What gets uploaded to the S3 frontend bucket. |
| `backend/` | REST API. `public/` is the web-server entry point. `src/` is the application code. `sql/schema.sql` + `scripts/migrate.php` set up the database. |
| `lambda/image-processor/` | Node.js Lambda code that runs after every S3 upload — EXIF + resizing. |
| `infra/` | All AWS resources as OpenTofu config. **Cloud is provisioned entirely from here — nothing is clicked in the AWS Console.** |
| `docker-compose.yml` | Optional. Spins up a local MariaDB if you want to run fully off-cloud. |
| `README.md` | This file. |
| `API.md` | REST API reference. |

---

## 3. Architecture (current)

Everything below this line is running in AWS. **Your laptop only does
development work** — once you've deployed, the live site doesn't need your
laptop to be on.

```
                        ┌─────────────────┐
                        │     Browser     │
                        └────────┬────────┘
                                 │ HTTPS
                                 ▼
                ┌────────────────────────────────────┐
                │  CloudFront distribution           │
                │  https://<dist>.cloudfront.net     │
                │                                    │
                │   /         → S3 (frontend bucket) │
                │   /api/*    → EC2 backend (HTTP)   │
                └─────────┬───────────────┬──────────┘
                          │               │
            ┌─────────────┘               └──────────────┐
            ▼                                            ▼
   ┌────────────────┐                          ┌──────────────────────┐
   │  S3 frontend   │                          │  EC2 t3.micro        │
   │  (private,     │                          │  PHP backend         │
   │   served via   │                          │  Public IP (EIP)     │
   │   OAC only)    │                          │  systemd service     │
   └────────────────┘                          └──────┬───────────────┘
                                                      │
                          ┌───────────────────────────┼─────────────────────┐
                          │                           │                     │
                          ▼                           ▼                     ▼
                  ┌──────────────┐        ┌─────────────────┐     ┌──────────────┐
                  │ RDS MariaDB  │        │   Cognito       │     │  S3 media    │
                  │ private subs │        │   user pool     │     │  bucket      │
                  └──────────────┘        └─────────────────┘     └──────┬───────┘
                                                                         │ ObjectCreated
                                                                         ▼
                                                                ┌────────────────┐
                                                                │  Lambda        │
                                                                │  image-        │
                                                                │  processor     │
                                                                └─┬────────────┬─┘
                                                                  │ thumbs     │ update
                                                                  ▼            ▼
                                                              S3 media     RDS row
```

The browser makes **one** outbound connection — to CloudFront. CloudFront
splits the traffic by URL path:

- `/...` → static frontend files from the private S3 bucket (signed by an
  Origin Access Control policy, so the bucket itself stays private).
- `/api/...` → forwarded as HTTP to the EC2 backend's Elastic-IP DNS name.
  CloudFront's HTTPS cert handles the public-facing TLS, and the EC2's
  security group only accepts inbound traffic from CloudFront's
  origin-facing IPs. So even though the EC2 listens on plain HTTP, nobody
  on the internet can hit it directly.

---

## 4. AWS services and what each one does

| Service | Configured in | What it does for pic2map | Free tier |
|---|---|---|---|
| **VPC** + 2 public + 2 private subnets, IGW, NAT, route tables | `infra/vpc.tf` | Network isolation. Backend EC2 sits in a public subnet (so it has internet for `dnf install`); RDS and Lambda sit in private subnets. | Always free (NAT Gateway is **not** — see §11). |
| **S3 — frontend bucket** (`pic2map-frontend-<env>`) | `infra/frontend.tf` | Stores the static HTML/CSS/JS files. Bucket is private; only CloudFront can read it. | 5 GB / 12 months. |
| **S3 — media bucket** (`pic2map-media-<env>`) | `infra/s3.tf` | Stores photos: `originals/{userId}/{photoId}.{ext}` plus `thumbs/`, `medium/`, `large/` derivatives. CORS allows `PUT/GET/HEAD` from the configured frontend origins. | Same as above (shared 5 GB pool). |
| **CloudFront** distribution | `infra/frontend.tf` | The single public URL of the site. Two origins: S3 frontend (default) and the EC2 backend (path `/api/*`). Provides free HTTPS via the AWS-managed `*.cloudfront.net` cert. SPA fallback (`403/404 → /index.html`) so the client-side router can resolve any path. | 1 TB egress / month, **always** free. |
| **EC2 t3.micro backend** | `infra/backend.tf` | Runs the PHP REST API behind a `php -S` server managed by `systemd`. Reachable only from CloudFront. Boots itself by `git clone`-ing this repo on first launch — no manual `scp` of code. | 750 hrs / month / 12 months. |
| **Elastic IP** | `infra/backend.tf` | Stable public IP for the EC2 (so the CloudFront origin DNS keeps working across stop/start). | Free while attached to a running instance. |
| **Cognito** (User Pool, Hosted UI domain, App Client) | `infra/cognito.tf` | Sign-up, email verification, sign-in, password reset, JWT issuance. The pool has groups `Moderators` and `Administrators` which map to app roles. | 50,000 monthly active users, **always** free. |
| **RDS MariaDB 11.4** | `infra/rds.tf` | Source of truth for users, photos, albums, moderation log, audit log. Sits in private subnets — no public IP. The backend EC2 reaches it directly because it's in the same VPC. | 750 hrs `db.t3.micro` / month / 12 months. |
| **Lambda** (`image-processor-<env>`) | `infra/lambda.tf`, `lambda/image-processor/` | Node.js 20 function inside the VPC. Triggered by `s3:ObjectCreated:*` on `originals/`. Pulls the original, extracts EXIF GPS + capture date, generates three resized JPEGs, writes them back, updates the photo row to `READY`. | 1M requests / month, **always** free. |
| **IAM** | `infra/iam.tf` | Two least-privilege roles: Lambda (S3 + VPC ENIs + logs) and App (S3 presign + Cognito admin + SSM Session Manager). The EC2 assumes the App role via an instance profile — no static keys anywhere. | Always free. |
| **CloudWatch** | `infra/cloudwatch.tf` | Lambda log group with 30-day retention, alarms for Lambda errors and RDS CPU. EC2 logs go to `journalctl` and `/var/log/pic2map.log` on the box itself. | Limited free tier. |
| **Systems Manager (SSM)** | `infra/iam.tf` | Lets you `aws ssm start-session --target <id>` into the backend EC2 with no SSH key, no port 22, no public exposure. | Free. |

### What's no longer there

If you have an older clone/branch you might see references to a **bastion EC2**
or an **SSM port-forward tunnel** to RDS. Those are gone. Once the backend
moved into the VPC it can talk to RDS directly, so the tunnel was redundant.

---

## 5. Setup case A — fresh clone, never run before

This is the path for someone who has just `git clone`'d the repo and wants
the live AWS site stood up for the first time.

### A.0. Prerequisites — install on your laptop

- **An AWS account.** A new one is fine; everything in this project fits in
  the free tier except the NAT Gateway (~$32/mo, see §11 for how to remove
  it).
- **AWS CLI v2.** Verify with `aws --version`.
- **OpenTofu** (or Terraform — commands are interchangeable; this README
  uses `tofu`). Verify with `tofu --version`.
- **Git.** Verify with `git --version`.
- **AWS Session Manager Plugin.** Needed only if you want to SSM into the
  EC2 for debugging.
  - Windows: `winget install Amazon.SessionManagerPlugin`
  - macOS: `brew install --cask session-manager-plugin`
  - Linux: see https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html

### A.1. Configure AWS CLI

```bash
aws configure
# AWS Access Key ID:     <your IAM user's key>
# AWS Secret Access Key: <your IAM user's secret>
# Default region name:   us-east-1
# Default output format: json
```

Verify:
```bash
aws sts get-caller-identity
```

You should see your account ID and the IAM user's ARN. **Stop here if this
errors** — nothing below will work without working credentials.

### A.2. Clone the repo

```bash
git clone https://github.com/HristoDinev1/pic2map.git
cd pic2map
git checkout us-east-1-dev-more-aws    # the AWS-mode branch
```

### A.3. Fill in `infra/terraform.tfvars`

The TF config has a few values that can't be defaulted (secrets and
globally-unique names):

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

Open `infra/terraform.tfvars` and set:

```hcl
# Required: master password for RDS MariaDB. Pick a strong random string.
db_password = "CHOOSE_A_STRONG_PASSWORD"

# Required: globally unique across all AWS accounts (it becomes a subdomain
# of amazoncognito.com). Pick something project-specific.
cognito_domain_prefix = "pic2map-yourname-dev"

# Leave these as-is on the first apply. After the first apply you'll come
# back and add the real CloudFront URL — see step A.6.
cognito_callback_urls   = ["http://localhost:5173/callback"]
cognito_logout_urls     = ["http://localhost:5173"]
s3_cors_allowed_origins = ["http://localhost:5173"]
```

`terraform.tfvars` is in `.gitignore` — never commit it.

### A.4. First apply — provision everything

```bash
tofu init           # first time only, downloads providers
tofu apply
```

Type `yes` at the prompt. **First apply takes ~10–15 minutes** (RDS and
CloudFront are slow). When it finishes, capture the outputs:

```bash
tofu output
```

You'll see:
- `frontend_url` — `https://dXXXXXX.cloudfront.net` (the public site URL)
- `frontend_bucket` — `pic2map-frontend-dev`
- `backend_instance_id` — `i-0abc...` (for SSM)
- `backend_public_ip` — the Elastic IP
- `cognito_user_pool_id`, `cognito_client_id`, `cognito_domain`
- `media_bucket`, `rds_endpoint`, `lambda_function`, `vpc_id`

### A.5. Wait ~3 minutes for the EC2 to bootstrap itself

The EC2 user-data script (`infra/user-data.sh.tftpl`) runs on first boot:

1. `dnf install` PHP and modules
2. `git clone` this repo to `/opt/pic2map`
3. Write a `.env` for the backend with the RDS endpoint, Cognito IDs, etc.
4. Run `php scripts/migrate.php` against RDS
5. Install a `systemd` unit and start `pic2map.service`

You can watch progress via SSM:
```bash
aws ssm start-session --target "$(tofu output -raw backend_instance_id)"
sudo tail -f /var/log/pic2map-bootstrap.log
# Press Ctrl+D when you see "Created symlink ... pic2map.service"
```

Sanity check the service is up:
```bash
sudo systemctl status pic2map
# Active: active (running)  ← what you want
exit
```

### A.6. Second apply — register the CloudFront URL with Cognito + S3 CORS

Now that you know the CloudFront URL, edit `infra/terraform.tfvars` and add it
to all three lists. Replace `dXXXXXX.cloudfront.net` with your real domain
from `tofu output -raw frontend_url`:

```hcl
cognito_callback_urls   = ["http://localhost:5173/callback", "https://dXXXXXX.cloudfront.net/callback"]
cognito_logout_urls     = ["http://localhost:5173", "https://dXXXXXX.cloudfront.net"]
s3_cors_allowed_origins = ["http://localhost:5173", "https://dXXXXXX.cloudfront.net"]
```

```bash
tofu apply
```

This second apply is fast — it just updates the Cognito client and the
media bucket's CORS rules.

### A.7. Configure the frontend

```bash
cd ../frontend/js
cp config.example.js config.js
```

Open `frontend/js/config.js` and set:

```js
window.PIC2MAP_CONFIG = {
  apiBase: '/api',                                       // relative — same origin as the page
  authDriver: 'cognito',
  cognitoRegion: 'us-east-1',
  cognitoClientId: 'PASTE_FROM_TOFU_OUTPUT',             // tofu output -raw cognito_client_id
};
```

`config.js` is also in `.gitignore`.

### A.8. Upload the frontend to S3

From the **repo root**:

```bash
aws s3 sync frontend/ "s3://$(cd infra && tofu output -raw frontend_bucket)/" \
  --exclude "test/*" --exclude "package*.json" \
  --exclude "node_modules/*" --exclude ".gitignore"
```

(If the `$(...)` substitution doesn't work in your shell, run
`tofu output -raw frontend_bucket` first and paste the bucket name in
literally.)

### A.9. Open the site

```bash
cd infra
tofu output -raw frontend_url
```

Open that URL in your browser. The first registered account becomes admin.

### A.10. Optional but recommended — invalidate the CloudFront cache after each frontend deploy

CloudFront caches static files aggressively. To force users (including you)
to see the new files immediately:

```bash
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Comment, 'pic2map-frontend')].Id" \
  --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

Without this, expect new file changes to take 5–60 minutes to propagate.

---

## 6. Setup case B — you already deployed, you're coming back later

**Read this first:** AWS resources are persistent. They keep running 24/7
whether your laptop is on or off, whether the terminal you used to run
`tofu apply` is open or closed. Closing the terminal does **not** stop or
break anything in AWS. The CloudFront URL keeps working, the EC2 keeps
serving traffic, RDS keeps the data.

So in most cases, "getting back to working state" is **literally nothing** —
just open the CloudFront URL in your browser.

The only times you need to do something:

### B.1. You stopped the EC2 to save money

If you ran `aws ec2 stop-instances` to pause the backend (see §10), it
won't auto-start. Bring it back:

```bash
cd infra
aws ec2 start-instances --instance-ids "$(tofu output -raw backend_instance_id)"
```

Wait ~30 seconds for it to boot, then re-test the site. The Elastic IP is
still attached, so the CloudFront origin keeps working — no DNS changes
needed.

### B.2. You changed backend code locally and want it deployed

```bash
# 1. Push the change to GitHub
git add ...
git commit -m "..."
git push origin us-east-1-dev-more-aws

# 2. Pull on the EC2 and restart the service
aws ssm start-session --target "$(cd infra && tofu output -raw backend_instance_id)"
# now inside the EC2:
cd /opt/pic2map
sudo git pull
sudo systemctl restart pic2map
sudo systemctl status pic2map      # confirm Active: active (running)
exit
```

If the change includes a DB schema migration:
```bash
# inside the EC2, after git pull:
cd /opt/pic2map/backend
php scripts/migrate.php
```

### B.3. You changed frontend code locally and want it deployed

```bash
# From the repo root
aws s3 sync frontend/ "s3://$(cd infra && tofu output -raw frontend_bucket)/" \
  --exclude "test/*" --exclude "package*.json" \
  --exclude "node_modules/*" --exclude ".gitignore"

# Invalidate the CloudFront cache
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Comment, 'pic2map-frontend')].Id" \
  --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

### B.4. You changed something in `infra/*.tf`

```bash
cd infra
tofu apply
```

If the change was specifically to `user-data.sh.tftpl` or the EC2's
inputs, TF will **replace the EC2** (because of `user_data_replace_on_change`
in `backend.tf`) — meaning a fresh boot, a fresh `git clone`, a fresh
`migrate.php`. Expect ~3 minutes of `/api/*` 502 while the new instance
bootstraps.

### B.5. You forgot the URLs / IDs

```bash
cd infra
tofu output
```

Everything you need is here. If `tofu output` itself errors, run
`tofu init` first (state lives locally in `infra/.terraform/` — if you
switched machines, you'll need to commit/share state somehow, or import
existing resources).

### B.6. You see "I get a 502 on /api/*"

The backend EC2 is down or the PHP service crashed.

```bash
aws ssm start-session --target "$(cd infra && tofu output -raw backend_instance_id)"
sudo systemctl status pic2map
sudo journalctl -u pic2map -e         # last lines of the log
sudo tail -f /var/log/pic2map.log     # live tail
```

Most common causes:
- DB migration that didn't apply.
- `.env` got out of sync (e.g., RDS endpoint changed).
- PHP fatal error from a new commit. Roll back: `cd /opt/pic2map && sudo git reset --hard HEAD~1 && sudo systemctl restart pic2map`.

---

## 7. Day-to-day operations cheat sheet

| Task | Command |
|---|---|
| Open the site | Browser → `tofu output -raw frontend_url` |
| Deploy backend code | `git push` → SSM in → `cd /opt/pic2map && sudo git pull && sudo systemctl restart pic2map` |
| Deploy frontend code | `aws s3 sync frontend/ s3://$BUCKET/...` + CloudFront invalidation |
| Run a DB migration | SSM in → `cd /opt/pic2map/backend && php scripts/migrate.php` |
| Tail backend logs | SSM in → `sudo journalctl -u pic2map -f` |
| Inspect the DB | SSM in → `mysql -h $DB_HOST -u $DB_USER -p` (vars are in `/opt/pic2map/backend/.env`) |
| Stop the EC2 (save cost) | `aws ec2 stop-instances --instance-ids $(tofu output -raw backend_instance_id)` |
| Start the EC2 again | `aws ec2 start-instances --instance-ids $(tofu output -raw backend_instance_id)` |
| Re-bootstrap the EC2 from scratch | `tofu taint aws_instance.backend && tofu apply` |
| Look at CloudWatch logs (Lambda) | AWS Console → CloudWatch → Log groups → `/aws/lambda/pic2map-image-processor-dev` |

---

## 8. Tearing it all down

```bash
cd infra
tofu destroy
```

Confirms with `yes`. Removes everything created by `infra/` — the EC2,
Elastic IP, CloudFront distribution, both S3 buckets, RDS, Cognito user pool,
Lambda, VPC, NAT Gateway, IAM roles. **All photos in the DB and S3 are
permanently deleted** (S3 bucket must be emptied first; if `destroy`
complains about a non-empty bucket, run `aws s3 rm s3://<bucket> --recursive`
and re-run).

---

## 9. Optional: fully-local mode (no AWS, no internet)

The codebase still supports running everything on your laptop. Useful for
offline development or testing without touching cloud:

```bash
# 1. MariaDB in Docker
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
# Leave AUTH_DRIVER=local and STORAGE_DRIVER=local
php scripts/migrate.php
php -S localhost:4000 -t public public/router.php

# 3. Frontend
cd frontend/js && cp config.example.js config.js
# Leave authDriver: 'local' and apiBase: 'http://localhost:4000/api'
cd .. && php -S localhost:5173

# 4. Open http://localhost:5173 — first account is admin.
```

This mode does **not** touch AWS — accounts are stored in the local DB,
photos in `backend/storage/`, image processing happens synchronously in PHP
(GD + custom EXIF parser instead of `sharp` + `exifr`).

You can run local mode side-by-side with the deployed AWS site — they share
no state.

---

## 10. Cost-saving tips

The project sits in AWS Free Tier with one big exception: the **NAT
Gateway** (~$32/month, never free). Everything else is either always-free
(CloudFront 1 TB, Cognito 50k MAU, Lambda 1M reqs) or 12-month free
(EC2 t3.micro, RDS db.t3.micro, S3 5 GB, Application Load Balancer).

To minimize spend:

1. **Stop the EC2 when you're not actively developing** — the Elastic IP
   stays attached for free; only the EBS root volume (~$0.80/mo) charges.
   ```bash
   aws ec2 stop-instances --instance-ids "$(tofu output -raw backend_instance_id)"
   ```
2. **Remove the NAT Gateway when you don't need Lambda outbound internet.**
   This is "step 3" of the AWS-migration plan and saves the bulk of the
   cost; Lambda only needs S3 (which can use a free Gateway VPC Endpoint)
   and RDS (which is already in-VPC). Not done yet — TODO.
3. **`tofu destroy` between work sessions** — slowest path, but $0 while
   destroyed. Ten minutes to bring everything back next time.

---

## 11. Known follow-ups

- **Remove the NAT Gateway.** Add a `com.amazonaws.s3` Gateway VPC Endpoint
  in `vpc.tf` and delete the NAT — the only thing that uses NAT is Lambda's
  outbound to S3, which the endpoint handles for free.
- **Move secrets out of the EC2 user-data into SSM Parameter Store.** Today
  the DB password is interpolated into `user-data.sh.tftpl` and ends up in
  EC2 instance metadata at rest. Acceptable for a school project; not for
  production.
- **Replace `php -S` with nginx + `php-fpm`.** The PHP built-in server is
  single-threaded and officially "not for production". Fine for an exam
  project, but a single hung request blocks the next one.

---

## 12. Troubleshooting

### "Failed to fetch" on the frontend, even though `/` loads
DevTools → Network. Look at the `/api/*` request:
- **502 Bad Gateway** → backend is down. SSM in, `sudo systemctl status pic2map`.
- **403 with `<Error><Code>Missing...</Code>`** → CloudFront origin misconfigured. `tofu apply` to refresh.
- **CORS error** → only happens if you bypassed CloudFront somehow; `/api/*` is same-origin.

### "redirect_uri does not match" from Cognito
You forgot step A.6 (adding the CloudFront URL to `cognito_callback_urls`).
Edit `terraform.tfvars`, add it, `tofu apply`, hard-reload the page.

### S3 PUT (upload) fails silently
DevTools → Network. Look for an `OPTIONS` request to `*.s3.*.amazonaws.com`
that's red. CloudFront URL missing from `s3_cors_allowed_origins` — fix in
tfvars and `tofu apply`. Hard-reload (CORS preflight is cached for 3000 s).

### `tofu apply` hangs on a destroy step (~15 min)
Almost always: a security group can't be deleted because another security
group still references it (e.g., the RDS SG referencing the bastion SG
during the migration). Find it and remove the rule manually:
- Console: EC2 → Security Groups → `pic2map-rds-*` → Inbound rules → Edit → delete the row pointing at the SG TF wants to destroy → Save.
- TF retries every 10 s and unblocks within seconds.

### EC2 user-data script changed but the EC2 still has the old code
`backend.tf` sets `user_data_replace_on_change = true`, so changing the
template should force a new EC2. If it didn't, force it:
```bash
tofu taint aws_instance.backend
tofu apply
```

### "I broke the .env on the EC2 and the backend won't start"
Either fix it via SSM (`sudo nano /opt/pic2map/backend/.env`), or recreate
the box: `tofu taint aws_instance.backend && tofu apply` — the `.env` is
re-generated from `terraform.tfvars` on every fresh boot.
