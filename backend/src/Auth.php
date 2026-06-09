<?php
declare(strict_types=1);

/**
 * Verifies the Cognito ID token, then upserts a mirror row in `users`
 * keyed by the Cognito `sub`, keeping role in sync with Cognito groups —
 * a straight port of backend/src/middleware/auth.ts + rbac.ts.
 */
final class Auth
{
    private const RANK = ['USER' => 1, 'MODERATOR' => 2, 'ADMIN' => 3];

    private static function roleFromGroups(?array $groups): string
    {
        $g = $groups ?? [];
        if (in_array('Administrators', $g, true)) return 'ADMIN';
        if (in_array('Moderators', $g, true)) return 'MODERATOR';
        return 'USER';
    }

    /** Active auth driver: env AUTH_DRIVER=local|cognito, default auto-detect. */
    public static function driver(): string
    {
        $configured = strtolower((string) Config::get('AUTH_DRIVER', 'auto'));
        if ($configured === 'local' || $configured === 'cognito') return $configured;
        $pool = (string) Config::get('COGNITO_USER_POOL_ID', '');
        $looksReal = $pool !== '' && !str_contains($pool, 'xxxxxxxxx');
        return $looksReal ? 'cognito' : 'local';
    }

    /** Returns the synced local user row for the bearer token, or throws HttpError. */
    public static function authenticate(): array
    {
        $token = Http::bearerToken();
        if ($token === null) throw new HttpError(401, 'Missing bearer token');

        if (self::driver() === 'local') {
            return LocalAuth::verifyIdToken($token);
        }

        try {
            $payload = Cognito::verifyIdToken($token);
        } catch (HttpError $e) {
            throw $e;
        } catch (Throwable) {
            throw new HttpError(401, 'Invalid or expired token');
        }

        $sub = (string) ($payload['sub'] ?? '');
        $email = (string) ($payload['email'] ?? '');
        $username = (string) ($payload['cognito:username'] ?? $payload['email'] ?? $sub);
        $role = self::roleFromGroups($payload['cognito:groups'] ?? null);

        $existing = Db::one('SELECT id FROM users WHERE cognito_sub = ?', [$sub]);
        if ($existing) {
            Db::exec('UPDATE users SET email = ?, role = ? WHERE cognito_sub = ?', [$email, $role, $sub]);
            $id = $existing['id'];
        } else {
            $id = Uuid::v4();
            Db::exec(
                'INSERT INTO users (id, cognito_sub, username, email, role) VALUES (?,?,?,?,?)',
                [$id, $sub, $username, $email, $role]
            );
        }

        $user = Db::one('SELECT id, cognito_sub AS cognitoSub, username, email, role, is_active FROM users WHERE id = ?', [$id]);
        if (!$user) throw new HttpError(401, 'User sync failed');
        if ((int) $user['is_active'] !== 1) throw new HttpError(403, 'Account disabled');

        unset($user['is_active']);
        return $user;
    }

    /** Throws 403 unless $user's role rank is >= $min. */
    public static function requireRole(array $user, string $min): void
    {
        if ((self::RANK[$user['role']] ?? 0) < (self::RANK[$min] ?? 99)) {
            throw new HttpError(403, "Requires $min role");
        }
    }
}
