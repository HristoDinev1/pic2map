<?php
declare(strict_types=1);

/**
 * Talks to Amazon S3 directly over HTTPS using hand-rolled SigV4 (see Sigv4.php) —
 * no AWS SDK. Mirrors backend/src/lib/s3.ts: presigned PUT for browser uploads,
 * presigned/CDN GET for viewing, signed DELETE for cleanup.
 */
final class S3
{
    private static function signer(): Sigv4
    {
        return new Sigv4(
            Config::require('AWS_ACCESS_KEY_ID'),
            Config::require('AWS_SECRET_ACCESS_KEY'),
            Config::get('AWS_REGION', 'us-east-1'),
        );
    }

    private static function host(): string
    {
        return Config::require('S3_BUCKET') . '.s3.' . Config::get('AWS_REGION', 'us-east-1') . '.amazonaws.com';
    }

    private static function uri(string $key): string
    {
        return '/' . ltrim($key, '/');
    }

    /** Presigned PUT so the browser uploads the original directly to S3. */
    public static function presignUpload(string $key, string $contentType, int $expires = 900): string
    {
        return self::signer()->presignUrl('PUT', self::host(), self::uri($key), 's3', $expires);
    }

    /** Presigned GET (used when no public CDN base URL is configured). */
    public static function presignDownload(string $key, int $expires = 3600): ?string
    {
        if ($key === '') return null;
        return self::signer()->presignUrl('GET', self::host(), self::uri($key), 's3', $expires);
    }

    /** Resolve an object key to a browser-usable URL (CDN base URL or presigned). */
    public static function resolveUrl(?string $key): ?string
    {
        if ($key === null || $key === '') return null;
        $base = Config::get('S3_PUBLIC_BASE_URL', '');
        if ($base) return rtrim($base, '/') . '/' . $key;
        return self::presignDownload($key);
    }

    /** Signed DELETE request straight to the object URL. */
    public static function deleteObject(?string $key): void
    {
        if ($key === null || $key === '') return;
        $host = self::host();
        $uri = self::uri($key);
        $headers = self::signer()->signedJsonHeaders($host, $uri, 's3', '');

        $ch = curl_init("https://$host$uri");
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => 'DELETE',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => self::flattenHeaders($headers),
            CURLOPT_TIMEOUT => 15,
        ]);
        curl_exec($ch);
        curl_close($ch);
    }

    private static function flattenHeaders(array $headers): array
    {
        $out = [];
        foreach ($headers as $k => $v) $out[] = "$k: $v";
        return $out;
    }
}
