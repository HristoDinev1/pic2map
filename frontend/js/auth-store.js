// Tiny pub/sub store mirroring the React AuthContext: holds the synced
// `/auth/me` profile and notifies subscribers (navbar, route guards) on change.
import { api } from './api.js';
import { cognito } from './cognito.js';

let profile = null;
let loading = true;
const listeners = new Set();

function notify() { for (const fn of listeners) fn({ profile, loading }); }

export const authStore = {
  subscribe(fn) { listeners.add(fn); fn({ profile, loading }); return () => listeners.delete(fn); },
  get profile() { return profile; },
  get loading() { return loading; },

  async refresh() {
    loading = true; notify();
    try {
      const r = await api.get('/auth/me');
      profile = r.user;
    } catch {
      profile = null;
    } finally {
      loading = false; notify();
    }
  },

  async logout() {
    await cognito.signOut();
    profile = null;
    notify();
  },
};
