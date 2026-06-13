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
};
