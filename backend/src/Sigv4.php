<?php
declare(strict_types=1);

/**
 * Minimal AWS Signature Version 4 implementation (no AWS SDK).
 * Covers the two shapes PIC2MAP needs:
 *   - presigned query-string URLs (S3 GET/PUT/DELETE)
 *   - signed Authorization headers for JSON POST calls (Cognito Identity Provider)
 * Reference: https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html
 */
final class Sigv4
{
    public function __construct(
        private readonly string $accessKey,
        private readonly string $secretKey,
        private readonly string $region,
        private readonly ?string $sessionToken = null,
    ) {}

    private function signingKey(string $dateStamp, string $service): string
    {
        $kDate = hash_hmac('sha256', $dateStamp, 'AWS4' . $this->secretKey, true);
        $kRegion = hash_hmac('sha256', $this->region, $kDate, true);
        $kService = hash_hmac('sha256', $service, $kRegion, true);
        return hash_hmac('sha256', 'aws4_request', $kService, true);
    }

    private static function uriEncode(string $value, bool $encodeSlash = true): string
    {
        $encoded = rawurlencode($value);
        // rawurlencode is RFC 3986 compliant except it escapes '~'; AWS wants '~' literal.
        $encoded = str_replace('%7E', '~', $encoded);
        if (!$encodeSlash) $encoded = str_replace('%2F', '/', $encoded);
        return $encoded;
    }

    /**
     * Build a presigned URL valid for $expiresSeconds.
     * $host e.g. "bucket.s3.us-east-1.amazonaws.com", $canonicalUri e.g. "/originals/u/1.jpg".
     */
    public function presignUrl(
        string $method,
        string $host,
        string $canonicalUri,
        string $service,
        int $expiresSeconds,
        array $extraQuery = [],
    ): string {
        $now = gmdate('Ymd\THis\Z');
        $dateStamp = substr($now, 0, 8);
        $credentialScope = "$dateStamp/{$this->region}/$service/aws4_request";

        $query = $extraQuery + [
            'X-Amz-Algorithm' => 'AWS4-HMAC-SHA256',
            'X-Amz-Credential' => "{$this->accessKey}/$credentialScope",
            'X-Amz-Date' => $now,
            'X-Amz-Expires' => (string) $expiresSeconds,
            'X-Amz-SignedHeaders' => 'host',
        ];
        if ($this->sessionToken) $query['X-Amz-Security-Token'] = $this->sessionToken;

        ksort($query);
        $pairs = [];
        foreach ($query as $k => $v) {
            $pairs[] = self::uriEncode($k) . '=' . self::uriEncode($v);
        }
        $canonicalQuery = implode('&', $pairs);

        $canonicalUriEncoded = implode('/', array_map(
            fn($seg) => self::uriEncode($seg),
            explode('/', $canonicalUri)
        ));

        $canonicalRequest = implode("\n", [
            strtoupper($method),
            $canonicalUriEncoded,
            $canonicalQuery,
            "host:$host\n",
            'host',
            'UNSIGNED-PAYLOAD',
        ]);

        $stringToSign = implode("\n", [
            'AWS4-HMAC-SHA256',
            $now,
            $credentialScope,
            hash('sha256', $canonicalRequest),
        ]);

        $signature = bin2hex(hash_hmac('sha256', $stringToSign, $this->signingKey($dateStamp, $service), true));

        return "https://$host$canonicalUriEncoded?$canonicalQuery&X-Amz-Signature=$signature";
    }

    /**
     * Build headers (incl. Authorization) for a signed POST request with a JSON body.
     * Returns an associative array of header name => value, ready for cURL.
     */
    public function signedJsonHeaders(
        string $host,
        string $canonicalUri,
        string $service,
        string $body,
        array $extraHeaders = [],
    ): array {
        $now = gmdate('Ymd\THis\Z');
        $dateStamp = substr($now, 0, 8);
        $credentialScope = "$dateStamp/{$this->region}/$service/aws4_request";
        $payloadHash = hash('sha256', $body);

        $headers = ['host' => $host, 'x-amz-date' => $now, 'x-amz-content-sha256' => $payloadHash];
        if ($this->sessionToken) $headers['x-amz-security-token'] = $this->sessionToken;
        foreach ($extraHeaders as $k => $v) $headers[strtolower($k)] = $v;
        ksort($headers);

        $canonicalHeaders = '';
        foreach ($headers as $k => $v) $canonicalHeaders .= "$k:$v\n";
        $signedHeaders = implode(';', array_keys($headers));

        $canonicalRequest = implode("\n", [
            'POST',
            $canonicalUri,
            '',
            $canonicalHeaders,
            $signedHeaders,
            $payloadHash,
        ]);

        $stringToSign = implode("\n", [
            'AWS4-HMAC-SHA256',
            $now,
            $credentialScope,
            hash('sha256', $canonicalRequest),
        ]);

        $signature = bin2hex(hash_hmac('sha256', $stringToSign, $this->signingKey($dateStamp, $service), true));
        $authorization = "AWS4-HMAC-SHA256 Credential={$this->accessKey}/$credentialScope, "
            . "SignedHeaders=$signedHeaders, Signature=$signature";

        $out = [];
        foreach ($headers as $k => $v) $out[$k] = $v;
        $out['authorization'] = $authorization;
        return $out;
    }
}
