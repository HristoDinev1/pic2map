import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { query, one } from '../lib/db';
import { serializePhotos, PhotoRow } from '../lib/serialize';

const r = Router();
r.use(authenticate);

const albumSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
});

async function ownAlbum(id: string, userId: string, role: string) {
  const a = await one<any>(`SELECT * FROM albums WHERE id=$1`, [id]);
  if (!a) throw new HttpError(404, 'Album not found');
  if (a.owner_id !== userId && role !== 'ADMIN') throw new HttpError(403, 'Not the owner');
  return a;
}

// list own albums (+ photo counts)
r.get('/', async (req, res) => {
  const albums = await query(
    `SELECT a.*, COUNT(ap.photo_id)::int AS photo_count
     FROM albums a LEFT JOIN album_photos ap ON ap.album_id = a.id
     WHERE a.owner_id = $1
     GROUP BY a.id ORDER BY a.created_at DESC`,
    [req.user!.id]
  );
  res.json({ albums });
});

// create
r.post('/', async (req, res) => {
  const b = albumSchema.parse(req.body);
  const album = await one(
    `INSERT INTO albums (owner_id, name, description, visibility)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user!.id, b.name, b.description ?? null, b.visibility ?? 'PRIVATE']
  );
  res.status(201).json({ album });
});

// get album + its photos
r.get('/:id', async (req, res) => {
  const a = await one<any>(`SELECT * FROM albums WHERE id=$1`, [req.params.id]);
  if (!a) throw new HttpError(404, 'Album not found');
  const priv = req.user!.role !== 'USER';
  if (a.owner_id !== req.user!.id && a.visibility !== 'PUBLIC' && !priv) {
    throw new HttpError(403, 'Not allowed');
  }
  const rows = await query<PhotoRow>(
    `SELECT p.*, u.username AS owner_username
     FROM album_photos ap
     JOIN photos p ON p.id = ap.photo_id
     JOIN users u ON u.id = p.owner_id
     WHERE ap.album_id = $1 ORDER BY ap.added_at DESC`,
    [req.params.id]
  );
  res.json({ album: a, photos: await serializePhotos(rows) });
});

// edit
r.patch('/:id', async (req, res) => {
  await ownAlbum(req.params.id, req.user!.id, req.user!.role);
  const b = albumSchema.partial().parse(req.body);
  const album = await one(
    `UPDATE albums SET
       name=COALESCE($2,name),
       description=COALESCE($3,description),
       visibility=COALESCE($4,visibility)
     WHERE id=$1 RETURNING *`,
    [req.params.id, b.name ?? null, b.description ?? null, b.visibility ?? null]
  );
  res.json({ album });
});

// delete
r.delete('/:id', async (req, res) => {
  await ownAlbum(req.params.id, req.user!.id, req.user!.role);
  await query(`DELETE FROM albums WHERE id=$1`, [req.params.id]);
  res.status(204).end();
});

// add photo to album
r.post('/:id/photos', async (req, res) => {
  await ownAlbum(req.params.id, req.user!.id, req.user!.role);
  const { photoId } = z.object({ photoId: z.string().uuid() }).parse(req.body);
  const photo = await one(`SELECT id FROM photos WHERE id=$1 AND owner_id=$2`,
    [photoId, req.user!.id]);
  if (!photo) throw new HttpError(404, 'Photo not found or not yours');
  await query(
    `INSERT INTO album_photos (album_id, photo_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`, [req.params.id, photoId]);
  res.status(201).json({ ok: true });
});

// remove photo from album
r.delete('/:id/photos/:photoId', async (req, res) => {
  await ownAlbum(req.params.id, req.user!.id, req.user!.role);
  await query(`DELETE FROM album_photos WHERE album_id=$1 AND photo_id=$2`,
    [req.params.id, req.params.photoId]);
  res.status(204).end();
});

export default r;
