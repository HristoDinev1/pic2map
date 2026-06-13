<?php
declare(strict_types=1);

/**
 * Unified search — port of backend/src/routes/search.ts.
 * Optional query params: username, album, title, dateFrom, dateTo,
 * minLat,minLng,maxLat,maxLng (GPS area). Visibility rule: PUBLIC and not
 * REJECTED, OR owned by the caller. (REJECTED is the moderator's "hide it"
 * verdict — PENDING and APPROVED are both visible so public uploads work
 * out of the box on installs without an active moderation queue.)
 */
return function (Router $r): void {
    $r->get('/search', function () {
        $user = Auth::authenticate();
        $username = Http::query('username');
        $album = Http::query('album');
        $title = Http::query('title');
        $dateFrom = Http::query('dateFrom');
        $dateTo = Http::query('dateTo');
        $minLat = Http::query('minLat');
        $minLng = Http::query('minLng');
        $maxLat = Http::query('maxLat');
        $maxLng = Http::query('maxLng');

        $params = [$user['id']];
        $where = ["((p.visibility='PUBLIC' AND p.status <> 'REJECTED') OR p.owner_id = ?)"];

        if ($username) {
            // The "username" field accepts a username OR an email — accounts
            // created via the new email-as-username flow store the same value
            // in both columns, but legacy accounts may differ.
            $where[] = '(u.username LIKE ? OR u.email LIKE ?)';
            $params[] = "%$username%";
            $params[] = "%$username%";
        }
        if ($title)    { $where[] = 'p.title LIKE ?'; $params[] = "%$title%"; }
        if ($dateFrom) { $where[] = 'COALESCE(p.captured_at, p.created_at) >= ?'; $params[] = $dateFrom; }
        if ($dateTo)   { $where[] = 'COALESCE(p.captured_at, p.created_at) <= ?'; $params[] = $dateTo; }
        if ($minLat !== null && $minLng !== null && $maxLat !== null && $maxLng !== null
            && is_numeric($minLat) && is_numeric($minLng) && is_numeric($maxLat) && is_numeric($maxLng)) {
            $where[] = 'p.latitude BETWEEN ? AND ? AND p.longitude BETWEEN ? AND ?';
            $params[] = (float) $minLat;
            $params[] = (float) $maxLat;
            $params[] = (float) $minLng;
            $params[] = (float) $maxLng;
        }

        $join = 'JOIN users u ON u.id = p.owner_id';
        if ($album) {
            $join .= ' JOIN album_photos ap ON ap.photo_id = p.id JOIN albums al ON al.id = ap.album_id';
            $where[] = 'al.name LIKE ?';
            $params[] = "%$album%";
        }

        $rows = Db::query(
            "SELECT DISTINCT p.*, u.username AS owner_username, u.email AS owner_email
             FROM photos p $join
             WHERE " . implode(' AND ', $where) . '
             ORDER BY p.created_at DESC LIMIT 500',
            $params
        );
        Http::json(['photos' => Serialize::photos($rows)]);
    });
};
