import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionAccount {
  _id: string;
  name: string;
  plan: 'starter' | 'pro' | 'empire';
  enabledModules: string[];
  locale: string;
  ownerName?: string;
  websiteSlug?: string;
  email: string;
}

export interface SessionUser {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthState {
  accessToken: string | null;
  user: SessionUser | null;
  account: SessionAccount | null;
  setSession: (s: { accessToken: string; user: SessionUser; account: SessionAccount }) => void;
  setAccessToken: (t: string) => void;
  setAccount: (a: SessionAccount) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      account: null,
      setSession: ({ accessToken, user, account }) => set({ accessToken, user, account }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setAccount: (account) => set({ account }),
      logout: () => set({ accessToken: null, user: null, account: null }),
    }),
    { name: 'cf-auth' },
  ),
);

export function hasModule(account: SessionAccount | null, flag: string): boolean {
  return Boolean(account?.enabledModules.includes(flag));
}
