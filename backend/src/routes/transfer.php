<?php
declare(strict_types=1);

/** Export/import of a user's photo metadata as JSON/CSV — port of backend/src/routes/transfer.ts. */
return function (Router $r): void {
    $FIELDS = ['title', 'latitude', 'longitude', 'owner', 'uploadDate', 'captureDate'];

    // `?urls=1` opts the caller into a time-limited download URL per photo.
    $wantsUrls = function (): bool {
        $v = strtolower((string) ($_GET['urls'] ?? ''));
        return in_array($v, ['1', 'true', 'yes'], true);
    };

    // Optional `?ids=A,B,C` narrows the export to a specific subset.
    $idFilterFromQuery = function (): array {
        $raw = (string) ($_GET['ids'] ?? '');
        if ($raw === '') return [];
        $ids = array_values(array_filter(array_map('trim', explode(',', $raw)), fn($s) => $s !== ''));
        return array_slice($ids, 0, 500);
    };

    // Filters used by the gallery export modal: ?from=YYYY-MM-DD, ?to=YYYY-MM-DD
    // (applied to capture date with upload-date fallback so a photo without
    // EXIF still falls inside its actual upload window), plus visibility and
    // a has-GPS toggle.
    $filtersFromQuery = function (): array {
        $parseDate = function (string $key, string $endOfDay) {
            $raw = trim((string) ($_GET[$key] ?? ''));
            if ($raw === '') return null;
            $ts = strtotime($raw);
            return $ts === false ? null : gmdate('Y-m-d ' . $endOfDay, $ts);
        };
        $from = $parseDate('from', '00:00:00');
        $to   = $parseDate('to', '23:59:59');

        $vis = strtoupper(trim((string) ($_GET['visibility'] ?? '')));
        if (!in_array($vis, ['PUBLIC', 'PRIVATE'], true)) $vis = null;

        $geoRaw = strtolower(trim((string) ($_GET['geo'] ?? '')));
        $geo = match ($geoRaw) {
            '1', 'true', 'yes', 'has', 'tagged' => true,
            'no', 'none', 'missing' => false,
            default => null,
        };
        return ['from' => $from, 'to' => $to, 'visibility' => $vis, 'geo' => $geo];
    };

    $ownExportRows = function (string $userId, bool $withUrls, array $idFilter, array $filters): array {
        $sql = "SELECT p.title, p.latitude, p.longitude, u.username AS owner,
                       p.created_at AS uploadDate, p.captured_at AS captureDate,
                       p.s3_key_original
                FROM photos p JOIN users u ON u.id = p.owner_id
                WHERE p.owner_id = ?";
        $params = [$userId];
        if ($idFilter) {
            $placeholders = implode(',', array_fill(0, count($idFilter), '?'));
            $sql .= " AND p.id IN ($placeholders)";
            $params = array_merge($params, $idFilter);
        }
        if (!empty($filters['from'])) { $sql .= ' AND COALESCE(p.captured_at, p.created_at) >= ?'; $params[] = $filters['from']; }
        if (!empty($filters['to']))   { $sql .= ' AND COALESCE(p.captured_at, p.created_at) <= ?'; $params[] = $filters['to']; }
        if (!empty($filters['visibility'])) { $sql .= ' AND p.visibility = ?'; $params[] = $filters['visibility']; }
        if ($filters['geo'] === true)  $sql .= ' AND p.latitude IS NOT NULL';
        if ($filters['geo'] === false) $sql .= ' AND p.latitude IS NULL';

        $sql .= ' ORDER BY p.created_at DESC';
        $rows = Db::query($sql, $params);

        return array_map(function ($row) use ($withUrls) {
            $key = $row['s3_key_original'] ?? null;
            unset($row['s3_key_original']);
            if ($withUrls) $row['imageUrl'] = Storage::resolveUrl($key);
            return $row;
        }, $rows);
    };

    // ---- EXPORT JSON ----
    $r->get('/transfer/export.json', function () use ($ownExportRows, $wantsUrls, $idFilterFromQuery, $filtersFromQuery) {
        $user = Auth::authenticate();
        $rows = $ownExportRows($user['id'], $wantsUrls(), $idFilterFromQuery(), $filtersFromQuery());
        header('Content-Disposition: attachment; filename="pic2map-export.json"');
        Http::json(['exportedAt' => gmdate('c'), 'count' => count($rows), 'photos' => $rows]);
    });

    // ---- EXPORT CSV ----
    $r->get('/transfer/export.csv', function () use ($ownExportRows, $FIELDS, $wantsUrls, $idFilterFromQuery, $filtersFromQuery) {
        $user = Auth::authenticate();
        $withUrls = $wantsUrls();
        $rows = $ownExportRows($user['id'], $withUrls, $idFilterFromQuery(), $filtersFromQuery());
        $fields = $withUrls ? array_merge($FIELDS, ['imageUrl']) : $FIELDS;

        $out = fopen('php://temp', 'r+');
        fputcsv($out, $fields);
        foreach ($rows as $row) {
            fputcsv($out, array_map(fn($f) => $row[$f] ?? '', $fields));
        }
        rewind($out);
        $csv = stream_get_contents($out);
        fclose($out);

        http_response_code(200);
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="pic2map-export.csv"');
        echo $csv;
        exit;
    });

    // ---- IMPORT (JSON or CSV metadata collections) ----
    // Creates metadata-only photo records (no binary). Useful to seed the map
    // from an exported collection. Records get a placeholder original key.
    $r->post('/transfer/import', function () {
        $user = Auth::authenticate();
        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            throw new HttpError(400, 'No file uploaded (field: file)');
        }
        $file = $_FILES['file'];
        if ($file['size'] > 5 * 1024 * 1024) throw new HttpError(400, 'File too large (max 5MB)');

        $text = (string) file_get_contents($file['tmp_name']);
        $trimmed = ltrim($text);
        $records = [];

        if (str_ends_with(strtolower($file['name']), '.json') || str_starts_with($trimmed, '{') || str_starts_with($trimmed, '[')) {
            $parsed = json_decode($text, true);
            if ($parsed === null) throw new HttpError(400, 'Invalid JSON file');
            $records = array_is_list($parsed ?? []) ? $parsed : ($parsed['photos'] ?? []);
        } else {
            $lines = preg_split('/\r\n|\r|\n/', $text);
            $lines = array_values(array_filter($lines, fn($l) => trim($l) !== ''));
            if ($lines) {
                $header = str_getcsv(array_shift($lines));
                foreach ($lines as $line) {
                    $cols = str_getcsv($line);
                    $records[] = array_combine($header, array_pad($cols, count($header), null));
                }
            }
        }

        $imported = 0;
        foreach ($records as $raw) {
            if (!is_array($raw)) continue;
            $title = is_string($raw['title'] ?? null) && trim($raw['title']) !== '' ? $raw['title'] : 'Imported';

            $latitude = parse_import_coordinate($raw['latitude'] ?? null, -90, 90);
            $longitude = parse_import_coordinate($raw['longitude'] ?? null, -180, 180);

            $captureDate = null;
            $rawDate = $raw['captureDate'] ?? null;
            if (is_string($rawDate) && trim($rawDate) !== '') {
                $ts = strtotime($rawDate);
                if ($ts !== false) $captureDate = gmdate('Y-m-d H:i:s', $ts);
            }

            Db::exec(
                "INSERT INTO photos (id, owner_id, title, s3_key_original, latitude, longitude, captured_at, process_state, status, visibility)
                 VALUES (?,?,?,?,?,?,?, 'READY','PENDING','PRIVATE')",
                [Uuid::v4(), $user['id'], $title, "imported/{$user['id']}/placeholder", $latitude, $longitude, $captureDate]
            );
            $imported++;
        }

        Http::json(['imported' => $imported], 201);
    });
};

/** Coerces an import value to a float within [$min,$max], or null (mirrors the Zod z.coerce.number()...nullable()). */
function parse_import_coordinate(mixed $value, float $min, float $max): ?float
{
    if ($value === null || $value === '') return null;
    if (!is_numeric($value)) return null;
    $f = (float) $value;
    if ($f < $min || $f > $max) return null;
    return $f;
}
