import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; name: string; email: string; locale: string; mustChangePassword: boolean; twoStepEnabled: boolean; mustSetUpTwoStep: boolean; role: { key: string; name: string }; permissions: string[] };
  organization: { name: string; nameBn?: string | null; currency: string; lockDate: string | null; fiscalYearStart: number; address?: string | null; phone?: string | null; email?: string | null; taxId?: string | null; legalName?: string | null; invoiceFooter?: string | null; requireTwoStep?: boolean };
}

interface Ctx { me: Me | null; loading: boolean; can: (p: string) => boolean; refresh: () => void; logout: () => Promise<void> }
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try { return await api.get<Me>('/auth/me'); } catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
    },
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(['me'], null);
    const onStale = () => qc.invalidateQueries({ queryKey: ['me'] });
    window.addEventListener('fl:unauthorized', onUnauthorized);
    window.addEventListener('fl:me-stale', onStale);
    return () => { window.removeEventListener('fl:unauthorized', onUnauthorized); window.removeEventListener('fl:me-stale', onStale); };
  }, [qc]);
  const me = q.data ?? null;
  const value: Ctx = {
    me, loading: q.isLoading,
    can: p => !!me?.user.permissions.includes(p),
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    // Mark signed-out first, then drop everything else. qc.clear() would detach the ['me'] query from
    // its observer, so the screen never saw the sign-out and stayed signed in.
    logout: async () => {
      try { await api.post('/auth/logout'); } finally {
        qc.setQueryData(['me'], null);
        qc.removeQueries({ predicate: query => query.queryKey[0] !== 'me' });
      }
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
