<?php
declare(strict_types=1);

/** Thrown by route handlers; caught by the front controller and turned into a JSON error response. */
final class HttpError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message, public readonly mixed $details = null)
    {
        parent::__construct($message);
    }
}

/** Small request helpers + JSON response writer (stand-ins for Express's req/res). */
final class Http
{
    private static ?array $jsonBody = null;

    public static function method(): string
    {
        return $_SERVER['REQUEST_METHOD'] ?? 'GET';
    }

    /** Decoded JSON request body (cached). Returns [] for empty/invalid bodies. */
    public static function body(): array
    {
        if (self::$jsonBody === null) {
            $raw = file_get_contents('php://input') ?: '';
            $decoded = $raw === '' ? [] : json_decode($raw, true);
            self::$jsonBody = is_array($decoded) ? $decoded : [];
        }
        return self::$jsonBody;
    }

    public static function query(string $name, ?string $default = null): ?string
    {
        $v = $_GET[$name] ?? $default;
        return $v === null ? null : (string) $v;
    }

    public static function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (str_starts_with($header, 'Bearer ')) return substr($header, 7);
        return null;
    }

    public static function json(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function noContent(): never
    {
        http_response_code(204);
        exit;
    }

    /** Require a string field; throws 400 with a validation-style payload if missing/blank. */
    public static function requireString(array $body, string $field, int $maxLen = 0): string
    {
        $v = $body[$field] ?? null;
        if (!is_string($v) || trim($v) === '') {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => [$field => ["$field is required"]]]);
        }
        if ($maxLen > 0 && mb_strlen($v) > $maxLen) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => [$field => ["$field must be at most $maxLen characters"]]]);
        }
        return $v;
    }

    public static function optionalString(array $body, string $field, int $maxLen = 0): ?string
    {
        $v = $body[$field] ?? null;
        if ($v === null) return null;
        if (!is_string($v)) throw new HttpError(400, 'Validation failed', ['fieldErrors' => [$field => ["$field must be a string"]]]);
        if ($maxLen > 0 && mb_strlen($v) > $maxLen) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => [$field => ["$field must be at most $maxLen characters"]]]);
        }
        return $v;
    }

    public static function optionalEnum(array $body, string $field, array $allowed): ?string
    {
        $v = $body[$field] ?? null;
        if ($v === null) return null;
        if (!in_array($v, $allowed, true)) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => [$field => ["$field must be one of: " . implode(', ', $allowed)]]]);
        }
        return $v;
    }

    /** Parses a nullable numeric field within [$min, $max]; '$present' is true only if the key exists. */
    public static function nullableFloat(array $body, string $field, float $min, float $max, bool &$present = false): ?float
    {
        $present = array_key_exists($field, $body);
        $v = $body[$field] ?? null;
        if ($v === null) return null;
        if (!is_numeric($v)) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => [$field => ["$field must be a number"]]]);
        }
        $f = (float) $v;
        if ($f < $min || $f > $max) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => [$field => ["$field must be between $min and $max"]]]);
        }
        return $f;
    }
}
