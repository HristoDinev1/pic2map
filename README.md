# PIC2MAP — изпитен проект

Христо Динев - 3MI0600383
Вая Яндина - 5MI0600284
Валентина Петрова - 7MI0600307

## Описание

Уеб приложение за качване на снимки, което автоматично извлича GPS координатите от EXIF данните на изображението и ги показва като маркери върху интерактивна карта. Поддържа потребителски акаунти, лична галерия, албуми, търсене и редакция на местоположение чрез избор върху картата.

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

Edit `config.js` and set the Cognito values from `tofu output`:
- `userPoolId` ← `cognito_user_pool_id`
- `clientId` ← `cognito_client_id`
- `domain` ← `cognito_domain`

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

## Recent fixes (us-east-1-dev, 2026-06-12)

Audit pass over the branch surfaced and fixed:
- `backend/src/AwsCredentials.php` was dead code; `S3.php` and `Cognito.php`
  now resolve credentials through it (env → ECS metadata → EC2 IMDSv2), so
  the IAM role provisioned in `infra/iam.tf` is actually used.
- `Storage::driver()` auto-detect was tied to a static `AWS_ACCESS_KEY_ID`,
  so IAM-role hosts silently fell back to `local`. It now flips to `s3` when
  `S3_BUCKET` is set and any IAM-role indicator (`AWS_CONTAINER_CREDENTIALS_*`,
  `AWS_EXECUTION_ENV`) is present.
- Frontend was checking `processState === 'ERROR'` but the DB enum is
  `'FAILED'` — this affected upload polling, the gallery's auto-refresh, and
  the photo-card badge. Fixed in `pages/upload.js`, `pages/gallery.js`,
  `components/photo-card.js`.
- `routes/moderation.php` called `S3::deleteObject` directly (crashed under
  the local driver) and inserted into `moderation_actions` after the photo
  was deleted in the same tx (FK violation). Rewritten.
- `routes/admin.php` deleted the photo row but orphaned the storage objects.
- `frontend/js/main.js` checked `cognito.isSignedIn()` even under
  `AUTH_DRIVER=local`. Switched to the driver-aware `auth` facade.
- `.gitignore`: added `.idea/`, `backend/.app-secret`, `backend/storage/`.
- `docker-compose.yml`: MariaDB bound to `127.0.0.1:3306` (was `0.0.0.0`).
- `infra/cognito.tf`: hosted-UI domain prefix is now an explicit required
  variable (`cognito_domain_prefix`) instead of `${project}-${environment}`,
  which lived in the global Cognito-prefix namespace and was non-deterministic
  across machines. Set `cognito_domain_prefix = "pic2map-dev"` in
  `terraform.tfvars` to keep the existing claim — see `terraform.tfvars.example`.
- `moderation_actions.photo_id` is now `NULL` with `ON DELETE SET NULL` (was
  `NOT NULL` + `ON DELETE CASCADE`), so DELETE actions and their reasons are
  recorded too. `routes/moderation.php` now inserts a moderation_actions row
  unconditionally — the special-case for DELETE is gone. `migrate.php` upgrades
  existing databases idempotently.
