import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { query } from '../lib/db';
import { serializePhotos, PhotoRow } from '../lib/serialize';

const r = Router();
r.use(authenticate);

/**
 * Geotagged photos for the map. Returns:
 *  - all PUBLIC + APPROVED photos
 *  - PLUS the caller's own photos (any visibility)
 * Optional bbox filter: ?minLat&minLng&maxLat&maxLng
 */
r.get('/photos', async (req, res) => {
  const { minLat, minLng, maxLat, maxLng } = req.query as Record<string, string>;
  const params: any[] = [req.user!.id];
  let bbox = '';
  if (minLat && minLng && maxLat && maxLng) {
    params.push(+minLat, +maxLat, +minLng, +maxLng);
    bbox = `AND p.latitude BETWEEN $2 AND $3 AND p.longitude BETWEEN $4 AND $5`;
  }
  const rows = await query<PhotoRow>(
    `SELECT p.*, u.username AS owner_username
     FROM photos p JOIN users u ON u.id = p.owner_id
     WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
       AND ( (p.visibility='PUBLIC' AND p.status='APPROVED') OR p.owner_id = $1 )
       ${bbox}
     ORDER BY p.captured_at DESC NULLS LAST
     LIMIT 2000`,
    params
  );
  res.json({ photos: await serializePhotos(rows) });
});

export default r;
