<?php
declare(strict_types=1);

/**
 * Local auth driver — replaces Cognito when AUTH_DRIVER=local (or no user pool
 * is configured). Accounts live in the same `users` table (cognito_sub stores
 * "local:{uuid}"), passwords use PHP's built-in password_hash/password_verify,
 * sessions are HMAC-signed tokens (see Token.php). The /auth/me contract and
 * role model are identical to the Cognito path, so every route works unchanged.
 */
final class LocalAuth
{
    private const ID_TTL = 3600;            // 1h, mirrors Cognito's ExpiresIn
    private const REFRESH_TTL = 30 * 86400; // 30 days

    public static function register(string $username, string $email, string $password): array
    {
        if (!preg_match('/^[A-Za-z0-9_.-]{3,60}$/', $username)) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['username' => ['3-60 chars: letters, digits, _ . -']]]);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['email' => ['Invalid email address']]]);
        }
        if (strlen($password) < 8) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['password' => ['At least 8 characters']]]);
        }
        if (Db::one('SELECT id FROM users WHERE username = ? OR email = ?', [$username, $email])) {
            throw new HttpError(409, 'Username or email already in use');
        }

        $id = Uuid::v4();
        // First account on a fresh installation becomes ADMIN so the instance
        // is administrable without any out-of-band bootstrap step.
        $isFirst = !Db::one('SELECT id FROM users LIMIT 1');
        Db::exec(
            'INSERT INTO users (id, cognito_sub, username, email, role, password_hash) VALUES (?,?,?,?,?,?)',
            [$id, "local:$id", $username, $email, $isFirst ? 'ADMIN' : 'USER', password_hash($password, PASSWORD_DEFAULT)]
        );
        return ['id' => $id, 'username' => $username, 'autoConfirmed' => true];
    }

    public static function login(string $usernameOrEmail, string $password): array
    {
        $u = Db::one(
            'SELECT id, username, email, role, is_active, password_hash FROM users WHERE username = ? OR email = ?',
            [$usernameOrEmail, $usernameOrEmail]
        );
        // Constant-shape failure: don't reveal whether the account exists.
        if (!$u || $u['password_hash'] === null || !password_verify($password, $u['password_hash'])) {
            throw new HttpError(401, 'Incorrect username or password');
        }
        if ((int) $u['is_active'] !== 1) throw new HttpError(403, 'Account disabled');
        return self::tokensFor($u);
    }

    public static function refresh(string $refreshToken): array
    {
        $claims = Token::verify($refreshToken);
        if (($claims['use'] ?? '') !== 'refresh') throw new HttpError(401, 'Not a refresh token');
        $u = Db::one('SELECT id, username, email, role, is_active FROM users WHERE id = ?', [$claims['uid'] ?? '']);
        if (!$u || (int) $u['is_active'] !== 1) throw new HttpError(401, 'Account unavailable');
        return self::tokensFor($u);
    }

    public static function changePassword(array $user, string $current, string $new): void
    {
        $row = Db::one('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
        if (!$row || $row['password_hash'] === null || !password_verify($current, $row['password_hash'])) {
            throw new HttpError(401, 'Current password is incorrect');
        }
        if (strlen($new) < 8) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['password' => ['At least 8 characters']]]);
        }
        Db::exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $user['id']]);
    }

    /** Verifies a local id token and returns the user row (Auth::authenticate's local branch). */
    public static function verifyIdToken(string $token): array
    {
        $claims = Token::verify($token);
        if (($claims['use'] ?? '') !== 'id') throw new HttpError(401, 'Not an id token');
        $user = Db::one(
            'SELECT id, cognito_sub AS cognitoSub, username, email, role, is_active FROM users WHERE id = ?',
            [$claims['uid'] ?? '']
        );
        if (!$user) throw new HttpError(401, 'Unknown user');
        if ((int) $user['is_active'] !== 1) throw new HttpError(403, 'Account disabled');
        unset($user['is_active']);
        return $user;
    }

    private static function tokensFor(array $u): array
    {
        $base = ['uid' => $u['id'], 'username' => $u['username'], 'role' => $u['role']];
        return [
            'username' => $u['username'],
            'idToken' => Token::issue($base + ['use' => 'id'], self::ID_TTL),
            'accessToken' => Token::issue($base + ['use' => 'id'], self::ID_TTL),
            'refreshToken' => Token::issue(['uid' => $u['id'], 'use' => 'refresh'], self::REFRESH_TTL),
            'expiresIn' => self::ID_TTL,
        ];
    }
}
