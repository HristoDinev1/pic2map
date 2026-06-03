import { fetchAuthSession } from 'aws-amplify/auth';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000/api';

async function authHeader(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  get:  <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch:<T>(p: string, body?: unknown) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put:  <T>(p: string, body?: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del:  <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  base: BASE,
  authHeader,
};

/** Upload an original directly to S3 using a presigned PUT URL. */
export async function uploadPhoto(file: File, title?: string) {
  const { photoId, uploadUrl } = await api.post<{ photoId: string; uploadUrl: string }>(
    '/photos/presign',
    { filename: file.name, contentType: file.type, title }
  );
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error('S3 upload failed');
  return photoId;
}
