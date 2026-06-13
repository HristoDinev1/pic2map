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
