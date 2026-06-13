# PIC2MAP — изпитен проект

Христо Динев - 3MI0600383
Вая Яндина - 5MI0600284
Валентина Петрова - 7MI0600307

## Описание

Уеб приложение за качване на снимки, което автоматично извлича GPS координатите от EXIF данните на изображението и ги показва като маркери върху интерактивна карта. Поддържа потребителски акаунти, лична галерия, албуми, търсене и редакция на местоположение чрез избор върху картата.

## Overview (English)

PIC2MAP is a self-hostable photo-on-a-map web app. Each user uploads photos
through the browser; the server extracts the GPS coordinates from the image's
EXIF metadata, generates thumbnail / medium / large derivatives, and pins the
photo on a shared interactive map. Photos without EXIF GPS can be geotagged
manually by clicking the map.

What it does, end to end:

- **Accounts & roles** — sign-up / sign-in / forgot-password, with three
  roles: `USER` (default), `MODERATOR`, `ADMIN`. The first registered account
  becomes admin automatically. Two interchangeable auth backends ship in the
  same codebase: a self-hosted local driver (passwords stored as bcrypt
  hashes, HMAC-signed session tokens), and Amazon Cognito.
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

Two deployment modes are first-class:

1. **Fully local** — MariaDB in Docker, files on the local filesystem,
   accounts in the same DB. No AWS account, no API keys, no cost.
2. **AWS** — RDS MariaDB in private subnets, S3 for media, Cognito for
   accounts, and a Lambda for image processing. See *AWS architecture* below.

## Технологии

- **Frontend:** чист HTML/CSS/JavaScript (ES модули, без framework и без външни библиотеки) — собствена slippy-map карта върху OSM тайлове, собствен EXIF парсер, hash рутер
- **Backend:** PHP (без framework) + PDO / MariaDB (MySQL)

## Съдържание на архива

| Папка / файл | Съдържание |
|---|---|
| `frontend/` | статичен клиент (`js/`, `css/`, `index.html`) + тестове (`test/`) |
| `backend/` | REST API (`public/`, `src/`, `sql/schema.sql`, `scripts/migrate.php`) |
| `infra/` | конфигурация за облачно разполагане (по избор) |
| `README.md` | пълна документация и архитектура |

## Стартиране (локално, без външни услуги)

1. **MariaDB/MySQL:** `docker compose up -d` (или локален сървър на `:3306`)
2. **Backend:**
   ```bash
   cd backend
   cp .env.example .env
   php scripts/migrate.php
   php -S localhost:4000 -t public public/router.php
   ```
3. **Frontend:**
   ```bash
   cd frontend/js && cp config.example.js config.js
   cd .. && php -S localhost:5173
   ```
4. Отворете **http://localhost:5173** — първият регистриран акаунт е администратор.

**Тестове:** `cd frontend && npm test`

## Забележки

- Не са нужни никакви API ключове или външни услуги — всичко работи локално.
- Снимка с GPS в EXIF се появява на картата веднага след качване; снимка без GPS може да се геотагне ръчно през редактора („Pick on map“).

## AWS architecture

Everything in `infra/` is one OpenTofu/Terraform configuration that stands up
the full cloud side. The PHP backend can run on your laptop, on ECS, or on
App Runner — the AWS resources don't care; they only see authenticated API
calls and IAM-signed requests.

### High-level flow

