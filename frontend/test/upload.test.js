import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubElement, findOne, findAll, settle } from './dom-stub.js';

// End-to-end (frontend) test of the upload flow:
//   choose file → button enables → click Upload →
//   POST /photos/presign → XHR PUT to the presigned S3 URL (with progress) →
//   poll GET /photos/:id until READY → success status with "View on map".
// The real page module runs unmodified; only the network layer is stubbed.

const { localStorage } = installDom();

// A signed-in Cognito session so api.js attaches an Authorization header.
localStorage.setItem('pic2map.session', JSON.stringify({
  username: 'tester',
  idToken: 'id-token-123',
  accessToken: 'at',
  refreshToken: 'rt',
  expiresAt: Date.now() + 60 * 60 * 1000,
}));

// ---- fetch stub (API calls) ------------------------------------------------
const fetchLog = [];
globalThis.fetch = async (url, init = {}) => {
  fetchLog.push({ url, init });
  if (url.endsWith('/photos/presign')) {
    return jsonResponse(201, { photoId: 'p1', key: 'originals/u/p1.jpg', uploadUrl: 'https://s3.test/upload/p1' });
  }
  if (url.endsWith('/photos/p1')) {
    return jsonResponse(200, {
      photo: { id: 'p1', title: 'sunset', processState: 'READY', latitude: 42.7, longitude: 23.3, urls: { thumb: 't.jpg' } },
    });
  }
  return jsonResponse(404, { error: `Unexpected fetch: ${url}` });
};
function jsonResponse(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

// ---- XMLHttpRequest stub (S3 PUT) -------------------------------------------
const xhrLog = [];
globalThis.XMLHttpRequest = class {
  constructor() {
    this.headers = {};
    this.upload = {
      addEventListener: (type, fn) => { if (type === 'progress') this._onProgress = fn; },
    };
  }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(body) {
    xhrLog.push(this);
    this.body = body;
    queueMicrotask(() => {
      if (this._onProgress) {
        this._onProgress({ lengthComputable: true, loaded: 50, total: 100 });
        this._onProgress({ lengthComputable: true, loaded: 100, total: 100 });
      }
      this.status = 200;
      this.onload();
    });
  }
};

// A stand-in File: plain JPEG bytes without EXIF (GPS check must not crash on it).
function fakeFile(name, type) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  return {
    name, type, size: 123456,
    arrayBuffer: async () => bytes.buffer,
  };
}

const { renderUploadPage } = await import('../js/pages/upload.js');

test('upload page: button disabled until a file is chosen', async () => {
  const node = new StubElement('main');
  renderUploadPage(node);
  const uploadBtn = findOne(node, (n) => n.tagName === 'BUTTON' && /^Upload/.test(n.textContent));
  assert.ok(uploadBtn, 'upload button rendered');
  assert.equal(uploadBtn.disabled, true);
});

test('upload button works: presign → S3 PUT → READY status', async () => {
  fetchLog.length = 0;
  xhrLog.length = 0;

  const node = new StubElement('main');
  renderUploadPage(node);

  // 1. "choose" a file via the hidden input
  const input = findOne(node, (n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'file');
  assert.ok(input, 'file input rendered');
  const file = fakeFile('sunset.jpg', 'image/jpeg');
  input.files = [file];
  input.dispatchEvent({ type: 'change', target: input });
  await settle();

  // A preview row appears with an editable title (filename without extension)
  const titleInput = findOne(node, (n) => n.tagName === 'INPUT' && n.getAttribute('placeholder') === 'Title');
  assert.ok(titleInput, 'per-file title input rendered');
  assert.equal(titleInput.value, 'sunset');

  // The GPS badge resolved (this file has no EXIF → "set it later" hint)
  const badge = findOne(node, (n) => n.classList.contains('badge'));
  assert.match(badge.textContent, /no GPS/i);

  // 2. button is now enabled — click it
  const uploadBtn = findOne(node, (n) => n.tagName === 'BUTTON' && /^Upload/.test(n.textContent));
  assert.equal(uploadBtn.disabled, false);
  uploadBtn.dispatchEvent({ type: 'click' });
  await settle(20);

  // 3. presign was requested with auth + the file's metadata
  const presign = fetchLog.find((f) => f.url.endsWith('/photos/presign'));
  assert.ok(presign, 'presign endpoint called');
  assert.equal(presign.init.method, 'POST');
  assert.equal(presign.init.headers.Authorization, 'Bearer id-token-123');
  const presignBody = JSON.parse(presign.init.body);
  assert.equal(presignBody.filename, 'sunset.jpg');
  assert.equal(presignBody.contentType, 'image/jpeg');
  assert.equal(presignBody.title, 'sunset');

  // 4. the original was PUT to the presigned S3 URL via XHR
  assert.equal(xhrLog.length, 1);
  assert.equal(xhrLog[0].method, 'PUT');
  assert.equal(xhrLog[0].url, 'https://s3.test/upload/p1');
  assert.equal(xhrLog[0].headers['Content-Type'], 'image/jpeg');
  assert.equal(xhrLog[0].body, file);

  // 5. the processing poll ran and the row reports success + map availability
  const poll = fetchLog.find((f) => f.url.endsWith('/photos/p1'));
  assert.ok(poll, 'processing status polled');
  const statusEl = findOne(node, (n) => n.classList.contains('upload-status'));
  assert.match(statusEl.textContent, /Ready — geotagged and on the map/);
  const mapBtn = findOne(node, (n) => n.tagName === 'BUTTON' && n.textContent === 'View on map');
  assert.ok(mapBtn, '"View on map" action rendered');
});

test('upload failure shows an error and offers retry', async () => {
  // Make S3 fail once.
  const OriginalXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class extends OriginalXHR {
    send(body) {
      queueMicrotask(() => { this.status = 403; this.onload(); });
    }
  };

  const node = new StubElement('main');
  renderUploadPage(node);
  const input = findOne(node, (n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'file');
  input.files = [fakeFile('broken.jpg', 'image/jpeg')];
  input.dispatchEvent({ type: 'change', target: input });
  await settle();

  const uploadBtn = findOne(node, (n) => n.tagName === 'BUTTON' && /^Upload/.test(n.textContent));
  uploadBtn.dispatchEvent({ type: 'click' });
  await settle(20);

  const statusEl = findOne(node, (n) => n.classList.contains('upload-status'));
  assert.match(statusEl.textContent, /S3 upload failed \(403\)/);
  const retry = findOne(node, (n) => n.tagName === 'BUTTON' && n.textContent === 'Retry');
  assert.ok(retry, 'retry button offered');

  globalThis.XMLHttpRequest = OriginalXHR;
});

test('non-image files are rejected client-side', async () => {
  const node = new StubElement('main');
  renderUploadPage(node);
  const input = findOne(node, (n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'file');
  input.files = [fakeFile('notes.txt', 'text/plain')];
  input.dispatchEvent({ type: 'change', target: input });
  await settle();

  assert.ok(findAll(node, (n) => n.classList.contains('error'))
    .some((n) => /not a supported image/.test(n.textContent)));
  const uploadBtn = findOne(node, (n) => n.tagName === 'BUTTON' && /^Upload/.test(n.textContent));
  assert.equal(uploadBtn.disabled, true);
});
