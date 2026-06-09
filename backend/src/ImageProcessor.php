<?php
declare(strict_types=1);

/**
 * Local-mode port of the image-processor Lambda (exifr + sharp → PHP exif + GD):
 * given an uploaded original, extracts EXIF GPS + capture date, generates
 * thumb/medium/large JPEG derivatives, and updates the `photos` row — so
 * geotagged photos land on the map with zero AWS involvement.
 */
final class ImageProcessor
{
    private const SIZES = ['thumb' => 320, 'medium' => 1024, 'large' => 2048];
    private const JPEG_QUALITY = 82;

    /** Process a freshly uploaded original; never throws (records FAILED instead). */
    public static function process(string $photoId): array
    {
        $photo = Db::one('SELECT * FROM photos WHERE id = ?', [$photoId]);
        if (!$photo) throw new HttpError(404, 'Photo not found');

        try {
            $path = Storage::localPath($photo['s3_key_original']);
            if (!is_file($path)) throw new RuntimeException('Original file missing');

            $info = @getimagesize($path);
            $sizeBytes = (int) filesize($path);
            [$gps, $capturedAt, $orientation] = self::readExif($path);

            $derived = ['thumb' => null, 'medium' => null, 'large' => null];
            $width = $info[0] ?? null;
            $height = $info[1] ?? null;

            $img = self::load($path, $info[2] ?? 0);
            if ($img !== null) {
                $img = self::applyOrientation($img, $orientation);
                $width = imagesx($img);
                $height = imagesy($img);
                foreach (self::SIZES as $name => $max) {
                    $derived[$name] = self::writeDerivative($img, $photo['id'], $name, $max);
                }
                imagedestroy($img);
            }

            // Coordinates: EXIF wins only when nothing is set yet — a user (or the
            // frontend's instant-geotag) may already have written them; never clobber.
            Db::exec(
                "UPDATE photos SET
                    width = ?, height = ?, size_bytes = ?,
                    s3_key_thumb = ?, s3_key_medium = ?, s3_key_large = ?,
                    latitude  = COALESCE(latitude, ?),
                    longitude = COALESCE(longitude, ?),
                    captured_at = COALESCE(captured_at, ?),
                    process_state = 'READY', process_error = NULL
                 WHERE id = ?",
                [
                    $width, $height, $sizeBytes,
                    $derived['thumb'], $derived['medium'], $derived['large'],
                    $gps['latitude'] ?? null, $gps['longitude'] ?? null,
                    $capturedAt,
                    $photo['id'],
                ]
            );
        } catch (Throwable $e) {
            Db::exec(
                "UPDATE photos SET process_state = 'FAILED', process_error = ? WHERE id = ?",
                [substr($e->getMessage(), 0, 500), $photo['id']]
            );
        }

        return Db::one('SELECT * FROM photos WHERE id = ?', [$photoId]) ?? [];
    }

    // ------------------------------------------------------------------
    // EXIF
    // ------------------------------------------------------------------

    /** @return array{0: array{latitude: float, longitude: float}|null, 1: ?string, 2: int} */
    private static function readExif(string $path): array
    {
        $exif = function_exists('exif_read_data') ? @exif_read_data($path, null, true) : false;
        if (!is_array($exif)) return [null, null, 1];

        $gps = null;
        $g = $exif['GPS'] ?? [];
        if (isset($g['GPSLatitude'], $g['GPSLongitude'])) {
            $lat = self::dmsToDecimal($g['GPSLatitude'], $g['GPSLatitudeRef'] ?? 'N');
            $lng = self::dmsToDecimal($g['GPSLongitude'], $g['GPSLongitudeRef'] ?? 'E');
            if ($lat !== null && $lng !== null
                && abs($lat) <= 90 && abs($lng) <= 180
                && !($lat === 0.0 && $lng === 0.0)) {        // 0,0 = camera placeholder
                $gps = ['latitude' => $lat, 'longitude' => $lng];
            }
        }

        $raw = $exif['EXIF']['DateTimeOriginal'] ?? $exif['IFD0']['DateTime'] ?? null;
        $capturedAt = null;
        if (is_string($raw) && preg_match('/^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})$/', $raw, $m)) {
            $capturedAt = "$m[1]-$m[2]-$m[3] $m[4]";
        }

        $orientation = (int) ($exif['IFD0']['Orientation'] ?? 1);
        return [$gps, $capturedAt, $orientation];
    }

    /** EXIF stores coordinates as three "num/den" rationals (deg, min, sec). */
    private static function dmsToDecimal(array $dms, string $ref): ?float
    {
        $parts = [];
        foreach ($dms as $r) {
            $v = self::rational($r);
            if ($v === null) return null;
            $parts[] = $v;
        }
        if (count($parts) < 1) return null;
        $deg = $parts[0] + ($parts[1] ?? 0) / 60 + ($parts[2] ?? 0) / 3600;
        return in_array(strtoupper($ref), ['S', 'W'], true) ? -$deg : $deg;
    }

    private static function rational(mixed $r): ?float
    {
        if (is_int($r) || is_float($r)) return (float) $r;
        if (is_string($r) && str_contains($r, '/')) {
            [$n, $d] = explode('/', $r, 2);
            return (float) $d == 0.0 ? null : (float) $n / (float) $d;
        }
        return is_numeric($r) ? (float) $r : null;
    }

    // ------------------------------------------------------------------
    // GD derivatives
    // ------------------------------------------------------------------

    private static function load(string $path, int $type): ?GdImage
    {
        $img = match ($type) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($path),
            IMAGETYPE_PNG  => @imagecreatefrompng($path),
            IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : false,
            default        => false, // TIFF/HEIC: keep original only, no derivatives
        };
        return $img instanceof GdImage ? $img : null;
    }

    private static function applyOrientation(GdImage $img, int $orientation): GdImage
    {
        $rotated = match ($orientation) {
            3 => imagerotate($img, 180, 0),
            6 => imagerotate($img, -90, 0),
            8 => imagerotate($img, 90, 0),
            default => null,
        };
        if ($rotated instanceof GdImage) {
            imagedestroy($img);
            return $rotated;
        }
        return $img;
    }

    /** Scale so the longest side is ≤ $max (never upscale) and save as JPEG. */
    private static function writeDerivative(GdImage $src, string $photoId, string $name, int $max): string
    {
        $w = imagesx($src);
        $h = imagesy($src);
        $scale = min(1.0, $max / max($w, $h));
        $dw = max(1, (int) round($w * $scale));
        $dh = max(1, (int) round($h * $scale));

        $dst = imagecreatetruecolor($dw, $dh);
        imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255)); // flatten alpha
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $dw, $dh, $w, $h);

        $key = "derived/$photoId/$name.jpg";
        $path = Storage::localPath($key);
        $dir = dirname($path);
        if (!is_dir($dir) && !@mkdir($dir, 0775, true)) throw new RuntimeException("Cannot create dir: $dir");
        if (!imagejpeg($dst, $path, self::JPEG_QUALITY)) throw new RuntimeException("Cannot write derivative: $key");
        imagedestroy($dst);
        return $key;
    }
}
