import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Account, type Item, type List, type Party, type Flock } from './api';
import { useToast } from '../components/ui';

/** GET with caching. `key` should include every query parameter. */
export const useApi = <T = any>(path: string | null, query?: Record<string, any>) =>
  useQuery<T>({ queryKey: [path, query], queryFn: () => api.get<T>(path!, query), enabled: !!path });

/**
 * POST/PUT that shows a toast, and on success refreshes every cached query (documents
 * touch many reports, so a blanket refresh keeps every screen consistent).
 */
export function useSave<TBody = any, TRes = any>(method: 'post' | 'put' | 'patch', path: string | ((b: TBody) => string), success?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TRes, Error, TBody>({
    mutationFn: body => api[method]<TRes>(typeof path === 'function' ? path(body) : path, body),
    onSuccess: () => { qc.invalidateQueries(); if (success) toast(success); },
    onError: e => toast(e.message, 'error'),
  });
}

export const useAccounts = (subtype?: string) => useApi<List<Account>>('/accounts', subtype ? { subtype } : undefined);
export const useCashAccounts = () => useApi<List<Account & { balance: number }>>('/cash-accounts');
export const useParties = (kind?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE', withBalance = false) => useApi<List<Party>>('/parties', { kind, withBalance: withBalance || undefined });
export const useItems = () => useApi<List<Item>>('/items');
export const useFlocks = () => useApi<List<Flock>>('/flocks');
