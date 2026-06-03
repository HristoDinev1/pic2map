import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { signOut } from 'aws-amplify/auth';
import { api } from '../api/client';
import type { Profile } from '../types';

interface Ctx { profile: Profile | null; loading: boolean; refresh: () => void; logout: () => void; }
const AuthCtx = createContext<Ctx>({ profile: null, loading: true, refresh: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api.get<{ user: Profile }>('/auth/me')
      .then((r) => setProfile(r.user))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const logout = async () => { await signOut(); setProfile(null); location.reload(); };

  return <AuthCtx.Provider value={{ profile, loading, refresh, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
