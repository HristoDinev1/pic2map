# PIC2MAP

Upload, process, manage and visualize geotagged photographs on an interactive
map. User accounts, albums, public/private visibility, GPS editing, RBAC and a
serverless image-processing pipeline — built entirely on **PHP, MySQL/MariaDB
and vanilla HTML/CSS/JS** (AWS is used only for storage/auth/processing, called
directly over signed HTTPS — no SDKs, no Node, no frameworks).

```
┌──────────────┐   presigned PUT    ┌──────────────┐  ObjectCreated  ┌──────────────────┐
│ Vanilla HTML/ │ ─────────────────▶ │   Amazon S3  │ ───────────────▶│  Lambda          │
│ CSS/JS SPA   │                    │ originals/   │                 │ image-processor  │
│ (custom map) │ ◀── JSON/REST ──┐  │ thumbs/ …    │ ◀── derivatives │ • EXIF/GPS        │
└──────┬───────┘                 │  └──────────────┘                 │ • sharp resize    │
       │ Cognito ID token (JWT)  │                                   └────────┬─────────┘
       ▼                         │                                            │ UPDATE
┌──────────────┐   verify JWKS   │       ┌──────────────────────────────────▼─────────┐
│ Amazon Cognito│◀───────────────┘       │   MySQL / MariaDB (users/photos/…)           │
└──────────────┘                         └──────────────────▲───────────────────────────┘
                ┌──────────────┐  SQL (PDO)                 │
                │  PHP REST    │ ───────────────────────────┘   CloudWatch logs + alarms
                │  API         │
                └──────────────┘
```

## Tech stack
| Layer | Choice |
|---|---|
| Frontend | Plain **HTML / CSS / vanilla JavaScript** (ES modules, no build step, no framework) — hand-rolled hash router, DOM helpers, and a from-scratch slippy-map widget (OpenStreetMap raster tiles, Web-Mercator projection, drag/zoom, marker clustering — no Leaflet/Google Maps) |
| Backend | **PHP** (no framework) — front-controller + tiny regex router, **PDO** (`pdo_mysql`) for MySQL/MariaDB |
| Auth | **Amazon Cognito** — sign-up/sign-in/recovery via direct JSON calls to the Cognito Identity Provider API (`USER_PASSWORD_AUTH`); the API verifies the ID token (RS256/JWKS) by hand with `openssl`, no `aws-jwt-verify`; groups → roles |
| Storage | **Amazon S3** — the PHP backend signs presigned PUT/GET/DELETE URLs itself with a hand-written **AWS Signature V4** implementation (`hash_hmac`/`hash`), no AWS SDK |
| Processing | **AWS Lambda** (`exifr` GPS/EXIF extraction + `sharp` resize), S3-triggered |
| Database | **MySQL / MariaDB** |
| Infra | **OpenTofu** (VPC, S3, RDS/MariaDB, Cognito, Lambda, IAM, CloudWatch) |

> External AWS services (Cognito/S3/Lambda) are kept by explicit agreement —
> everything that talks to them is hand-written against the raw HTTPS APIs
> (SigV4 signing, JWT verification, Cognito JSON API) using only PHP's built-in
> `curl`/`openssl`/`hash` extensions, so no third-party SDK or library is
> required to run the project.

## Roles (Cognito groups → app roles)
- **USER** — upload, edit own photos, manage albums, view public photos.
- **MODERATOR** (`Moderators` group) — review queue, approve/reject/remove.
- **ADMIN** (`Administrators` group) — manage users & roles, remove any content, view stats.

## Repository layout
```
infra/      OpenTofu IaC for all AWS resources
backend/    PHP REST API (front controller + PDO) and SQL schema
lambda/     S3-triggered image-processor (EXIF + thumbnails)
frontend/   Static HTML/CSS/vanilla-JS SPA (map, gallery, albums, search, admin)
```

## 1. Provision AWS (OpenTofu)
```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # set db_password etc.
tofu init
tofu apply
tofu output            # → bucket, RDS endpoint, Cognito IDs
```
> The Lambda zip bundles `node_modules`. In CI, run `npm ci` inside
> `lambda/image-processor` (with a linux-x64 `sharp` binary) **before** `tofu apply`.

## 2. Database schema
```bash
cd backend && cp .env.example .env   # set DB_HOST/DB_NAME/... to your MySQL/MariaDB instance
php scripts/migrate.php
```

## 3. Backend API
```bash
cd backend
# fill .env with AWS_REGION, S3_BUCKET, COGNITO_* from tofu output
php -S localhost:4000 -t public public/router.php   # http://localhost:4000
```