```
        ┌────────────────────────────── Browser ───────────────────────────────┐
        │  static frontend (HTML/JS) served from anywhere                       │
        └──────────┬─────────────────────────────────┬──────────────────────────┘
                   │ 1. sign-in (HTTPS)              │ 4. PUT original (HTTPS, presigned)
                   ▼                                 ▼
            ┌───────────────┐                ┌──────────────────┐
            │  Cognito      │                │  S3              │
            │  user pool    │                │  media bucket    │
            │  (regional)   │                │  (private)       │
            └───────┬───────┘                └────────┬─────────┘
                    │ 2. ID/access tokens             │ 5. ObjectCreated event
                    ▼                                 ▼
            ┌───────────────┐ 3. JWT-auth   ┌──────────────────┐
            │  PHP API      ├──────────────►│  Lambda          │
            │  /api/*       │ 7. /me, list, │  image-processor │
            │  (laptop /    │    presign    │  (Node.js +      │
            │  ECS / App    │◄──────────────┤   sharp + exifr) │
            │  Runner)      │ 6. update DB  └────────┬─────────┘
            └───────┬───────┘                        │
                    │ 6/7. SQL                       │ 6a. PUT thumb/medium/large
                    ▼                                ▼
            ┌─────────────────────────────────────────────────┐
            │   RDS MariaDB (private subnets, no public IP)   │
            └─────────────────────────────────────────────────┘
                    ▲ via SSM port-forward
                    │
            ┌───────┴───────┐
            │  Bastion EC2  │  reached only with `aws ssm start-session` —
            │  (no SSH)     │  no public IP, no inbound rules.
            └───────────────┘
```

### What each AWS service does

| Service | What it is here | Configured in |
|---|---|---|
| **VPC** + 2 public + 2 private subnets, IGW, NAT, route tables | Network isolation. The DB and Lambda live in private subnets and reach the internet only through a single NAT gateway. The bastion lives in private subnets too — there is intentionally **no SSH path in**. | `infra/vpc.tf` |
| **S3** (`pic2map-media-<env>`) | Object storage for everything image-shaped. Layout: `originals/{userId}/{photoId}.{ext}` for the upload, plus `thumbs/`, `medium/`, `large/` for the renditions written by Lambda. Public access is blocked at the bucket level; the browser only ever sees presigned URLs (PUT for upload, GET for view), each scoped to one object and one short expiry. CORS allows `PUT/GET/HEAD` from the configured frontend origins. Versioning + AES-256 SSE on. | `infra/s3.tf`, `backend/src/S3.php` |
| **Cognito** (User Pool + Hosted UI domain + App Client) | Identity provider when `AUTH_DRIVER=cognito`. Sign-up, email verification, password reset, JWT issuance — all handled by Cognito. The pool is configured with `username_attributes = ["email"]`, so a user's email *is* their Cognito username. Two groups (`Moderators`, `Administrators`) drive the app's role mapping. The web client uses the `code` OAuth flow plus `USER_PASSWORD_AUTH` for the direct-from-browser sign-in path in `frontend/js/cognito.js`. | `infra/cognito.tf`, `backend/src/Cognito.php`, `frontend/js/cognito.js` |
| **RDS MariaDB 11.4** | Source of truth for users, photos, albums, moderation log, audit log. Lives in private subnets; reached by Lambda directly (same VPC) and by the API via security-group rules; reached from your laptop only through the SSM tunnel (no public endpoint). Storage encrypted at rest, daily automated backups. | `infra/rds.tf`, `backend/sql/schema.sql` |
| **Lambda** (`pic2map-image-processor-<env>`) | Node.js 20 function that runs **inside the VPC** so it can talk to RDS over the private network. Triggered by an S3 `ObjectCreated:*` event with prefix `originals/`. Pulls the upload, extracts EXIF GPS + capture date with `exifr`, generates three resized JPEGs with `sharp`, writes them back under `thumbs/medium/large/`, and updates the matching `photos` row with size / GPS / capture-date / `process_state='READY'`. The frontend polls `/api/photos/{id}` until `process_state` flips. | `infra/lambda.tf`, `lambda/image-processor/index.js` |
| **IAM roles** | Two least-privilege roles. The Lambda role grants S3 `GetObject/PutObject` on the media bucket only and the AWS-managed `AWSLambdaVPCAccessExecutionRole` (so the function can attach an ENI to the private subnet and write CloudWatch logs). The App role grants S3 `GetObject/PutObject/DeleteObject` plus a small set of `cognito-idp:Admin*` actions for role management; assumable by `ecs-tasks` and `apprunner` so the same role works in both deployment shapes. | `infra/iam.tf` |
| **CloudWatch** | Logs + alarms. The Lambda gets an explicit log group with 30-day retention (otherwise Lambda would auto-create one with no retention cap). Two alarms ship out of the box: `pic2map-image-processor-errors` (>1 error per 5 min) and `pic2map-rds-cpu-high` (>80% CPU for two consecutive 5-minute windows). | `infra/cloudwatch.tf` |
| **EC2 t3.micro bastion** | Tiny private-subnet host whose only job is to be the other end of an SSM port-forward into RDS. No public IP, no inbound rules, no SSH key. Eligible for the 12-month Free Tier; stop it with `aws ec2 stop-instances` when you're done for the day so you only pay ~$0.80/mo for the EBS root volume. | `infra/bastion.tf` |
| **Systems Manager (SSM)** | Reaches the bastion without exposing it. The bastion's IAM instance profile attaches `AmazonSSMManagedInstanceCore`, so `aws ssm start-session --document AWS-StartPortForwardingSessionToRemoteHost` opens a TCP tunnel from a local port on your laptop to RDS:3306 inside the VPC. SSM itself is free; no NAT charges either, since the agent uses the VPC endpoint path. | `infra/bastion.tf`, step 4 below |

