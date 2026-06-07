<?php
declare(strict_types=1);

/** Loads `.env` (KEY=VALUE per line, '#' comments) into an associative array — no external dotenv library. */
final class Config
{
    private static ?array $values = null;

    private static function load(): array
    {
        if (self::$values !== null) return self::$values;
        $values = [];
        $path = dirname(__DIR__) . '/.env';
        if (is_file($path)) {
            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
                [$key, $val] = explode('=', $line, 2);
                $key = trim($key);
                $val = trim($val);
                if (strlen($val) >= 2 && (($val[0] === '"' && str_ends_with($val, '"')) || ($val[0] === "'" && str_ends_with($val, "'")))) {
                    $val = substr($val, 1, -1);
                }
                $values[$key] = $val;
            }
        }
        self::$values = $values;
        return $values;
    }

    public static function get(string $name, ?string $default = null): ?string
    {
        $values = self::load();
        $env = getenv($name);
        if ($env !== false) return $env;
        return $values[$name] ?? $default;
    }

    public static function require(string $name): string
    {
        $v = self::get($name);
        if ($v === null || $v === '') throw new RuntimeException("Missing env var: $name");
        return $v;
    }

    public static function bool(string $name, bool $default = false): bool
    {
        $v = self::get($name);
        if ($v === null) return $default;
        return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
    }

    public static function int(string $name, int $default): int
    {
        $v = self::get($name);
        return $v === null ? $default : (int) $v;
    }
}
