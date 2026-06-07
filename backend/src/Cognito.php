<?php
declare(strict_types=1);

/**
 * Talks to Amazon Cognito directly over HTTPS — no AWS SDK, no aws-jwt-verify.
 *  - verifyIdToken(): downloads the user-pool JWKS, verifies the RS256 signature
 *    and standard claims (exp/iss/aud/token_use) using PHP's built-in openssl.
 *  - admin*()/listUsers(): SigV4-signed JSON POST calls to the
 *    AWSCognitoIdentityProviderService API (mirrors backend/src/lib/cognito.ts).
 */
final class Cognito
{
    private static function region(): string
    {
        return Config::get('AWS_REGION', 'eu-central-1');
    }

    private static function userPoolId(): string
    {
        return Config::require('COGNITO_USER_POOL_ID');
    }

    private static function issuer(): string
    {
        return 'https://cognito-idp.' . self::region() . '.amazonaws.com/' . self::userPoolId();
    }

    // ------------------------------------------------------------------
    // ID token verification
    // ------------------------------------------------------------------

    private static function base64UrlDecode(string $data): string
    {
        $remainder = strlen($data) % 4;
        if ($remainder) $data .= str_repeat('=', 4 - $remainder);
        return (string) base64_decode(strtr($data, '-_', '+/'), true);
    }

