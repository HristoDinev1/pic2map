import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { query, one } from '../lib/db';
import { presignUpload, deleteObject } from '../lib/s3';
import { serializePhoto, serializePhotos, PhotoRow } from '../lib/serialize';

const r = Router();
r.use(authenticate);

const PHOTO_COLS = `
  p.id, p.owner_id, p.title, p.description,
  p.s3_key_original, p.s3_key_thumb, p.s3_key_medium, p.s3_key_large,
  p.content_type, p.size_bytes, p.width, p.height,
  p.latitude, p.longitude, p.captured_at, p.visibility,
  p.status, p.process_state, p.process_error, p.created_at, p.updated_at,
  u.username AS owner_username`;

/* ---- 1. request a presigned upload URL --------------------------------
   Browser PUTs the original to S3 under originals/{userId}/{photoId}.{ext}
   The S3 ObjectCreated event then triggers the image-processor Lambda,
   which generates thumb/medium/large + extracts EXIF GPS and updates RDS. */
const presignSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().regex(/^image\/(jpe?g|png|webp|tiff?|heic)$/i),
  title: z.string().max(200).optional(),
});

r.post('/presign', async (req, res) => {
  const body = presignSchema.parse(req.body);
  const ext = (body.filename.split('.').pop() || 'jpg').toLowerCase();
  const photoId = randomUUID();
  const key = `originals/${req.user!.id}/${photoId}.${ext}`;

  await query(
    `INSERT INTO photos (id, owner_id, title, s3_key_original, content_type, process_state)
     VALUES ($1,$2,$3,$4,$5,'UPLOADED')`,
    [photoId, req.user!.id, body.title ?? body.filename, key, body.contentType]
  );

  const uploadUrl = await presignUpload(key, body.contentType);
  res.status(201).json({ photoId, key, uploadUrl });
});

/* ---- 2. personal gallery (own photos, any status) -------------------- */
r.get('/', async (req, res) => {
  const rows = await query<PhotoRow>(
    `SELECT ${PHOTO_COLS} FROM photos p JOIN users u ON u.id = p.owner_id
     WHERE p.owner_id = $1 ORDER BY p.created_at DESC`,
    [req.user!.id]
  );
  res.json({ photos: await serializePhotos(rows) });
});

/* ---- 3. single photo (owner OR public OR privileged) ----------------- */
r.get('/:id', async (req, res) => {
  const p = await one<PhotoRow>(
    `SELECT ${PHOTO_COLS} FROM photos p JOIN users u ON u.id=p.owner_id WHERE p.id=$1`,
    [req.params.id]
  );
  if (!p) throw new HttpError(404, 'Photo not found');
  const priv = req.user!.role !== 'USER';
  if (p.owner_id !== req.user!.id && p.visibility !== 'PUBLIC' && !priv) {
    throw new HttpError(403, 'Not allowed');
  }
  res.json({ photo: await serializePhoto(p) });
});

async function ownedPhoto(id: string, userId: string, role: string) {
  const p = await one<PhotoRow>(`SELECT * FROM photos WHERE id=$1`, [id]);
  if (!p) throw new HttpError(404, 'Photo not found');
  if (p.owner_id !== userId && role !== 'ADMIN') throw new HttpError(403, 'Not the owner');
  return p;
}

/* ---- 4. update title/description/visibility -------------------------- */
const updateSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
});
r.patch('/:id', async (req, res) => {
  await ownedPhoto(req.params.id, req.user!.id, req.user!.role);
  const b = updateSchema.parse(req.body);
  const updated = await one<PhotoRow>(
    `UPDATE photos SET
       title=COALESCE($2,title),
       description=COALESCE($3,description),
       visibility=COALESCE($4,visibility)
     WHERE id=$1 RETURNING *`,
    [req.params.id, b.title ?? null, b.description ?? null, b.visibility ?? null]
  );
  res.json({ photo: await serializePhoto(updated as any) });
});

/* ---- 5. GPS editing: add / modify / remove --------------------------- */
const gpsSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});
r.put('/:id/gps', async (req, res) => {
  await ownedPhoto(req.params.id, req.user!.id, req.user!.role);
  const { latitude, longitude } = gpsSchema.parse(req.body);
  if ((latitude === null) !== (longitude === null)) {
    throw new HttpError(400, 'latitude and longitude must both be set or both null');
  }
  const updated = await one<PhotoRow>(
    `UPDATE photos SET latitude=$2, longitude=$3 WHERE id=$1 RETURNING *`,
    [req.params.id, latitude, longitude]
  );
  res.json({ photo: await serializePhoto(updated as any) });
});

/* ---- 6. delete (also removes all S3 derivatives) --------------------- */
r.delete('/:id', async (req, res) => {
  const p = await ownedPhoto(req.params.id, req.user!.id, req.user!.role);
  await Promise.all([
    deleteObject(p.s3_key_original), deleteObject(p.s3_key_thumb),
    deleteObject(p.s3_key_medium), deleteObject(p.s3_key_large),
  ]);
  await query(`DELETE FROM photos WHERE id=$1`, [req.params.id]);
  res.status(204).end();
});

export default r;
