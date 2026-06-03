# PIC2MAP REST API

All endpoints require `Authorization: Bearer <Cognito ID token>` unless noted.
Base path: `/api`.

## Auth
- `GET  /auth/me` — current synced profile.

## Photos
- `POST   /photos/presign` — `{filename, contentType, title?}` → `{photoId, uploadUrl}` (PUT original to S3).
- `GET    /photos` — own gallery (any status).
- `GET    /photos/:id` — owner | public | privileged.
- `PATCH  /photos/:id` — `{title?, description?, visibility?}`.
- `PUT    /photos/:id/gps` — `{latitude, longitude}` or `{null,null}` to remove.
- `DELETE /photos/:id` — delete photo + all S3 derivatives.

## Albums
- `GET /albums` · `POST /albums` · `GET /albums/:id` · `PATCH /albums/:id` · `DELETE /albums/:id`
- `POST /albums/:id/photos` `{photoId}` · `DELETE /albums/:id/photos/:photoId`

## Map
- `GET /map/photos?minLat&minLng&maxLat&maxLng` — geotagged public+approved + own.

## Search
- `GET /search?username&album&title&dateFrom&dateTo&minLat&minLng&maxLat&maxLng`

## Moderation (MODERATOR+)
- `GET /moderation/queue`
- `POST /moderation/photos/:id` `{action: APPROVE|REJECT|DELETE, reason?}`

## Admin (ADMIN)
- `GET   /admin/stats`
- `GET   /admin/users`
- `PATCH /admin/users/:id/role` `{role}`
- `PATCH /admin/users/:id/active` `{active}`
- `DELETE /admin/photos/:id`

## Import / Export
- `GET  /transfer/export.json`
- `GET  /transfer/export.csv`
- `POST /transfer/import` (multipart `file`: .json or .csv)
