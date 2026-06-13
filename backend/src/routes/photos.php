<?php
declare(strict_types=1);

/** Photo CRUD + presigned upload + GPS editing — port of backend/src/routes/photos.ts. */
return function (Router $r): void {
    $PHOTO_COLS = "p.id, p.owner_id, p.title, p.description,
        p.s3_key_original, p.s3_key_thumb, p.s3_key_medium, p.s3_key_large,
        p.content_type, p.size_bytes, p.width, p.height,
        p.latitude, p.longitude, p.captured_at, p.visibility,
        p.status, p.process_state, p.process_error, p.created_at, p.updated_at,
        u.username AS owner_username, u.email AS owner_email";

    $ownedPhoto = function (string $id, array $user): array {
        $p = Db::one('SELECT * FROM photos WHERE id = ?', [$id]);
        if (!$p) throw new HttpError(404, 'Photo not found');
        if ($p['owner_id'] !== $user['id'] && $user['role'] !== 'ADMIN') throw new HttpError(403, 'Not the owner');
        return $p;
    };

    /* ---- 1. request a presigned upload URL --------------------------------
       Browser PUTs the original to S3 under originals/{userId}/{photoId}.{ext}
       The S3 ObjectCreated event then triggers the image-processor Lambda,
       which generates thumb/medium/large + extracts EXIF GPS and updates the DB. */
    $r->post('/photos/presign', function () {
        $user = Auth::authenticate();
        $body = Http::body();
        $filename = Http::requireString($body, 'filename');
        $contentType = Http::requireString($body, 'contentType');
        if (!preg_match('#^image/(jpe?g|png|webp|tiff?|heic)$#i', $contentType)) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['contentType' => ['Unsupported image content type']]]);
        }
        $title = Http::optionalString($body, 'title', 200);

        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION) ?: 'jpg');
        $photoId = Uuid::v4();
        $key = "originals/{$user['id']}/$photoId.$ext";

        Db::exec(
            "INSERT INTO photos (id, owner_id, title, s3_key_original, content_type, process_state)
             VALUES (?,?,?,?,?,'UPLOADED')",
            [$photoId, $user['id'], $title ?? $filename, $key, $contentType]
        );

        Http::json(['photoId' => $photoId, 'key' => $key, 'uploadUrl' => Storage::presignUpload($key, $contentType, $photoId)], 201);
    });

    /* ---- 2. personal gallery (own photos, any status) -------------------- */
    $r->get('/photos', function () use ($PHOTO_COLS) {
        $user = Auth::authenticate();
        $rows = Db::query(
            "SELECT $PHOTO_COLS FROM photos p JOIN users u ON u.id = p.owner_id
             WHERE p.owner_id = ? ORDER BY p.created_at DESC",
            [$user['id']]
        );
        Http::json(['photos' => Serialize::photos($rows)]);
    });

    /* ---- 3. single photo (owner OR public OR privileged) ----------------- */
    $r->get('/photos/:id', function (array $params) use ($PHOTO_COLS) {
        $user = Auth::authenticate();
        $p = Db::one("SELECT $PHOTO_COLS FROM photos p JOIN users u ON u.id=p.owner_id WHERE p.id = ?", [$params['id']]);
        if (!$p) throw new HttpError(404, 'Photo not found');
        $privileged = $user['role'] !== 'USER';
        if ($p['owner_id'] !== $user['id'] && $p['visibility'] !== 'PUBLIC' && !$privileged) {
            throw new HttpError(403, 'Not allowed');
        }
        Http::json(['photo' => Serialize::photo($p)]);
    });

    /* ---- 4. update title/description/visibility -------------------------- */
    $r->patch('/photos/:id', function (array $params) use ($ownedPhoto) {
        $user = Auth::authenticate();
        $ownedPhoto($params['id'], $user);
        $body = Http::body();
        $title = Http::optionalString($body, 'title', 200);
        $description = array_key_exists('description', $body) ? Http::optionalString($body, 'description', 2000) : null;
        $visibility = Http::optionalEnum($body, 'visibility', ['PUBLIC', 'PRIVATE']);

        Db::exec(
            'UPDATE photos SET title = COALESCE(?, title), description = COALESCE(?, description), visibility = COALESCE(?, visibility) WHERE id = ?',
            [$title, $description, $visibility, $params['id']]
        );
        $updated = Db::one('SELECT * FROM photos WHERE id = ?', [$params['id']]);
        Http::json(['photo' => Serialize::photo($updated)]);
    });

    /* ---- 5. GPS editing: add / modify / remove --------------------------- */
    $r->put('/photos/:id/gps', function (array $params) use ($ownedPhoto) {
        $user = Auth::authenticate();
        $ownedPhoto($params['id'], $user);
        $body = Http::body();
        $latPresent = $lngPresent = false;
        $latitude = Http::nullableFloat($body, 'latitude', -90, 90, $latPresent);
        $longitude = Http::nullableFloat($body, 'longitude', -180, 180, $lngPresent);
        if (!$latPresent || !$lngPresent) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['latitude' => ['latitude and longitude are required (use null to clear)']]]);
        }
        if (($latitude === null) !== ($longitude === null)) {
            throw new HttpError(400, 'latitude and longitude must both be set or both null');
        }

        Db::exec('UPDATE photos SET latitude = ?, longitude = ? WHERE id = ?', [$latitude, $longitude, $params['id']]);
        $updated = Db::one('SELECT * FROM photos WHERE id = ?', [$params['id']]);
        Http::json(['photo' => Serialize::photo($updated)]);
    });

    /* ---- 6. delete (also removes all S3 derivatives) --------------------- */
    $r->delete('/photos/:id', function (array $params) use ($ownedPhoto) {
        $user = Auth::authenticate();
        $p = $ownedPhoto($params['id'], $user);
        Storage::deleteObject($p['s3_key_original']);
        Storage::deleteObject($p['s3_key_thumb']);
        Storage::deleteObject($p['s3_key_medium']);
        Storage::deleteObject($p['s3_key_large']);
        Db::exec('DELETE FROM photos WHERE id = ?', [$params['id']]);
        Http::noContent();
    });
};
