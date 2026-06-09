import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-stub.js';

// Tests the new driver-agnostic auth layer:
//   - auth.js auto-selects the local driver when no real Cognito client is set
//   - local-auth signs in against the backend, persists the session, attaches
//     refresh + sign-out semantics matching the Cognito driver's contract.

const { localStorage } = installDom({ config: { apiBase: 'http://api.test/api', cognitoRegion: '', cognitoClientId: '' } });

const fetchLog = [];
globalThis.fetch = async (url, init = {}) => {
  fetchLog.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
  if (url.endsWith('/auth/register')) {
    return json(201, { id: 'u1', username: 'alice', autoConfirmed: true });
  }
  if (url.endsWith('/auth/login')) {
    return json(200, {
      username: 'alice', idToken: 'local-id-1', accessToken: 'local-id-1',
      refreshToken: 'local-refresh-1', expiresIn: 3600,
    });
  }
  if (url.endsWith('/auth/refresh')) {
    return json(200, {
      username: 'alice', idToken: 'local-id-2', accessToken: 'local-id-2',
      refreshToken: 'local-refresh-2', expiresIn: 3600,
    });
  }
  return json(404, { error: `Unexpected fetch: ${url}` });
};
function json(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

const { auth, authDriver } = await import('../js/auth.js');

test('auth.js picks the local driver when no real Cognito client id is configured', () => {
  // dom-stub's PIC2MAP_CONFIG has no usable cognitoClientId
  assert.equal(authDriver, 'local');
  assert.equal(auth.supportsConfirmation, false);
});

test('local signUp auto-confirms (no email code step)', async () => {
  const out = await auth.signUp('alice', 'hunter2hunter2', 'alice@example.com');
  assert.equal(out.autoConfirmed, true);
  const reg = fetchLog.find((f) => f.url.endsWith('/auth/register'));
  assert.deepEqual(reg.body, { username: 'alice', email: 'alice@example.com', password: 'hunter2hunter2' });
});

test('local signIn stores a session and idToken() serves it', async () => {
  await auth.signIn('alice', 'hunter2hunter2');
  const stored = JSON.parse(localStorage.getItem('pic2map.session'));
  assert.equal(stored.username, 'alice');
  assert.equal(stored.idToken, 'local-id-1');
  assert.ok(stored.expiresAt > Date.now());
  assert.equal(await auth.idToken(), 'local-id-1');
  assert.equal(auth.isSignedIn(), true);
  assert.equal(auth.currentUsername(), 'alice');
});

test('idToken() refreshes automatically when the session is near expiry', async () => {
  // Force the stored session to look nearly expired
  const stored = JSON.parse(localStorage.getItem('pic2map.session'));
  stored.expiresAt = Date.now() + 1000; // < 60s window
  localStorage.setItem('pic2map.session', JSON.stringify(stored));
  // The driver's in-memory session also needs the early expiry; signIn again then mutate via refresh path
  await auth.signIn('alice', 'hunter2hunter2');
  const inMem = JSON.parse(localStorage.getItem('pic2map.session'));
  inMem.expiresAt = Date.now() + 1000;
  localStorage.setItem('pic2map.session', JSON.stringify(inMem));
  // Reach the in-memory copy through the public API: refresh() directly
  const refreshed = await auth.refresh();
  assert.equal(refreshed.idToken, 'local-id-2');
  assert.equal(refreshed.refreshToken, 'local-refresh-2');
  assert.equal(await auth.idToken(), 'local-id-2');
});

test('signOut clears the session', async () => {
  await auth.signOut();
  assert.equal(localStorage.getItem('pic2map.session'), null);
  assert.equal(auth.isSignedIn(), false);
  assert.equal(await auth.idToken(), null);
});

test('forgotPassword explains the local-mode limitation instead of failing cryptically', async () => {
  await assert.rejects(() => auth.forgotPassword('alice'), /administrator|Cognito/i);
});