### Two key request flows

**Sign in (Cognito mode).**  The browser POSTs `username/password` straight
to the regional `cognito-idp` endpoint and gets back an ID token + refresh
token. Every subsequent API call carries the ID token in `Authorization:
Bearer …`; the PHP backend verifies it against the Cognito JWKS, maps the
`cognito:groups` claim onto `USER/MODERATOR/ADMIN`, and synthesises a `users`
row on first sight (kept in sync on every request). Sign-out clears the
local session and globally revokes the refresh token through Cognito.

**Upload a photo.**

1. Browser → API: `POST /api/photos/presign` with the filename and
   content-type. The API inserts a `photos` row with `process_state =
   UPLOADED` and returns a one-time presigned PUT URL.
2. Browser → S3: `PUT <presigned-url>` with the raw image bytes. CORS
   preflight has to pass first — the bucket's CORS rule allows `PUT/GET/HEAD`
   from the configured frontend origins.
3. S3 → Lambda: `s3:ObjectCreated:*` event with prefix `originals/` invokes
   the image-processor.
4. Lambda → S3: downloads the original, runs `exifr` (GPS + capture date) and
   `sharp` (320 / 1024 / 2048-px JPEGs), uploads the three derivatives.
5. Lambda → RDS: updates the same `photos` row with width/height/size, GPS,
   `captured_at`, the three derivative S3 keys, and `process_state =
   READY` (or `FAILED` plus the error message).
6. Browser → API: polls `GET /api/photos/{id}` and renders the thumbnail
   once `process_state` flips. View URLs are short-lived presigned GETs
   minted by the API on demand — the bucket itself stays private.

In **fully-local mode** the same flow uses the local filesystem instead of
S3, and runs the `exifr/sharp` work synchronously inside PHP — no Lambda,
no event, no IAM, but the contract on the frontend is identical.

## Running against AWS (private RDS via SSM tunnel)

This is what you actually need to do, end-to-end, to bring up the project
against the AWS resources defined in `infra/`. The backend still runs on
your laptop — the cloud side is RDS + S3 + Cognito + the image-processor
Lambda. RDS lives in private subnets (correct — DBs should never be public),
so your laptop reaches it through an SSM port-forwarding tunnel into a tiny
bastion instance.

No values in this section are real — every `<placeholder>` either comes from
`tofu output` after a successful `apply`, or from a value **you choose** and
put in `infra/terraform.tfvars` (which is gitignored).

### 0. Prerequisites

- **AWS account** with permissions to create VPC / RDS / Lambda / IAM / EC2 / SSM resources.
- **AWS CLI** configured (`aws configure`) — verify with `aws sts get-caller-identity`.
- **OpenTofu** (or Terraform — commands are interchangeable; this repo uses `tofu`).
- **PHP 8.x** and **Docker** (Docker only needed if you also want a local DB; not required for the AWS path).
- **AWS Session Manager Plugin** — install instructions in step 3 below.

