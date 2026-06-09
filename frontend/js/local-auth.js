// Local auth driver — same interface as cognito.js, but talking to this app's
// own backend (/auth/register, /auth/login, /auth/refresh). Used when the
// backend runs with AUTH_DRIVER=local, i.e. fully self-hosted with no AWS.
// Session storage key + shape are identical to the Cognito driver, so the rest
// of the app (api.js, auth-store.js) is completely driver-agnostic.

const BASE = window.PIC2MAP_CONFIG.apiBase;
const STORAGE_KEY = 'pic2map.session';

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Auth request failed (${res.status})`);
  return data;
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
function saveSession(session) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

let session = loadSession();

function fromTokens(out) {
  return {
    username: out.username,
    idToken: out.idToken,
    accessToken: out.accessToken,
    refreshToken: out.refreshToken || (session && session.refreshToken) || null,
    expiresAt: Date.now() + (out.expiresIn || 3600) * 1000,
  };
}

export const localAuth = {
  /** No email confirmation step locally — accounts are usable immediately. */
  supportsConfirmation: false,
  supportsPasswordReset: false,

  async signUp(username, password, email) {
    const out = await call('/auth/register', { username, email, password });
    return { autoConfirmed: !!out.autoConfirmed };
  },

  async confirmSignUp() { /* not needed locally */ },
  async resendCode() { throw new Error('No confirmation codes in local mode — just sign in.'); },

  async signIn(username, password) {
    const out = await call('/auth/login', { username, password });
    session = fromTokens(out);
    saveSession(session);
    return session;
  },

  async forgotPassword() {
    throw new Error('Self-serve password reset needs email (Cognito mode). Ask an administrator to reset your account.');
  },
  async confirmForgotPassword() {
    throw new Error('Self-serve password reset needs email (Cognito mode).');
  },

  async refresh() {
    if (!session || !session.refreshToken) return null;
    const out = await call('/auth/refresh', { refreshToken: session.refreshToken });
    session = fromTokens({ ...out, username: session.username });
    saveSession(session);
    return session;
  },

  /** Returns a valid (non-expired) ID token, refreshing first if needed. */
  async idToken() {
    if (!session) return null;
    if (session.expiresAt - Date.now() < 60_000) {
      try { await this.refresh(); } catch { session = null; saveSession(null); return null; }
    }
    return session ? session.idToken : null;
  },

  async signOut() {
    session = null;
    saveSession(null);
  },

  isSignedIn() { return !!session; },
  currentUsername() { return session ? session.username : null; },
};
