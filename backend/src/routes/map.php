<?php
declare(strict_types=1);

/**
 * Geotagged photos for the map — port of backend/src/routes/map.ts.
 * Returns all PUBLIC + APPROVED photos plus the caller's own (any visibility).
 * Optional bbox filter: ?minLat&minLng&maxLat&maxLng
 */
return function (Router $r): void {
    $r->get('/map/photos', function () {
        $user = Auth::authenticate();
        $minLat = Http::query('minLat');
        $minLng = Http::query('minLng');
        $maxLat = Http::query('maxLat');
        $maxLng = Http::query('maxLng');

        $params = [$user['id']];
        $bbox = '';
        if ($minLat !== null && $minLng !== null && $maxLat !== null && $maxLng !== null
            && is_numeric($minLat) && is_numeric($minLng) && is_numeric($maxLat) && is_numeric($maxLng)) {
            $bbox = 'AND p.latitude BETWEEN ? AND ? AND p.longitude BETWEEN ? AND ?';
            $params[] = (float) $minLat;
            $params[] = (float) $maxLat;
            $params[] = (float) $minLng;
            $params[] = (float) $maxLng;
        }

        $rows = Db::query(
            "SELECT p.*, u.username AS owner_username
             FROM photos p JOIN users u ON u.id = p.owner_id
             WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
               AND ( (p.visibility='PUBLIC' AND p.status='APPROVED') OR p.owner_id = ? )
               $bbox
             ORDER BY p.captured_at IS NULL, p.captured_at DESC
             LIMIT 2000",
            $params
        );
        Http::json(['photos' => Serialize::photos($rows)]);
    });
};
