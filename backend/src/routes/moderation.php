<?php
declare(strict_types=1);

/** Review queue + approve/reject/delete actions — port of backend/src/routes/moderation.ts (MODERATOR+). */
return function (Router $r): void {
    $r->get('/moderation/queue', function () {
        $user = Auth::authenticate();
        Auth::requireRole($user, 'MODERATOR');
        $rows = Db::query(
            "SELECT p.*, u.username AS owner_username
             FROM photos p JOIN users u ON u.id = p.owner_id
             WHERE p.status = 'PENDING' ORDER BY p.created_at ASC LIMIT 200"
        );
        Http::json(['photos' => Serialize::photos($rows)]);
    });

    $r->post('/moderation/photos/:id', function (array $params) {
        $user = Auth::authenticate();
        Auth::requireRole($user, 'MODERATOR');

        $body = Http::body();
        $action = Http::optionalEnum($body, 'action', ['APPROVE', 'REJECT', 'DELETE']);
        if ($action === null) {
            throw new HttpError(400, 'Validation failed', ['fieldErrors' => ['action' => ['action is required']]]);
        }
        $reason = Http::optionalString($body, 'reason', 500);

        $p = Db::one('SELECT * FROM photos WHERE id = ?', [$params['id']]);
        if (!$p) throw new HttpError(404, 'Photo not found');

        Db::tx(function () use ($p, $action, $reason, $user) {
            Db::exec(
                'INSERT INTO moderation_actions (id, photo_id, moderator_id, action, reason) VALUES (?,?,?,?,?)',
                [Uuid::v4(), $p['id'], $user['id'], $action, $reason]
            );
            Db::exec(
                "INSERT INTO audit_log (actor_id, action, entity, entity_id, meta) VALUES (?,?,'photo',?,?)",
                [$user['id'], "MOD_$action", $p['id'], json_encode(['reason' => $reason])]
            );
            if ($action === 'DELETE') {
                // Use the Storage facade — calling S3::deleteObject directly
                // crashes the local driver on a missing AWS_ACCESS_KEY_ID.
                Storage::deleteObject($p['s3_key_original']);
                Storage::deleteObject($p['s3_key_thumb']);
                Storage::deleteObject($p['s3_key_medium']);
                Storage::deleteObject($p['s3_key_large']);
                // photos.id is set NULL on the moderation_actions row by the
                // FK's ON DELETE SET NULL — the audit row above keeps the id.
                Db::exec('DELETE FROM photos WHERE id = ?', [$p['id']]);
            } else {
                Db::exec('UPDATE photos SET status = ? WHERE id = ?', [$action === 'APPROVE' ? 'APPROVED' : 'REJECTED', $p['id']]);
            }
        });

        Http::json(['ok' => true]);
    });
};
