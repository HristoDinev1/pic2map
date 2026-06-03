import { Router } from 'express';
import multer from 'multer';
import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { query } from '../lib/db';

const r = Router();
r.use(authenticate);
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

const FIELDS = ['title', 'latitude', 'longitude', 'owner', 'uploadDate', 'captureDate'];

async function ownExportRows(userId: string) {
  return query(
    `SELECT p.title, p.latitude, p.longitude, u.username AS owner,
            p.created_at AS "uploadDate", p.captured_at AS "captureDate"
     FROM photos p JOIN users u ON u.id=p.owner_id
     WHERE p.owner_id=$1 ORDER BY p.created_at DESC`,
    [userId]
  );
}

// ---- EXPORT JSON ----
r.get('/export.json', async (req, res) => {
  const rows = await ownExportRows(req.user!.id);
  res.setHeader('Content-Disposition', 'attachment; filename="pic2map-export.json"');
  res.json({ exportedAt: new Date().toISOString(), count: rows.length, photos: rows });
});

// ---- EXPORT CSV ----
r.get('/export.csv', async (req, res) => {
  const rows = await ownExportRows(req.user!.id);
  const csv = stringify(rows, { header: true, columns: FIELDS });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="pic2map-export.csv"');
  res.send(csv);
});

// ---- IMPORT (JSON or CSV metadata collections) ----
// Creates metadata-only photo records (no binary). Useful to seed the map
// from an exported collection. Records get a placeholder original key.
const importRow = z.object({
  title: z.string().default('Imported'),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  captureDate: z.string().nullable().optional(),
});

r.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded (field: file)');
  const text = req.file.buffer.toString('utf8');
  let records: unknown[];

  if (req.file.originalname.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    const parsed = JSON.parse(text);
    records = Array.isArray(parsed) ? parsed : parsed.photos ?? [];
  } else {
    records = parse(text, { columns: true, skip_empty_lines: true });
  }

  let imported = 0;
  for (const raw of records) {
    const row = importRow.parse(raw);
    await query(
      `INSERT INTO photos
        (owner_id, title, s3_key_original, latitude, longitude, captured_at,
         process_state, status, visibility)
       VALUES ($1,$2,$3,$4,$5,$6,'READY','PENDING','PRIVATE')`,
      [
        req.user!.id, row.title, `imported/${req.user!.id}/placeholder`,
        row.latitude ?? null, row.longitude ?? null,
        row.captureDate ? new Date(row.captureDate) : null,
      ]
    );
    imported++;
  }
  res.status(201).json({ imported });
});

export default r;
