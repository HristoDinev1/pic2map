import { cognito } from './cognito.js';

const BASE = window.PIC2MAP_CONFIG.apiBase;

async function authHeader() {
  const token = await cognito.idToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, init = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
    ...(init.headers || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 204) return undefined;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  get:   (p) => request(p),
  post:  (p, body) => request(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: (p, body) => request(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put:   (p, body) => request(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del:   (p) => request(p, { method: 'DELETE' }),
  base: BASE,
  authHeader,
};

/** Upload an original directly to S3 using a presigned PUT URL. */
export async function uploadPhoto(file, title) {
  const { photoId, uploadUrl } = await api.post('/photos/presign', {
    filename: file.name, contentType: file.type, title,
  });
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error('S3 upload failed');
  return photoId;
}