    private static function jwks(): array
    {
        $cacheFile = sys_get_temp_dir() . '/pic2map_jwks_' . md5(self::userPoolId()) . '.json';
        if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < 3600) {
            $cached = json_decode((string) file_get_contents($cacheFile), true);
            if (is_array($cached)) return $cached;
        }
        $url = self::issuer() . '/.well-known/jwks.json';
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
        $body = curl_exec($ch);
        curl_close($ch);
        $jwks = json_decode((string) $body, true);
        if (!is_array($jwks) || empty($jwks['keys'])) {
            throw new HttpError(401, 'Unable to fetch token signing keys');
        }
        @file_put_contents($cacheFile, json_encode($jwks));
        return $jwks;
    }

    /** Build a PEM "BEGIN PUBLIC KEY" block from an RSA JWK's modulus (n) and exponent (e). */
    private static function jwkToPem(string $nB64, string $eB64): string
    {
        $modulus = self::base64UrlDecode($nB64);
        $exponent = self::base64UrlDecode($eB64);

        $asn1Len = function (int $len): string {
            if ($len < 128) return chr($len);
            $bytes = '';
            while ($len > 0) { $bytes = chr($len & 0xff) . $bytes; $len >>= 8; }
            return chr(0x80 | strlen($bytes)) . $bytes;
        };
        $asn1Int = function (string $bytes) use ($asn1Len): string {
            if ($bytes === '' || ord($bytes[0]) > 0x7f) $bytes = "\x00" . $bytes;
            return "\x02" . $asn1Len(strlen($bytes)) . $bytes;
        };
        $asn1Seq = fn(string $content): string => "\x30" . $asn1Len(strlen($content)) . $content;
        $asn1Bits = fn(string $content): string => "\x03" . $asn1Len(strlen($content) + 1) . "\x00" . $content;

        $rsaPublicKey = $asn1Seq($asn1Int($modulus) . $asn1Int($exponent));
        // SEQUENCE { OID rsaEncryption(1.2.840.113549.1.1.1), NULL }
        $algorithmIdentifier = $asn1Seq("\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01" . "\x05\x00");
        $publicKeyInfo = $asn1Seq($algorithmIdentifier . $asn1Bits($rsaPublicKey));

        return "-----BEGIN PUBLIC KEY-----\n"
            . chunk_split(base64_encode($publicKeyInfo), 64, "\n")
            . "-----END PUBLIC KEY-----\n";
    }

    /**
     * Verifies signature, expiry, issuer, audience and token_use against the
     * pool JWKS — equivalent to CognitoJwtVerifier.create({...}).verify(token).
     * Returns the decoded payload (claims) on success.
     */
    public static function verifyIdToken(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) throw new HttpError(401, 'Invalid or expired token');
        [$headerB64, $payloadB64, $sigB64] = $parts;

        $header = json_decode(self::base64UrlDecode($headerB64), true);
        $payload = json_decode(self::base64UrlDecode($payloadB64), true);
        $signature = self::base64UrlDecode($sigB64);
        if (!is_array($header) || !is_array($payload)) throw new HttpError(401, 'Invalid or expired token');
        if (($header['alg'] ?? null) !== 'RS256') throw new HttpError(401, 'Invalid or expired token');

        $jwk = null;
        foreach (self::jwks()['keys'] as $key) {
            if (($key['kid'] ?? null) === ($header['kid'] ?? null)) { $jwk = $key; break; }
        }
        if ($jwk === null) throw new HttpError(401, 'Invalid or expired token');

        $pem = self::jwkToPem($jwk['n'], $jwk['e']);
        $publicKey = openssl_pkey_get_public($pem);
        if ($publicKey === false) throw new HttpError(401, 'Invalid or expired token');

        $signedData = "$headerB64.$payloadB64";
        $verified = openssl_verify($signedData, $signature, $publicKey, OPENSSL_ALGO_SHA256);
        if ($verified !== 1) throw new HttpError(401, 'Invalid or expired token');

        $now = time();
        if (($payload['exp'] ?? 0) < $now) throw new HttpError(401, 'Invalid or expired token');
        if (($payload['iss'] ?? null) !== self::issuer()) throw new HttpError(401, 'Invalid or expired token');
        if (($payload['token_use'] ?? null) !== 'id') throw new HttpError(401, 'Invalid or expired token');
        if (($payload['aud'] ?? null) !== Config::require('COGNITO_CLIENT_ID')) {
            throw new HttpError(401, 'Invalid or expired token');
        }

        return $payload;
    }

    // ------------------------------------------------------------------
    // Admin API (AWSCognitoIdentityProviderService) — SigV4-signed POSTs
    // ------------------------------------------------------------------

    private static function callApi(string $target, array $payload): array
    {
        $region = self::region();
        $host = "cognito-idp.$region.amazonaws.com";
        $body = json_encode($payload);

        $signer = new Sigv4(
            Config::require('AWS_ACCESS_KEY_ID'),
            Config::require('AWS_SECRET_ACCESS_KEY'),
            $region,
        );
        $headers = $signer->signedJsonHeaders($host, '/', 'cognito-idp', $body, [
            'Content-Type' => 'application/x-amz-json-1.1',
            'X-Amz-Target' => "AWSCognitoIdentityProviderService.$target",
        ]);

        $flat = [];
        foreach ($headers as $k => $v) $flat[] = "$k: $v";

        $ch = curl_init("https://$host/");
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $flat,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
        ]);
        $response = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode((string) $response, true);
        if ($status >= 400) {
            throw new RuntimeException("Cognito $target failed: " . ($decoded['message'] ?? $response));
        }
        return is_array($decoded) ? $decoded : [];
    }

    public static function setUserGroup(string $username, string $group): void
    {
        self::callApi('AdminAddUserToGroup', [
            'UserPoolId' => self::userPoolId(), 'Username' => $username, 'GroupName' => $group,
        ]);
    }

    public static function removeUserGroup(string $username, string $group): void
    {
        self::callApi('AdminRemoveUserFromGroup', [
            'UserPoolId' => self::userPoolId(), 'Username' => $username, 'GroupName' => $group,
        ]);
    }

    public static function setUserEnabled(string $username, bool $enabled): void
    {
        self::callApi($enabled ? 'AdminEnableUser' : 'AdminDisableUser', [
            'UserPoolId' => self::userPoolId(), 'Username' => $username,
        ]);
    }

    public static function listUsers(int $limit = 60): array
    {
        $r = self::callApi('ListUsers', ['UserPoolId' => self::userPoolId(), 'Limit' => $limit]);
        return $r['Users'] ?? [];
    }
}
