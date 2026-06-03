import { resolveUrl } from './s3';

export interface PhotoRow {
  id: string; owner_id: string; title: string; description: string | null;
  s3_key_original: string; s3_key_thumb: string | null;
  s3_key_medium: string | null; s3_key_large: string | null;
  content_type: string | null; size_bytes: string | null;
  width: number | null; height: number | null;
  latitude: number | null; longitude: number | null;
  captured_at: string | null; visibility: 'PUBLIC' | 'PRIVATE';
  status: string; process_state: string; process_error: string | null;
  created_at: string; updated_at: string;
  owner_username?: string;
}

/** Convert a DB row into the API shape, resolving S3 keys to URLs. */
export async function serializePhoto(p: PhotoRow) {
  const [original, thumb, medium, large] = await Promise.all([
    resolveUrl(p.s3_key_original),
    resolveUrl(p.s3_key_thumb),
    resolveUrl(p.s3_key_medium),
    resolveUrl(p.s3_key_large),
  ]);
  return {
    id: p.id,
    ownerId: p.owner_id,
    ownerUsername: p.owner_username,
    title: p.title,
    description: p.description,
    urls: { original, thumb, medium, large },
    contentType: p.content_type,
    sizeBytes: p.size_bytes ? Number(p.size_bytes) : null,
    width: p.width,
    height: p.height,
    latitude: p.latitude,
    longitude: p.longitude,
    capturedAt: p.captured_at,
    visibility: p.visibility,
    status: p.status,
    processState: p.process_state,
    processError: p.process_error,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export async function serializePhotos(rows: PhotoRow[]) {
  return Promise.all(rows.map(serializePhoto));
}
