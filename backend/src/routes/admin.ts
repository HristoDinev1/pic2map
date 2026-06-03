import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { HttpError } from '../middleware/error';
import { query, one } from '../lib/db';
import { setUserGroup, removeUserGroup, setUserEnabled } from '../lib/cognito';

const r = Router();
r.use(authenticate, requireRole('ADMIN'));

// system statistics
r.get('/stats', async (_req, res) => {
  const stats = await one(`SELECT * FROM v_system_stats`);
  const recent = await query(
    `SELECT a.action, a.entity, a.entity_id, a.created_at, u.username AS actor
     FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id
     ORDER BY a.created_at DESC LIMIT 25`
  );
  res.json({ stats, recentActivity: recent });
});

// list users
r.get('/users', async (_req, res) => {
  const users = await query(
    `SELECT id, username, email, role, is_active, created_at FROM users
     ORDER BY created_at DESC LIMIT 500`
  );
  res.json({ users });
});

const GROUP: Record<string, string> = {
  USER: '', MODERATOR: 'Moderators', ADMIN: 'Administrators',
};

// change a user's role (syncs Cognito groups + local cache)
r.patch('/users/:id/role', async (req, res) => {
  const { role } = z.object({ role: z.enum(['USER', 'MODERATOR', 'ADMIN']) }).parse(req.body);
  const u = await one<any>(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
  if (!u) throw new HttpError(404, 'User not found');

  // reset all elevated groups, then add the right one
  await removeUserGroup(u.username, 'Moderators').catch(() => {});
  await removeUserGroup(u.username, 'Administrators').catch(() => {});
  if (GROUP[role]) await setUserGroup(u.username, GROUP[role]);

  await query(`UPDATE users SET role=$2 WHERE id=$1`, [u.id, role]);
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta)
     VALUES ($1,'SET_ROLE','user',$2,$3)`,
    [req.user!.id, u.id, JSON.stringify({ role })]
  );
  res.json({ ok: true });
});

// enable / disable a user
r.patch('/users/:id/active', async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const u = await one<any>(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
  if (!u) throw new HttpError(404, 'User not found');
  await setUserEnabled(u.username, active).catch(() => {});
  await query(`UPDATE users SET is_active=$2 WHERE id=$1`, [u.id, active]);
  res.json({ ok: true });
});

// admin can remove ANY photo
r.delete('/photos/:id', async (req, res) => {
  const p = await one<any>(`SELECT id FROM photos WHERE id=$1`, [req.params.id]);
  if (!p) throw new HttpError(404, 'Photo not found');
  await query(`DELETE FROM photos WHERE id=$1`, [req.params.id]);
  res.status(204).end();
});

export default r;
