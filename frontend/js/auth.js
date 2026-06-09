// Auth driver selection. The app supports two interchangeable drivers with an
// identical interface:
//   - 'local'   → this backend's own /auth endpoints (self-hosted, no AWS)
//   - 'cognito' → Amazon Cognito, called directly from the browser (original)
// Configure via window.PIC2MAP_CONFIG.authDriver; when unset, 'cognito' is
// used only if a real-looking cognitoClientId is present, else 'local'.

import { cognito } from './cognito.js';
import { localAuth } from './local-auth.js';

function pickDriver() {
  const cfg = window.PIC2MAP_CONFIG || {};
  if (cfg.authDriver === 'local' || cfg.authDriver === 'cognito') return cfg.authDriver;
  const id = cfg.cognitoClientId || '';
  const looksReal = id.length > 0 && !/^x+$/i.test(id);
  return looksReal ? 'cognito' : 'local';
}

export const authDriver = pickDriver();
export const auth = authDriver === 'cognito' ? cognito : localAuth;