## 4. Frontend
No build step — it's static HTML/CSS/JS. Just provide runtime config and serve the folder:
```bash
cd frontend/js && cp config.example.js config.js   # set apiBase + cognitoRegion/cognitoClientId
cd .. && php -S localhost:5173                      # http://localhost:5173
```
(Any static file server works — Apache, nginx, `python -m http.server`, etc.
The app can even be opened from `file://` if `apiBase` points at a CORS-enabled API.)

## Frontend tests
Zero-dependency suite using Node's built-in `node:test` runner and a hand-written DOM stub (no jsdom, no npm installs):
```bash
cd frontend && npm test        # node --test "test/**/*.test.js"
```
Covers: map projection math + clustering + fit-to-bounds, the hand-written EXIF GPS parser, the dom helper + hash router, and an end-to-end upload-page test that drives the real upload button against stubbed `fetch`/`XMLHttpRequest` (presign → S3 PUT with progress → processing poll → "Ready" state, plus failure/retry and non-image rejection paths).

## Local development — fully self-hosted (no AWS)
The app now ships with **local drivers** for everything AWS used to do, selected
via env (`AUTH_DRIVER` / `STORAGE_DRIVER`, default `auto` → local when no real
AWS values are configured):

| Concern        | AWS driver (original)         | Local driver (new)                                   |
|----------------|-------------------------------|------------------------------------------------------|
| Accounts/login | Cognito (RS256 JWT)           | `/auth/register|login|refresh`, `password_hash`, hand-rolled HMAC tokens (`Token.php`) |
| File storage   | S3 presigned PUT/GET          | signed upload + `/media/…` URLs served by the backend (`Storage.php`) |
| GPS+thumbnails | image-processor Lambda        | PHP `exif_read_data` + GD, synchronous on upload (`ImageProcessor.php`) |

```bash
docker compose up -d                 # MariaDB on :3306 (or any local MySQL/MariaDB)
cd backend && cp .env.example .env   # defaults are local-mode ready
php scripts/migrate.php              # idempotent — safe to re-run
PHP_CLI_SERVER_WORKERS=4 php -S localhost:4000 -t public public/router.php
# frontend: cd frontend/js && cp config.example.js config.js   (authDriver: 'local')
#           cd .. && php -S localhost:5173
```
The first account registered becomes ADMIN. Switch any driver back to AWS by
filling in the AWS values in `.env` (backend) and `cognito*` in `config.js`.

## Image / GPS pipeline
1. Browser asks the API for a **presigned S3 PUT URL** (`POST /photos/presign`,
   signed server-side with a hand-rolled SigV4 implementation — `backend/src/Sigv4.php` /
   `S3.php`) and uploads the original directly to `originals/{userId}/{photoId}.ext`.
2. **Instant geotag (browser):** before/while uploading, the frontend reads the
   photo's EXIF GPS itself (`frontend/js/exif.js`, a hand-written JPEG/TIFF EXIF
   parser — no library) and, right after the S3 PUT, pushes the coordinates via
   `PUT /photos/:id/gps`. Geotagged photos therefore appear on the map
   immediately, without waiting on (or even requiring) the Lambda.
3. The S3 `ObjectCreated` event triggers the **image-processor Lambda**, which:
   extracts GPS lat/lng + capture date via `exifr` (server-side fallback/confirmation),
   generates `thumb`/`medium`/`large`
   with `sharp`, uploads them, and updates the `photos` row in the database.
4. The map (`GET /map/photos`) renders markers from rows that have coordinates,
   drawn by the custom map widget (`frontend/js/map/custom-map.js`) — raw OSM
   tiles positioned with hand-written Web-Mercator projection math, no map library.
   Users can add/modify/remove GPS later via `PUT /photos/:id/gps`.

## Security
- All API routes verify the Cognito **ID token signature** against the pool JWKS
  by hand (`backend/src/Cognito.php::verifyIdToken` — JWK→PEM conversion + `openssl_verify`,
  no `aws-jwt-verify`) and enforce role rank in `Auth::requireRole`.
- S3 bucket is fully private; the browser only ever sees presigned or CDN URLs,
  generated by the backend's own SigV4 signer (`backend/src/Sigv4.php`).
- RDS/MariaDB lives in private subnets; only the Lambda SG and app SG may reach it.
- IAM grants least-privilege (S3 object ops, scoped Cognito admin actions).
- All SQL access goes through PDO **prepared statements** (parameterized queries).

See `API.md` for the full endpoint reference.
