import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

export const s3 = new S3Client({ region: env.awsRegion });

/** Presigned PUT so the browser uploads the original directly to S3. */
export async function presignUpload(key: string, contentType: string, expires = 900) {
  const cmd = new PutObjectCommand({
    Bucket: env.s3Bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: expires });
}

/** Presigned GET (used when no public CDN base url is configured). */
export async function presignDownload(key: string, expires = 3600) {
  if (!key) return null;
  const cmd = new GetObjectCommand({ Bucket: env.s3Bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expires });
}

/** Resolve an object key to a browser-usable URL (CDN or presigned). */
export async function resolveUrl(key?: string | null): Promise<string | null> {
  if (!key) return null;
  if (env.s3PublicBaseUrl) return `${env.s3PublicBaseUrl.replace(/\/$/, '')}/${key}`;
  return presignDownload(key);
}

export async function deleteObject(key?: string | null) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
}
