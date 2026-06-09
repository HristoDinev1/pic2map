<?php
declare(strict_types=1);

/**
 * Hand-rolled HMAC-SHA256 signed tokens ("HS256 JWT", built with PHP's hash_hmac
 * only — no JWT library), used by the LOCAL drivers:
 *   - LocalAuth session tokens (id/refresh) — replaces Cognito's RS256 tokens
 *   - signed upload + media URLs           — replaces S3 presigned URLs
 * Format: base64url(header) . "." . base64url(payload) . "." . base64url(hmac)
 */
final class Token
{
    public static function b64url(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    public static function b64urlDecode(string $data): string
    {
        $pad = strlen($data) % 4;
        if ($pad) $data .= str_repeat('=', 4 - $pad);
        return (string) base64_decode(strtr($data, '-_', '+/'), true);
    }

    private static function secret(): string
    {
        $s = Config::get('APP_SECRET');
        if ($s === null || strlen($s) < 16) {
            // Auto-provision a per-installation secret so local mode works out
            // of the box; persisted next to .env (gitignored directory layout).
            $file = dirname(__DIR__) . '/.app-secret';
            if (is_file($file)) return trim((string) file_get_contents($file));
            $s = bin2hex(random_bytes(32));
            if (@file_put_contents($file, $s) === false) {
                throw new RuntimeException('Set APP_SECRET in backend/.env (>=16 chars)');
            }
            @chmod($file, 0600);
        }
        return $s;
    }

    /** Issue a signed token. $claims must be a JSON-encodable map; exp is added from $ttl. */
    public static function issue(array $claims, int $ttlSeconds): string
    {
        $header = self::b64url((string) json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $claims['iat'] = time();
        $claims['exp'] = time() + $ttlSeconds;
        $payload = self::b64url((string) json_encode($claims));
        $sig = self::b64url(hash_hmac('sha256', "$header.$payload", self::secret(), true));
        return "$header.$payload.$sig";
    }

    /** Verify signature + expiry; returns the claims array or throws HttpError(401). */
    public static function verify(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) throw new HttpError(401, 'Malformed token');
        [$header, $payload, $sig] = $parts;
        $expected = self::b64url(hash_hmac('sha256', "$header.$payload", self::secret(), true));
        if (!hash_equals($expected, $sig)) throw new HttpError(401, 'Invalid token signature');
        $claims = json_decode(self::b64urlDecode($payload), true);
        if (!is_array($claims)) throw new HttpError(401, 'Malformed token payload');
        if (($claims['exp'] ?? 0) < time()) throw new HttpError(401, 'Token expired');
        return $claims;
    }

    /** Compact HMAC signature for signed URLs (key + expiry → hex sig). */
    public static function signUrl(string $subject, int $expires): string
    {
        return hash_hmac('sha256', "$subject\n$expires", self::secret());
    }

    public static function verifyUrl(string $subject, int $expires, string $sig): bool
    {
        if ($expires < time()) return false;
        return hash_equals(self::signUrl($subject, $expires), $sig);
    }
}
