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

/**
 * Upload an original directly to S3 using a presigned PUT URL.
 * `onProgress(0..1)` reports byte-level upload progress (XHR is used because
 * fetch() cannot observe request-body progress — still zero libraries).
 */
export async function uploadPhoto(file, title, onProgress) {
  const { photoId, uploadUrl } = await api.post('/photos/presign', {
    filename: file.name, contentType: file.type, title,
  });

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    if (xhr.upload && onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`S3 upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('S3 upload failed (network error)'));
    xhr.send(file);
  });

  if (onProgress) onProgress(1);
  return photoId;
}