### 1. Fill in `infra/terraform.tfvars`

Copy the example and edit:
```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

Required values you must set (none of these are baked into the repo, all of
them are either secrets or globally-unique identifiers):

| Variable | What it is | Where it comes from |
|---|---|---|
| `db_password` | RDS master password | **You choose.** Use a strong random string. Treat as a secret. |
| `cognito_domain_prefix` | Hosted-UI subdomain, e.g. `pic2map-dev` | **You choose.** Must be globally unique across all AWS Cognito users — pick something project-specific. |
| `cognito_callback_urls` | OAuth redirect URIs allowed by Cognito | Your real frontend URLs, e.g. `["http://localhost:5173/callback"]` for local. |
| `cognito_logout_urls` | OAuth post-logout URIs | Same shape as above, without the `/callback`. |
| `s3_cors_allowed_origins` | Browser origins allowed to PUT to S3 | Your frontend origins. **Different from logout URLs** — see "Known follow-ups" below. |

`terraform.tfvars` is in `.gitignore` — never commit it. If you need to
share values across machines, use a secret manager (1Password, AWS Secrets
Manager, etc.), not git.

### 2. Provision infrastructure

```bash
tofu init        # first time only
tofu apply
```

Review the plan, type `yes`. First-time apply takes ~10 minutes (RDS is the
slow one). Subsequent applies are seconds.

After apply succeeds, capture the outputs you'll need:
```bash
tofu output
```
You'll see `bastion_instance_id`, `rds_endpoint`, `cognito_user_pool_id`,
`cognito_client_id`, `cognito_domain`, `media_bucket`, etc. Don't paste
these into the README or commit them — they're environment-specific. Keep
the terminal open or write them down somewhere local.

To inspect any of them in the AWS Console:
- **Bastion EC2:** Console → EC2 → Instances → filter `pic2map-bastion-*`.
- **RDS:** Console → RDS → Databases → `pic2map-<env>` → "Connectivity & security" → "Endpoint".
- **Cognito:** Console → Cognito → User pools → `pic2map-<env>`.
- **S3:** Console → S3 → Buckets → `pic2map-media-<env>`.
- **Lambda:** Console → Lambda → Functions → `pic2map-image-processor-<env>`.

### 3. Install the AWS Session Manager Plugin (one-time, per laptop)

The plugin is **free**, open-source, and so is the SSM service it talks to —
no AWS charges for sessions or port-forwarding. Install once and forget.

**Windows (winget — easiest):**
```powershell
winget install Amazon.SessionManagerPlugin
```

**Windows (MSI alternative):**
Download and run `SessionManagerPluginSetup.exe` from
https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html

**macOS / Linux:** see the same docs page — `brew install` or `.deb` / `.rpm`.

Verify (re-open the terminal first so PATH refreshes):
```bash
session-manager-plugin --version
```

### 4. Open the SSM tunnel to RDS

Run this in a **Git Bash** terminal from `infra/`. Leave the terminal
running for as long as you want the tunnel open.

```bash
BASTION=$(tofu output -raw bastion_instance_id)
RDS=$(tofu output -raw rds_endpoint | cut -d: -f1)

aws ssm start-session \
  --target "$BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$RDS\"],\"portNumber\":[\"3306\"],\"localPortNumber\":[\"3307\"]}"
```

Success looks like:
```
Starting session with SessionId: ...
Port 3307 opened for sessionId ...
Waiting for connections...
```

Now `127.0.0.1:3307` on your laptop is bridged to RDS:3306 inside the VPC.
Open every other terminal window separately — this one is dedicated to the
tunnel.

Common errors:
- `TargetNotConnected` — bastion's SSM agent hasn't checked in yet. Wait
  ~30s after `tofu apply` and retry.
- `command not found: tofu` — wrong terminal (use Git Bash, not PowerShell)
  or OpenTofu isn't installed.
- `command not found: session-manager-plugin` — re-open the terminal after
  installing the plugin so PATH refreshes.

### 5. Configure the backend `.env`

```bash
cd backend
cp .env.example .env
```

Set the AWS-mode values (everything else can stay at the local defaults):

```
# Drivers
STORAGE_DRIVER=s3
AUTH_DRIVER=cognito

