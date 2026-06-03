import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { HttpError } from '../middleware/error';
import { query, one, tx } from '../lib/db';
import { deleteObject } from '../lib/s3';
import { serializePhotos, PhotoRow } from '../lib/serialize';

const r = Router();
r.use(authenticate, requireRole('MODERATOR'));

// review queue
r.get('/queue', async (_req, res) => {
  const rows = await query<PhotoRow>(
    `SELECT p.*, u.username AS owner_username
     FROM photos p JOIN users u ON u.id=p.owner_id
     WHERE p.status='PENDING' ORDER BY p.created_at ASC LIMIT 200`
  );
  res.json({ photos: await serializePhotos(rows) });
});

const actionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'DELETE']),
  reason: z.string().max(500).optional(),
});

r.post('/photos/:id', async (req, res) => {
  const { action, reason } = actionSchema.parse(req.body);
  const p = await one<any>(`SELECT * FROM photos WHERE id=$1`, [req.params.id]);
  if (!p) throw new HttpError(404, 'Photo not found');

  await tx(async (c) => {
    if (action === 'DELETE') {
      await Promise.all([
        deleteObject(p.s3_key_original), deleteObject(p.s3_key_thumb),
        deleteObject(p.s3_key_medium), deleteObject(p.s3_key_large),
      ]);
      await c.query(`DELETE FROM photos WHERE id=$1`, [p.id]);
    } else {
      await c.query(`UPDATE photos SET status=$2 WHERE id=$1`,
        [p.id, action === 'APPROVE' ? 'APPROVED' : 'REJECTED']);
    }
    await c.query(
      `INSERT INTO moderation_actions (photo_id, moderator_id, action, reason)
       VALUES ($1,$2,$3,$4)`,
      [p.id, req.user!.id, action, reason ?? null]
    );
    await c.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
       VALUES ($1,$2,'photo',$3,$4)`,
      [req.user!.id, `MOD_${action}`, p.id, JSON.stringify({ reason })]
    );
  });
  res.json({ ok: true });
});

export default r;
