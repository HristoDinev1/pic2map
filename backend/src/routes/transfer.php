<?php
declare(strict_types=1);

/** Export/import of a user's photo metadata as JSON/CSV — port of backend/src/routes/transfer.ts. */
return function (Router $r): void {
    $FIELDS = ['title', 'latitude', 'longitude', 'owner', 'uploadDate', 'captureDate'];

    $ownExportRows = function (string $userId): array {
        return Db::query(
            "SELECT p.title, p.latitude, p.longitude, u.username AS owner,
                    p.created_at AS uploadDate, p.captured_at AS captureDate
             FROM photos p JOIN users u ON u.id = p.owner_id
             WHERE p.owner_id = ? ORDER BY p.created_at DESC",
            [$userId]
        );
    };

    // ---- EXPORT JSON ----
    $r->get('/transfer/export.json', function () use ($ownExportRows) {
        $user = Auth::authenticate();
        $rows = $ownExportRows($user['id']);
        header('Content-Disposition: attachment; filename="pic2map-export.json"');
        Http::json(['exportedAt' => gmdate('c'), 'count' => count($rows), 'photos' => $rows]);
    });

    // ---- EXPORT CSV ----
    $r->get('/transfer/export.csv', function () use ($ownExportRows, $FIELDS) {
        $user = Auth::authenticate();
        $rows = $ownExportRows($user['id']);

        $out = fopen('php://temp', 'r+');
        fputcsv($out, $FIELDS);
        foreach ($rows as $row) {
            fputcsv($out, array_map(fn($f) => $row[$f] ?? '', $FIELDS));
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
