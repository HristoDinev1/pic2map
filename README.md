# PIC2MAP

Upload, process, manage and visualize geotagged photographs on an interactive
OpenStreetMap. Cloud-native on AWS, with user accounts, albums, public/private
visibility, GPS editing, RBAC and a serverless image-processing pipeline.

```
┌──────────────┐   presigned PUT    ┌──────────────┐  ObjectCreated  ┌──────────────────┐
│  React SPA   │ ─────────────────▶ │   Amazon S3  │ ───────────────▶│  Lambda          │
│ (Vite+Leaflet)│                   │ originals/   │                 │ image-processor  │
│              │ ◀── JSON/REST ──┐  │ thumbs/ …    │ ◀── derivatives │ • EXIF/GPS        │
└──────┬───────┘                 │  └──────────────┘                 │ • sharp resize    │
       │ Cognito ID token (JWT)  │                                   └────────┬─────────┘
       ▼                         │                                            │ UPDATE
┌──────────────┐   verify JWKS   │       ┌──────────────────────────────────▼─────────┐
│ Amazon Cognito│◀───────────────┘       │   Amazon RDS PostgreSQL (users/photos/…)     │
└──────────────┘                         └──────────────────▲───────────────────────────┘
                ┌──────────────┐  SQL                       │
                │ Express REST │ ───────────────────────────┘   CloudWatch logs + alarms
                │   API (TS)   │
                └──────────────┘
```

## Tech stack
| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind, **react-leaflet** (OpenStreetMap), AWS Amplify (Cognito) |
| Backend | Node.js + **Express** + TypeScript REST API, `pg`, Zod validation, Pino logging |
| Auth | **Amazon Cognito** (sign-up, sign-in, password recovery, JWT); groups → roles |
| Storage | **Amazon S3** (originals + thumb/medium/large) |
| Processing | **AWS Lambda** (`exifr` GPS/EXIF extraction + `sharp` resize), S3-triggered |
| Database | **Amazon RDS PostgreSQL** |
| Infra | **OpenTofu** (VPC, S3, RDS, Cognito, Lambda, IAM, CloudWatch) |

## Roles (Cognito groups → app roles)
- **USER** — upload, edit own photos, manage albums, view public photos.
- **MODERATOR** (`Moderators` group) — review queue, approve/reject/remove.
- **ADMIN** (`Administrators` group) — manage users & roles, remove any content, view stats.

## Repository layout
```
infra/      OpenTofu IaC for all AWS resources
backend/    Express REST API (TypeScript) + SQL schema
lambda/     S3-triggered image-processor (EXIF + thumbnails)
frontend/   React SPA (map, gallery, albums, search, admin)
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
cd backend && cp .env.example .env   # set DATABASE_URL to the RDS endpoint
npm install && npm run migrate
```

## 3. Backend API
```bash
cd backend
# fill .env with AWS_REGION, S3_BUCKET, COGNITO_* from tofu output
npm run dev        # http://localhost:4000
```

## 4. Frontend
```bash
cd frontend && cp .env.example .env   # set VITE_COGNITO_* + VITE_API_BASE
npm install && npm run dev            # http://localhost:5173
```

## Local development (DB only)
```bash
docker compose up -d           # Postgres on :5432
cd backend && npm run migrate && npm run dev
```

## Image / GPS pipeline
1. Browser asks the API for a **presigned S3 PUT URL** (`POST /photos/presign`)
   and uploads the original directly to `originals/{userId}/{photoId}.ext`.
2. The S3 `ObjectCreated` event triggers the **image-processor Lambda**, which:
   extracts GPS lat/lng + capture date via `exifr`, generates `thumb`/`medium`/`large`
   with `sharp`, uploads them, and updates the `photos` row in RDS.
3. The map (`GET /map/photos`) renders markers from rows that have coordinates.
   Users can add/modify/remove GPS later via `PUT /photos/:id/gps`.

## Security
- All API routes verify the Cognito **ID token signature** against the pool JWKS
  (`aws-jwt-verify`) and enforce role rank in `requireRole`.
- S3 bucket is fully private; the browser only ever sees presigned or CDN URLs.
- RDS lives in private subnets; only the Lambda SG and app SG may reach :5432.
- IAM grants least-privilege (S3 object ops, scoped Cognito admin actions).

See `API.md` for the full endpoint reference.
