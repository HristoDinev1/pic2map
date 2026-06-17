<?php
declare(strict_types=1);

/** Album CRUD + photo membership — port of backend/src/routes/albums.ts. */
return function (Router $r): void {
    $ownAlbum = function (string $id, array $user): array {
        $a = Db::one('SELECT * FROM albums WHERE id = ?', [$id]);
        if (!$a) throw new HttpError(404, 'Album not found');
        if ($a['owner_id'] !== $user['id'] && $user['role'] !== 'ADMIN') throw new HttpError(403, 'Not the owner');
        return $a;
    };

    $parseAlbumBody = function (array $body, bool $partial): array {
        $name = $partial ? Http::optionalString($body, 'name', 120) : Http::requireString($body, 'name', 120);
        $description = array_key_exists('description', $body) ? Http::optionalString($body, 'description', 1000) : null;
        $visibility = Http::optionalEnum($body, 'visibility', ['PUBLIC', 'PRIVATE']);
        return [$name, $description, $visibility];
    };

    // list own albums (+ photo counts)
    $r->get('/albums', function () {
        $user = Auth::authenticate();
        $albums = Db::query(
            'SELECT a.*, COUNT(ap.photo_id) AS photo_count
             FROM albums a LEFT JOIN album_photos ap ON ap.album_id = a.id
             WHERE a.owner_id = ?
             GROUP BY a.id ORDER BY a.created_at DESC',
            [$user['id']]
        );
        foreach ($albums as &$a) $a['photo_count'] = (int) $a['photo_count'];
        Http::json(['albums' => $albums]);
    });

    // create
    $r->post('/albums', function () use ($parseAlbumBody) {
        $user = Auth::authenticate();
        [$name, $description, $visibility] = $parseAlbumBody(Http::body(), false);
        $id = Uuid::v4();
        Db::exec(
            'INSERT INTO albums (id, owner_id, name, description, visibility) VALUES (?,?,?,?,?)',
            [$id, $user['id'], $name, $description, $visibility ?? 'PRIVATE']
        );
        Http::json(['album' => Db::one('SELECT * FROM albums WHERE id = ?', [$id])], 201);
    });

    // get album + its photos
    $r->get('/albums/:id', function (array $params) {
        $user = Auth::authenticate();
        $a = Db::one('SELECT * FROM albums WHERE id = ?', [$params['id']]);
        if (!$a) throw new HttpError(404, 'Album not found');
        $privileged = $user['role'] !== 'USER';
        if ($a['owner_id'] !== $user['id'] && $a['visibility'] !== 'PUBLIC' && !$privileged) {
            throw new HttpError(403, 'Not allowed');
        }
        $rows = Db::query(
            'SELECT p.*, u.username AS owner_username, u.email AS owner_email
             FROM album_photos ap
             JOIN photos p ON p.id = ap.photo_id
             JOIN users u ON u.id = p.owner_id
             WHERE ap.album_id = ? ORDER BY ap.added_at DESC',
            [$params['id']]
        );
        Http::json(['album' => $a, 'photos' => Serialize::photos($rows)]);
    });

    // edit
    $r->patch('/albums/:id', function (array $params) use ($ownAlbum, $parseAlbumBody) {
        $user = Auth::authenticate();
        $ownAlbum($params['id'], $user);
        [$name, $description, $visibility] = $parseAlbumBody(Http::body(), true);
        Db::exec(
            'UPDATE albums SET name = COALESCE(?, name), description = COALESCE(?, description), visibility = COALESCE(?, visibility) WHERE id = ?',
            [$name, $description, $visibility, $params['id']]
        );
        Http::json(['album' => Db::one('SELECT * FROM albums WHERE id = ?', [$params['id']])]);
    });

    // delete
    $r->delete('/albums/:id', function (array $params) use ($ownAlbum) {
        $user = Auth::authenticate();
        $ownAlbum($params['id'], $user);
        Db::exec('DELETE FROM albums WHERE id = ?', [$params['id']]);
        Http::noContent();
    });

    // add photo to album
    $r->post('/albums/:id/photos', function (array $params) use ($ownAlbum) {
        $user = Auth::authenticate();
        $ownAlbum($params['id'], $user);
        $body = Http::body();
        $photoId = Http::requireString($body, 'photoId');
        if (!Uuid::isValid($photoId)) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['photoId' => ['must be a UUID']]]);
        }
        $photo = Db::one('SELECT id FROM photos WHERE id = ? AND owner_id = ?', [$photoId, $user['id']]);
        if (!$photo) throw new HttpError(404, 'Photo not found or not yours');
        Db::exec(
            'INSERT IGNORE INTO album_photos (album_id, photo_id) VALUES (?,?)',
            [$params['id'], $photoId]
        );
        Http::json(['ok' => true], 201);
    });

    // remove photo from album
    $r->delete('/albums/:id/photos/:photoId', function (array $params) use ($ownAlbum) {
        $user = Auth::authenticate();
        $ownAlbum($params['id'], $user);
        Db::exec('DELETE FROM album_photos WHERE album_id = ? AND photo_id = ?', [$params['id'], $params['photoId']]);
        Http::noContent();
    });

    // download album as a ZIP of original photos (+ manifest.json).
    // Owner gets it always; other users only if the album is PUBLIC; admins/mods always.
    $r->get('/albums/:id/download', function (array $params) {
        $user = Auth::authenticate();
        $a = Db::one('SELECT * FROM albums WHERE id = ?', [$params['id']]);
        if (!$a) throw new HttpError(404, 'Album not found');
        $privileged = $user['role'] !== 'USER';
        if ($a['owner_id'] !== $user['id'] && $a['visibility'] !== 'PUBLIC' && !$privileged) {
            throw new HttpError(403, 'Not allowed');
        }
        if (!class_exists('ZipArchive')) throw new HttpError(500, 'Server is missing ZipArchive');

        $rows = Db::query(
            "SELECT p.id, p.title, p.s3_key_original, p.content_type, p.captured_at, p.latitude, p.longitude, p.created_at
             FROM album_photos ap
             JOIN photos p ON p.id = ap.photo_id
             WHERE ap.album_id = ? AND p.process_state = 'READY'
             ORDER BY ap.added_at DESC",
            [$params['id']]
        );
        if (!$rows) throw new HttpError(404, 'Album has no downloadable photos');

        $tmpZip = tempnam(sys_get_temp_dir(), 'pic2map-album-');
        $zip = new ZipArchive();
        if ($zip->open($tmpZip, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            @unlink($tmpZip);
            throw new HttpError(500, 'Could not create zip');
        }

        $sideFiles = [];   // S3 driver writes objects to disk first; we delete after sending
        $usedNames = [];
        $manifest  = [];
        foreach ($rows as $i => $row) {
            $key = $row['s3_key_original'] ?? null;
            if (!$key) continue;
            $ext  = album_zip_pick_extension($key, $row['content_type']);
            $base = album_zip_safe_filename($row['title'] ?: 'photo');
            $name = $base . $ext;
            if (isset($usedNames[$name])) $name = $base . '-' . ($i + 1) . $ext; // dedupe within the zip
            $usedNames[$name] = true;

            $added = false;
            if (Storage::driver() === 'local') {
                $path = Storage::localPath($key);
                if (is_file($path)) { $zip->addFile($path, $name); $added = true; }
            } else {
                $url = S3::presignDownload($key);
                if ($url) {
                    $tmp = tempnam(sys_get_temp_dir(), 'pic2map-obj-');
                    if (album_zip_download_to($url, $tmp)) {
                        $zip->addFile($tmp, $name);
                        $sideFiles[] = $tmp;
                        $added = true;
                    } else {
                        @unlink($tmp);
                    }
                }
            }
            if ($added) {
                $manifest[] = [
                    'file' => $name,
                    'title' => $row['title'],
                    'capturedAt' => $row['captured_at'],
                    'uploadedAt' => $row['created_at'],
                    'latitude' => $row['latitude'] !== null ? (float) $row['latitude'] : null,
                    'longitude' => $row['longitude'] !== null ? (float) $row['longitude'] : null,
                ];
            }
        }

        $zip->addFromString('manifest.json', json_encode([
            'album' => $a['name'],
            'description' => $a['description'],
            'exportedAt' => gmdate('c'),
            'count' => count($manifest),
            'photos' => $manifest,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        $zip->close();

        $filename = album_zip_safe_filename($a['name'] ?: 'album') . '.zip';
        $size = filesize($tmpZip);

        // Unbuffered output — large albums shouldn't be held in memory.
        while (ob_get_level() > 0) ob_end_clean();
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        if ($size !== false) header('Content-Length: ' . $size);
        readfile($tmpZip);

        @unlink($tmpZip);
        foreach ($sideFiles as $f) @unlink($f);
        exit;
    });
};

/** Filesystem-safe filename (no slashes, no control chars, trimmed/limited). */
function album_zip_safe_filename(string $name): string
{
    $name = trim(preg_replace('/[\/\\\\\x00-\x1F\x7F"*?:<>|]+/', '_', $name));
    if ($name === '' || $name === '.' || $name === '..') $name = 'photo';
    if (mb_strlen($name) > 80) $name = mb_substr($name, 0, 80);
    return $name;
}

/** Best-effort file extension: prefer the stored key's, fall back to MIME → ext. */
function album_zip_pick_extension(string $key, ?string $contentType): string
{
    $ext = pathinfo($key, PATHINFO_EXTENSION);
    if ($ext !== '' && preg_match('/^[A-Za-z0-9]{1,5}$/', $ext)) return '.' . strtolower($ext);
    return match (strtolower((string) $contentType)) {
        'image/jpeg', 'image/jpg' => '.jpg',
        'image/png'               => '.png',
        'image/webp'              => '.webp',
        'image/heic', 'image/heif' => '.heic',
        'image/gif'               => '.gif',
        'image/tiff'              => '.tiff',
        default                   => '.bin',
    };
}

/** Download $url into $destPath; true on success. Uses cURL when available. */
function album_zip_download_to(string $url, string $destPath): bool
{
    if (function_exists('curl_init')) {
        $fp = fopen($destPath, 'wb');
        if (!$fp) return false;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_FAILONERROR => true,
        ]);
        $ok = curl_exec($ch);
        curl_close($ch);
        fclose($fp);
        return (bool) $ok;
    }
    $bytes = @file_get_contents($url);
    if ($bytes === false) return false;
    return file_put_contents($destPath, $bytes) !== false;
}
