<?php
declare(strict_types=1);

/** Stats, user/role management, content removal — port of backend/src/routes/admin.ts (ADMIN only). */
return function (Router $r): void {
    $GROUP = ['USER' => '', 'MODERATOR' => 'Moderators', 'ADMIN' => 'Administrators'];

    $r->get('/admin/stats', function () {
        $user = Auth::authenticate();
        Auth::requireRole($user, 'ADMIN');
        $stats = Db::one('SELECT * FROM v_system_stats');
        if ($stats) foreach ($stats as $k => $v) $stats[$k] = is_numeric($v) ? (int) $v : $v;
        $recent = Db::query(
            'SELECT a.action, a.entity, a.entity_id, a.created_at, u.username AS actor
             FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
             ORDER BY a.created_at DESC LIMIT 25'
        );
        Http::json(['stats' => $stats, 'recentActivity' => $recent]);
    });

    $r->get('/admin/users', function () {
        $user = Auth::authenticate();
        Auth::requireRole($user, 'ADMIN');
        $users = Db::query(
            'SELECT id, username, email, role, is_active, created_at FROM users ORDER BY created_at DESC LIMIT 500'
        );
        foreach ($users as &$u) $u['is_active'] = (bool) $u['is_active'];
        Http::json(['users' => $users]);
    });

    // change a user's role (syncs Cognito groups + local cache)
    $r->patch('/admin/users/:id/role', function (array $params) use ($GROUP) {
        $user = Auth::authenticate();
        Auth::requireRole($user, 'ADMIN');
        $role = Http::optionalEnum(Http::body(), 'role', ['USER', 'MODERATOR', 'ADMIN']);
        if ($role === null) throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['role' => ['role is required']]]);

        $u = Db::one('SELECT * FROM users WHERE id = ?', [$params['id']]);
        if (!$u) throw new HttpError(404, 'User not found');

        // reset all elevated groups, then add the right one
        try { Cognito::removeUserGroup($u['username'], 'Moderators'); } catch (Throwable) {}
        try { Cognito::removeUserGroup($u['username'], 'Administrators'); } catch (Throwable) {}
        if ($GROUP[$role]) {
            try { Cognito::setUserGroup($u['username'], $GROUP[$role]); } catch (Throwable) {}
        }

        Db::exec('UPDATE users SET role = ? WHERE id = ?', [$role, $u['id']]);
        Db::exec(
            "INSERT INTO audit_log (actor_id, action, entity, entity_id, meta) VALUES (?,'SET_ROLE','user',?,?)",
            [$user['id'], $u['id'], json_encode(['role' => $role])]
        );
        Http::json(['ok' => true]);
    });

    // enable / disable a user
    $r->patch('/admin/users/:id/active', function (array $params) {
        $user = Auth::authenticate();
        Auth::requireRole($user, 'ADMIN');
        $body = Http::body();
        if (!array_key_exists('active', $body) || !is_bool($body['active'])) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['active' => ['active must be a boolean']]]);
        }
        $active = (bool) $body['active'];

        $u = Db::one('SELECT * FROM users WHERE id = ?', [$params['id']]);
        if (!$u) throw new HttpError(404, 'User not found');

        try { Cognito::setUserEnabled($u['username'], $active); } catch (Throwable) {}
        Db::exec('UPDATE users SET is_active = ? WHERE id = ?', [$active ? 1 : 0, $u['id']]);
        Http::json(['ok' => true]);
    });

    // admin can remove ANY photo
    $r->delete('/admin/photos/:id', function (array $params) {
        $user = Auth::authenticate();
        Auth::requireRole($user, 'ADMIN');
        $p = Db::one('SELECT id FROM photos WHERE id = ?', [$params['id']]);
        if (!$p) throw new HttpError(404, 'Photo not found');
        Db::exec('DELETE FROM photos WHERE id = ?', [$params['id']]);
        Http::noContent();
    });
};
