import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { query } from '../lib/db';
import { serializePhotos, PhotoRow } from '../lib/serialize';

const r = Router();
r.use(authenticate);

/**
 * Unified search. Query params (all optional):
 *  username, album, title, dateFrom, dateTo,
 *  minLat,minLng,maxLat,maxLng  (GPS area)
 * Visibility rule: public+approved OR own photos.
 */
r.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const params: any[] = [req.user!.id];
  const where: string[] = [
    `((p.visibility='PUBLIC' AND p.status='APPROVED') OR p.owner_id = $1)`,
  ];
  const add = (sql: string, ...vals: any[]) => {
    vals.forEach((v) => params.push(v));
    where.push(sql);
  };

  if (q.username) add(`u.username ILIKE $${params.length + 1}`, `%${q.username}%`);
  if (q.title)    add(`p.title ILIKE $${params.length + 1}`, `%${q.title}%`);
  if (q.dateFrom) add(`COALESCE(p.captured_at,p.created_at) >= $${params.length + 1}`, q.dateFrom);
  if (q.dateTo)   add(`COALESCE(p.captured_at,p.created_at) <= $${params.length + 1}`, q.dateTo);
  if (q.minLat && q.maxLat && q.minLng && q.maxLng) {
    add(`p.latitude BETWEEN $${params.length + 1} AND $${params.length + 2}
         AND p.longitude BETWEEN $${params.length + 3} AND $${params.length + 4}`,
      +q.minLat, +q.maxLat, +q.minLng, +q.maxLng);
  }

  let join = `JOIN users u ON u.id = p.owner_id`;
  if (q.album) {
    join += ` JOIN album_photos ap ON ap.photo_id = p.id
              JOIN albums al ON al.id = ap.album_id`;
    add(`al.name ILIKE $${params.length + 1}`, `%${q.album}%`);
  }

  const rows = await query<PhotoRow>(
    `SELECT DISTINCT p.*, u.username AS owner_username
     FROM photos p ${join}
     WHERE ${where.join(' AND ')}
     ORDER BY p.created_at DESC LIMIT 500`,
    params
  );
  res.json({ photos: await serializePhotos(rows) });
});

export default r;
