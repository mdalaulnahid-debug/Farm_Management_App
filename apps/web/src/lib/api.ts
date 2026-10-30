// Typed fetch wrapper for the FarmLedger API. Cookies carry the session; errors become ApiError.

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const res = await fetch(`/api/v1${path}${qs(query)}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('fl:unauthorized'));
    throw new ApiError(res.status, data?.message || res.statusText, data?.error, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
};

export interface List<T> { data: T[]; total?: number; totals?: Record<string, number> }

// ───── Shared entity shapes (subset of server models used by the UI) ─────
export interface Account { id: string; code: string; name: string; nameBn?: string | null; type: string; subtype: string; cashFlow: string; system: boolean; active: boolean; balance?: number; description?: string | null; parentId?: string | null }
export interface Party { id: string; kind: string; name: string; phone?: string | null; email?: string | null; address?: string | null; taxId?: string | null; creditLimit?: number | null; paymentTerms: number; notes?: string | null; active: boolean; receivable?: number; payable?: number }
export interface Item { id: string; sku: string; name: string; nameBn?: string | null; category: string; unit: string; salePrice: number; purchasePrice: number; trackInventory: boolean; valued: boolean; qtyOnHand: number; avgCost: number; reorderLevel: number; incomeAccountId?: string | null; expenseAccountId?: string | null; inventoryAccountId?: string | null; active: boolean }
export interface Flock { id: string; code: string; name: string; species: string; breed?: string | null; siteId?: string | null; startDate: string; openingCount: number; currentCount: number; status: string; notes?: string | null; site?: { name: string } | null }
