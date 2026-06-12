<?php
declare(strict_types=1);

/**
 * Resolves AWS credentials in the same order the AWS SDKs do, so the API can run
 * unchanged whether deployed locally with static keys or on ECS / App Runner / EC2
 * with an IAM role attached (which is what infra/iam.tf:42 actually provisions).
 *
 *   1. Static env vars: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ optional
 *      AWS_SESSION_TOKEN). Useful for local dev.
 *   2. ECS / App Runner / Fargate container creds via $AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
 *      (the metadata endpoint returns rotating temp creds tied to the task role).
 *   3. EC2 IMDSv2 instance role: PUT /latest/api/token, then
 *      GET /latest/meta-data/iam/security-credentials/{role}.
 *
 * Results are cached in-process and refreshed 5 minutes before expiry.
 */
final class AwsCredentials
{
    /** @var array{access_key:string,secret_key:string,session_token:?string,expires:?int}|null */
    private static ?array $cache = null;

    /** @return array{access_key:string,secret_key:string,session_token:?string,expires:?int} */
    public static function get(): array
    {
        $now = time();
        if (self::$cache !== null
            && (self::$cache['expires'] === null || self::$cache['expires'] - 300 > $now)) {
            return self::$cache;
        }

        $access = Config::get('AWS_ACCESS_KEY_ID');
        $secret = Config::get('AWS_SECRET_ACCESS_KEY');
        if ($access && $secret) {
            return self::$cache = [
                'access_key'    => $access,
                'secret_key'    => $secret,
                'session_token' => Config::get('AWS_SESSION_TOKEN') ?: null,
                'expires'       => null,
            ];
        }

        $relUri = Config::get('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI');
        if ($relUri) {
            $resp = self::httpJson('http://169.254.170.2' . $relUri);
            if ($resp) return self::$cache = self::shape($resp);
        }

        $imds = self::imds();
        if ($imds) return self::$cache = self::shape($imds);

        throw new RuntimeException(
            'No AWS credentials available: set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY '
            . 'or run on ECS/App Runner/EC2 with an IAM role attached.'
        );
    }

    /** @param array<string,mixed> $r */
    private static function shape(array $r): array
    {
        return [
            'access_key'    => (string) ($r['AccessKeyId'] ?? ''),
            'secret_key'    => (string) ($r['SecretAccessKey'] ?? ''),
            'session_token' => isset($r['Token']) ? (string) $r['Token'] : null,
            'expires'       => isset($r['Expiration']) ? (strtotime((string) $r['Expiration']) ?: null) : null,
        ];
    }

    /** @return array<string,mixed>|null */
    private static function httpJson(string $url, array $headers = [], string $method = 'GET'): ?array
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 2,
            CURLOPT_CONNECTTIMEOUT => 1,
            CURLOPT_CUSTOMREQUEST => $method,
        ];
        if ($headers) $opts[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($ch, $opts);
        $out = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($status < 200 || $status >= 300 || !is_string($out)) return null;
        $j = json_decode($out, true);
        return is_array($j) ? $j : null;
    }

    private static function imdsToken(): ?string
    {
        $ch = curl_init('http://169.254.169.254/latest/api/token');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 2,
            CURLOPT_CONNECTTIMEOUT => 1,
            CURLOPT_CUSTOMREQUEST => 'PUT',
            CURLOPT_HTTPHEADER => ['X-aws-ec2-metadata-token-ttl-seconds: 21600'],
        ]);
        $tok = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ($status === 200 && is_string($tok) && $tok !== '') ? $tok : null;
    }

    /** @return array<string,mixed>|null */
    private static function imds(): ?array
    {
        $tok = self::imdsToken();
        if ($tok === null) return null;
        $hdr = ["X-aws-ec2-metadata-token: $tok"];

        $ch = curl_init('http://169.254.169.254/latest/meta-data/iam/security-credentials/');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 2,
            CURLOPT_HTTPHEADER => $hdr,
        ]);
        $role = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($status !== 200 || !is_string($role) || $role === '') return null;

        return self::httpJson(
            'http://169.254.169.254/latest/meta-data/iam/security-credentials/' . trim($role),
            $hdr,
        );
    }
}
