import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { can as canRole, type Permission, type TenantRole } from '@truecode/shared';

export interface SessionAccount {
  _id: string;
  name: string;
  plan: 'starter' | 'pro' | 'empire' | 'ultimate';
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
  platformRole?: string;
}

interface Session {
  accessToken: string;
  user: SessionUser;
  account: SessionAccount;
}

interface AuthState {
  accessToken: string | null;
  user: SessionUser | null;
  account: SessionAccount | null;
  /** When set, the current session is a super-admin impersonation; holds the operator's own session to restore. */
  impersonator: Session | null;
  setSession: (s: Session) => void;
  setAccessToken: (t: string) => void;
  setAccount: (a: SessionAccount) => void;
  startImpersonation: (s: Session) => void;
  stopImpersonation: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      account: null,
      impersonator: null,
      setSession: ({ accessToken, user, account }) => set({ accessToken, user, account }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setAccount: (account) => set({ account }),
      startImpersonation: (s) => {
        const cur = get();
        set({
          impersonator: cur.accessToken && cur.user && cur.account ? { accessToken: cur.accessToken, user: cur.user, account: cur.account } : null,
          accessToken: s.accessToken, user: s.user, account: s.account,
        });
      },
      stopImpersonation: () => {
        const imp = get().impersonator;
        if (imp) set({ accessToken: imp.accessToken, user: imp.user, account: imp.account, impersonator: null });
      },
      logout: () => set({ accessToken: null, user: null, account: null, impersonator: null }),
    }),
    { name: 'cf-auth' },
  ),
);

export function hasModule(account: SessionAccount | null, flag: string): boolean {
  return Boolean(account?.enabledModules.includes(flag));
}

/** Client mirror of the server RBAC — for hiding/disabling actions the user can't perform. */
export function userCan(user: SessionUser | null, permission: Permission): boolean {
  if (!user) return false;
  return canRole(user.role as TenantRole, permission);
}

export function isSuperAdmin(user: SessionUser | null): boolean {
  return user?.platformRole === 'superadmin';
}
