import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; name: string; email: string; locale: string; mustChangePassword: boolean; role: { key: string; name: string }; permissions: string[] };
  organization: { name: string; currency: string; lockDate: string | null; fiscalYearStart: number; address?: string | null; phone?: string | null; email?: string | null; taxId?: string | null; legalName?: string | null; invoiceFooter?: string | null };
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
    window.addEventListener('fl:unauthorized', onUnauthorized);
    return () => window.removeEventListener('fl:unauthorized', onUnauthorized);
  }, [qc]);
  const me = q.data ?? null;
  const value: Ctx = {
    me, loading: q.isLoading,
    can: p => !!me?.user.permissions.includes(p),
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    logout: async () => { await api.post('/auth/logout'); qc.clear(); qc.setQueryData(['me'], null); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
