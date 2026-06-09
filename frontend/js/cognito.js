// Direct browser-side Cognito auth — no AWS SDK / Amplify, just signed-free
// JSON HTTPS calls to the public "AWSCognitoIdentityProviderService" API.
// (The user pool client has ALLOW_USER_PASSWORD_AUTH enabled, so we can sign
// in with a plain username/password instead of doing SRP math in the browser.)

const REGION = window.PIC2MAP_CONFIG.cognitoRegion;
const CLIENT_ID = window.PIC2MAP_CONFIG.cognitoClientId;
const ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com/`;
const STORAGE_KEY = 'pic2map.session';

async function call(action, params) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.__type || `Cognito request failed (${res.status})`);
  }
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

function fromAuthResult(username, result) {
  return {
    username,
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken || (session && session.refreshToken) || null,
    expiresAt: Date.now() + (result.ExpiresIn || 3600) * 1000,
  };
}

export const cognito = {
  supportsConfirmation: true,
  supportsPasswordReset: true,

  /** Create an account. Email is required (it's the username attribute). */
  async signUp(username, password, email) {
    await call('SignUp', {
      ClientId: CLIENT_ID,
      Username: username,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    });
  },

  async confirmSignUp(username, code) {
    await call('ConfirmSignUp', { ClientId: CLIENT_ID, Username: username, ConfirmationCode: code });
  },

  async resendCode(username) {
    await call('ResendConfirmationCode', { ClientId: CLIENT_ID, Username: username });
  },

  async signIn(username, password) {
    const out = await call('InitiateAuth', {
      ClientId: CLIENT_ID,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD: password },
    });
    if (out.ChallengeName) throw new Error(`Unsupported auth challenge: ${out.ChallengeName}`);
    session = fromAuthResult(username, out.AuthenticationResult);
    saveSession(session);
    return session;
  },

  async forgotPassword(username) {
    await call('ForgotPassword', { ClientId: CLIENT_ID, Username: username });
  },

  async confirmForgotPassword(username, code, newPassword) {
    await call('ConfirmForgotPassword', {
      ClientId: CLIENT_ID, Username: username, ConfirmationCode: code, Password: newPassword,
    });
  },

  /** Refreshes the ID/access tokens using the stored refresh token. */
  async refresh() {
    if (!session || !session.refreshToken) return null;
    const out = await call('InitiateAuth', {
      ClientId: CLIENT_ID,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    session = fromAuthResult(session.username, out.AuthenticationResult);
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
    if (session && session.accessToken) {
      try { await call('GlobalSignOut', { AccessToken: session.accessToken }); } catch { /* ignore */ }
    }
    session = null;
    saveSession(null);
  },

  isSignedIn() { return !!session; },
  currentUsername() { return session ? session.username : null; },
};
