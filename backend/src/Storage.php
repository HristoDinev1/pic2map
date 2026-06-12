<?php
declare(strict_types=1);

/**
 * Storage driver facade. The original code talked to S3 directly; this keeps
 * that path intact ("s3" driver) and adds a "local" driver that stores files
 * on the backend's own disk and serves them through signed URLs — same
 * presign/resolve/delete contract, zero AWS required.
 *
 * Driver selection (env STORAGE_DRIVER=local|s3, default: auto):
 *   auto → "s3" only when S3_BUCKET + AWS creds look configured, else "local".
 */
final class Storage
{
    public static function driver(): string
    {
        $configured = strtolower((string) Config::get('STORAGE_DRIVER', 'auto'));
        if ($configured === 'local' || $configured === 's3') return $configured;
        // Auto-detect: pick "s3" whenever a bucket is configured AND we have
        // *some* way to authenticate — static keys OR an IAM role surfaced via
        // the standard AWS env vars (ECS/Fargate, EC2 IMDS). Without this, a
        // role-based deployment silently falls back to the local driver.
        $bucket = (string) Config::get('S3_BUCKET', '');
        if ($bucket === '') return 'local';
        $key = (string) Config::get('AWS_ACCESS_KEY_ID', '');
        $hasStaticKey = $key !== '' && !str_starts_with($key, 'XXXX');
        $hasRole = (string) Config::get('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', '') !== ''
            || (string) Config::get('AWS_CONTAINER_CREDENTIALS_FULL_URI', '') !== ''
            || (string) Config::get('AWS_EXECUTION_ENV', '') !== '';
        return ($hasStaticKey || $hasRole) ? 's3' : 'local';
    }

    /** Absolute base URL of this API (used to build local upload/media URLs). */
    public static function appUrl(): string
    {
        $configured = Config::get('APP_URL');
        if ($configured) return rtrim($configured, '/');
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost:4000';
        return "$scheme://$host";
    }

    /** Root directory for the local driver (created on demand). */
    public static function localRoot(): string
    {
        $dir = Config::get('STORAGE_DIR') ?: dirname(__DIR__) . '/storage';
        if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
            throw new RuntimeException("Cannot create storage dir: $dir");
        }
        return rtrim($dir, '/');
    }

    /** Keys are validated everywhere they cross a trust boundary. */
    public static function assertSafeKey(string $key): string
    {
        if ($key === '' || str_contains($key, '..') || str_contains($key, "\0") || $key[0] === '/') {
            throw new HttpError(400, 'Invalid storage key');
        }
        return $key;
    }

    public static function localPath(string $key): string
    {
        return self::localRoot() . '/' . self::assertSafeKey($key);
    }

    // ------------------------------------------------------------------
    // The three operations the routes/serializer use
    // ------------------------------------------------------------------

    /** URL the browser PUTs the original to. Local: our own signed /uploads endpoint. */
    public static function presignUpload(string $key, string $contentType, string $photoId, int $expires = 900): string
    {
        if (self::driver() === 's3') return S3::presignUpload($key, $contentType, $expires);
        $token = Token::issue(['use' => 'upload', 'key' => $key, 'ct' => $contentType, 'photoId' => $photoId], $expires);
        return self::appUrl() . '/api/uploads?token=' . urlencode($token);
    }

    /** Browser-viewable URL for a stored object (signed, like an S3 presigned GET). */
    public static function resolveUrl(?string $key, int $expires = 86400): ?string
    {
        if ($key === null || $key === '') return null;
        if (self::driver() === 's3') return S3::resolveUrl($key);
        $exp = time() + $expires;
        $sig = Token::signUrl($key, $exp);
        return self::appUrl() . '/api/media/' . str_replace('%2F', '/', rawurlencode($key)) . "?e=$exp&s=$sig";
    }

    public static function deleteObject(?string $key): void
    {
        if ($key === null || $key === '') return;
        if (self::driver() === 's3') { S3::deleteObject($key); return; }
        $path = self::localPath($key);
        if (is_file($path)) @unlink($path);
    }

    /** Store raw bytes under a key (local driver only). */
    public static function putLocal(string $key, string $bytes): void
    {
        $path = self::localPath($key);
        $dir = dirname($path);
        if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
            throw new RuntimeException("Cannot create dir: $dir");
        }
        if (file_put_contents($path, $bytes) === false) {
            throw new RuntimeException("Cannot write: $path");
        }
    }
}