# Database — point at the SSM tunnel, NOT the RDS endpoint directly
DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=pic2map
DB_USER=pic2map
DB_PASSWORD=<the-db_password-you-chose-in-terraform.tfvars>

# AWS
AWS_REGION=us-east-1
S3_BUCKET=<media_bucket from `tofu output`>
COGNITO_USER_POOL_ID=<cognito_user_pool_id from `tofu output`>
COGNITO_CLIENT_ID=<cognito_client_id from `tofu output`>

# IAM credentials — only if you're not using a profile / role.
# Prefer leaving these blank and using `aws configure` profiles instead.
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
```

Why `127.0.0.1:3307`? The RDS endpoint hostname won't resolve to anything
reachable from your laptop — it's a private DNS name inside the VPC. The
tunnel exposes it as a local port instead.

### 6. Run database migrations

The tunnel must be running for this to work:
```bash
php scripts/migrate.php
```
This connects to `127.0.0.1:3307` per your `.env`, which the tunnel routes
to RDS, which is then provisioned with the schema. Idempotent — safe to
re-run.

### 7. Configure the frontend

```bash
cd frontend/js
cp config.example.js config.js
```

Edit `config.js`:
- `authDriver` → `'cognito'`
- `cognitoRegion` → your AWS region (e.g. `'us-east-1'`)
- `cognitoClientId` → `cognito_client_id` from `tofu output`

The frontend talks to the regional `cognito-idp.<region>.amazonaws.com`
endpoint directly, so the user-pool id and the hosted-UI domain aren't
needed in the static client (the backend still needs `COGNITO_USER_POOL_ID`
in `.env` to verify JWTs).

### 8. Start everything

Three terminals:

| Terminal | Command | Purpose |
|---|---|---|
| 1 | `aws ssm start-session ...` (from step 4) | Holds the RDS tunnel open |
| 2 | `cd backend && php -S localhost:4000 -t public public/router.php` | Backend API |
| 3 | `cd frontend && php -S localhost:5173` | Static frontend |

Open http://localhost:5173. The first registered account is admin.

### Day-to-day: starting and stopping the bastion to save cost

The bastion is a `t3.micro`. AWS Free Tier covers 750 hours/month for the
first 12 months; after that it's ~$7.50/mo if left running. Stop it when
you're done for the day:

```bash
aws ec2 stop-instances --instance-ids "$(tofu output -raw bastion_instance_id)"
```

Start it again before opening the tunnel:
```bash
aws ec2 start-instances --instance-ids "$(tofu output -raw bastion_instance_id)"
```

A stopped instance costs only the EBS root volume (~$0.80/mo). No
`tofu apply` needed for stop/start — they're runtime state.

### Tearing it all down

```bash
cd infra
tofu destroy
```

Will prompt for confirmation. Everything created by `infra/` goes away —
including the RDS instance, so any photos in the DB are deleted (S3 objects
too if the bucket is empty; otherwise you'll need to empty it first).

---

## Known follow-ups (need a decision before next AWS deploy)

These are tracked here so they don't disappear into a single file's comments.

### 1. S3 CORS allowed origins — `infra/s3.tf` + `infra/variables.tf`
`var.s3_cors_allowed_origins` defaults to `["http://localhost:5173"]` for
local development. When deploying to a real domain, set it in
`terraform.tfvars` to **only** the real frontend origin(s) that browser-PUT
to S3 — e.g. `["https://pic2map.example.com"]`. OAuth logout URLs and CORS
origins are independent concerns and should not share a list.

## Troubleshooting: "upload works from the terminal but not from the UI"

Symptom: `aws s3 cp` / `curl -X PUT <presigned-url>` succeeds, but clicking
**Upload** in the browser fails silently or with a red "(failed)" entry in
DevTools → Network. **Almost always S3 CORS.** The browser enforces CORS;
`curl` and the AWS CLI don't, which is exactly this asymmetry.

The browser flow is:
1. `POST /api/photos/presign` → API returns `https://<bucket>.s3.<region>.amazonaws.com/...?X-Amz-...`
2. Browser sends a **CORS preflight `OPTIONS`** to that URL (the request is
   non-simple because `Content-Type: image/jpeg`).
