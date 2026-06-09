'use strict';
/**
 * PIC2MAP image-processor Lambda
 * Trigger: S3 ObjectCreated on  originals/{userId}/{photoId}.{ext}
 *
 * Steps:
 *   1. Download the original from S3.
 *   2. Extract EXIF GPS (lat/lng) + capture date with `exifr`.
 *   3. Generate thumb (320w), medium (1024w), large (2048w) with `sharp`.
 *   4. Upload derivatives to S3 under thumbs/ medium/ large/.
 *   5. Update the photos row in RDS (MySQL/MariaDB) inside the VPC.
 *
 * Env: S3_BUCKET, DATABASE_URL (mysql://user:pass@host/db), DB_SSL
 * Logs go to CloudWatch automatically.
 */
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const exifr = require('exifr');
const sharp = require('sharp');
const mysql = require('mysql2/promise');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET;
const s3 = new S3Client({ region: REGION });

const SIZES = [
  { name: 'thumb', prefix: 'thumbs', width: 320 },
  { name: 'medium', prefix: 'medium', width: 1024 },
  { name: 'large', prefix: 'large', width: 2048 },
];

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
};

async function extractGps(buffer) {
  try {
    const gps = await exifr.gps(buffer);          // { latitude, longitude } | undefined
    const tags = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate']);
    const capturedAt = tags?.DateTimeOriginal || tags?.CreateDate || null;
    return {
      latitude: gps?.latitude ?? null,
      longitude: gps?.longitude ?? null,
      capturedAt: capturedAt ? new Date(capturedAt) : null,
    };
  } catch (e) {
    console.warn('EXIF parse failed:', e.message);
    return { latitude: null, longitude: null, capturedAt: null };
  }
}

exports.handler = async (event) => {
  const dbUrl = new URL(process.env.DATABASE_URL);
  const db = await mysql.createConnection({
    host: dbUrl.hostname,
    port: dbUrl.port || 3306,
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.replace(/^\//, ''),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    for (const record of event.Records) {
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      if (!key.startsWith('originals/')) continue;

      // originals/{userId}/{photoId}.{ext}
      const parts = key.split('/');
      const photoId = parts[2].split('.')[0];
      console.log(JSON.stringify({ msg: 'processing', key, photoId }));

      await db.execute(`UPDATE photos SET process_state='PROCESSING' WHERE id=?`, [photoId]);

      try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        const buffer = await streamToBuffer(obj.Body);

        const meta = await sharp(buffer).metadata();
        const gps = await extractGps(buffer);

        const derived = {};
        for (const s of SIZES) {
          const out = await sharp(buffer)
            .rotate()                                  // honour EXIF orientation
            .resize({ width: s.width, withoutEnlargement: true })
            .jpeg({ quality: s.name === 'thumb' ? 70 : 82 })
            .toBuffer();
          const dKey = `${s.prefix}/${photoId}.jpg`;
          await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: dKey, Body: out, ContentType: 'image/jpeg',
          }));
          derived[s.name] = dKey;
        }

        await db.execute(
          `UPDATE photos SET
             s3_key_thumb=?, s3_key_medium=?, s3_key_large=?,
             width=?, height=?, size_bytes=?,
             latitude=COALESCE(latitude,?), longitude=COALESCE(longitude,?),
             captured_at=COALESCE(captured_at,?),
             process_state='READY', process_error=NULL
           WHERE id=?`,
          [
            derived.thumb, derived.medium, derived.large,
            meta.width ?? null, meta.height ?? null, buffer.length,
            gps.latitude, gps.longitude, gps.capturedAt,
            photoId,
          ]
        );
        console.log(JSON.stringify({ msg: 'done', photoId, gps }));
      } catch (err) {
        console.error('processing failed', photoId, err);
        await db.execute(
          `UPDATE photos SET process_state='FAILED', process_error=? WHERE id=?`,
          [String(err.message).slice(0, 480), photoId]
        );
      }
    }
  } finally {
    await db.end();
  }
  return { ok: true };
};
