import type { Lang } from './i18n';

const locale = (lang: Lang) => (lang === 'bn' ? 'bn-BD' : 'en-IN'); // en-IN gives lakh grouping familiar in Bangladesh

export const fmtMoney = (v: number | null | undefined, lang: Lang = 'en', opts: { decimals?: number; symbol?: boolean } = {}) => {
  const n = Number(v ?? 0);
  const s = new Intl.NumberFormat(locale(lang), { minimumFractionDigits: opts.decimals ?? 0, maximumFractionDigits: opts.decimals ?? 2 }).format(Math.abs(n));
  const body = opts.symbol === false ? s : `৳${s}`;
  return n < 0 ? `(${body})` : body;
};

export const fmtNum = (v: number | null | undefined, lang: Lang = 'en', decimals = 2) =>
  new Intl.NumberFormat(locale(lang), { maximumFractionDigits: decimals }).format(Number(v ?? 0));

export const fmtPct = (v: number | null | undefined, lang: Lang = 'en') => (v === null || v === undefined ? '—' : `${fmtNum(v, lang, 1)}%`);

export const fmtDate = (v: string | Date | null | undefined, lang: Lang = 'en') => {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : v;
  return new Intl.DateTimeFormat(locale(lang), { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
};

export const fmtDateTime = (v: string | Date, lang: Lang = 'en') =>
  new Intl.DateTimeFormat(locale(lang), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v));

export const ymd = (d: Date = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const iso10 = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
export const monthStart = (d = new Date()) => ymd(new Date(d.getFullYear(), d.getMonth(), 1));
export const monthEnd = (d = new Date()) => ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Download rows as a UTF-8 CSV (with BOM so Excel shows Bangla correctly). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