3. Only if the `OPTIONS` response has matching `Access-Control-Allow-Origin`
   does the browser send the actual `PUT`.

If S3 doesn't return matching CORS headers on step 2, the actual PUT never
leaves the browser — you won't see it in CloudTrail or S3 access logs, which
makes this look like "the request just disappeared".

**Diagnose**

Open DevTools → Network and look for an `OPTIONS` request to
`*.s3.*.amazonaws.com`. If it's red / 403 / `(failed) net::ERR_FAILED` and no
`PUT` follows, it's CORS.

Then dump the live config:
```bash
aws s3api get-bucket-cors --bucket <your-bucket>
```
Confirm `PUT` is in `AllowedMethods` and your **exact** frontend origin
(scheme + host + port, no trailing slash) is in `AllowedOrigins`.

**Fix**

1. Set `s3_cors_allowed_origins` in `terraform.tfvars` to the real frontend
   origin(s) — e.g. `["http://localhost:5173", "https://pic2map.example.com"]`.
   `127.0.0.1` and `localhost` are *different* origins; list both if you use
   both. No trailing slashes.
2. `terraform apply`.
3. **Hard-reload** the browser. The CORS preflight is cached per
   `max_age_seconds` (currently 3000 s in `infra/s3.tf`); a soft reload will
   keep using the stale "denied" answer until that expires.

**Other things to rule out (much less likely once CORS is verified)**

- **Mixed content**: page on `https://`, presigned URL on `http://`. Browsers
  silently block this. The repo always builds `https://...amazonaws.com`, so
  this only happens if something downstream rewrote the URL.
- **Wrong region in the host**: a presigned URL signed for region X but
  pointing at `<bucket>.s3.<Y>.amazonaws.com` returns 301 + a CORS-less body
  on `OPTIONS`. Make sure `AWS_REGION` on the API matches the bucket's
  region.
- **Adblockers / privacy extensions** that strip the `Origin` header on
  cross-origin uploads. Try an incognito window with extensions disabled.
- **Content-Type signature mismatch**: NOT a problem in this repo —
  `Sigv4.php` only signs the `host` header (`X-Amz-SignedHeaders=host`), so
  the browser's `Content-Type` is free to be anything.

## Implementation notes

A few design decisions that aren't obvious from reading any single file:

- **AWS credentials.** `backend/src/AwsCredentials.php` resolves credentials
  in the standard SDK order (env → ECS task metadata → EC2 IMDSv2), so the
  IAM role from `infra/iam.tf` is picked up automatically without needing
  static keys in `.env`.
- **Storage driver auto-detect** (`backend/src/Storage.php`) flips to `s3`
  when `S3_BUCKET` is set and any IAM-role indicator is present
  (`AWS_CONTAINER_CREDENTIALS_*`, `AWS_EXECUTION_ENV`); otherwise it falls
  back to the local filesystem. Set `STORAGE_DRIVER` explicitly to override.
- **Photo lifecycle states** are tracked in two independent columns:
  `process_state` (`UPLOADED → PROCESSING → READY | FAILED`) is the
  pipeline's view; `status` (`PENDING | APPROVED | REJECTED`) is the
  moderator's. The map and search show `PUBLIC` photos in any non-`REJECTED`
  state, so on installs without an active moderation queue the default
  behaviour is "public means visible".
- **Moderation log** (`moderation_actions`) keeps `photo_id` nullable with
  `ON DELETE SET NULL`, so a moderator's `DELETE` action and its reason
  survive the photo it referenced. Every action gets a row — there is no
  special case.
- **Cognito hosted-UI domain prefix** lives in a global per-region namespace
  shared across all AWS accounts, so it has to be an explicit
  `cognito_domain_prefix` variable rather than a derived default. Pick
  something project-specific in `terraform.tfvars`.
