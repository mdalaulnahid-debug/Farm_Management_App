// Bilingual UI (English / বাংলা). Strings are written inline as t('English', 'বাংলা') next to
// where they are used, so every screen is translated by construction and nothing drifts.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'bn';
export type Theme = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
export type Accent = 'green' | 'blue' | 'purple' | 'amber';

/** Only display preferences live here — nothing that changes data or what a user may do. */
interface Prefs { lang: Lang; theme: Theme; density: Density; fontSize: number; accent: Accent }
interface Ctx extends Prefs {
  t: (en: string, bn: string) => string;
  set: (p: Partial<Prefs>) => void;
}

const KEY = 'farmledger.prefs.v2';
const read = (): Prefs => {
  const fallback: Prefs = { lang: 'en', theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', density: 'comfortable', fontSize: 14, accent: 'green' };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return fallback; }
};

const PrefsContext = createContext<Ctx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(read);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.density;
    root.dataset.accent = prefs.accent;
    root.lang = prefs.lang;
    root.style.setProperty('--fs', `${prefs.density === 'compact' ? prefs.fontSize - 1 : prefs.fontSize}px`);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  }, [prefs]);
  const value = useMemo<Ctx>(() => ({
    ...prefs,
    t: (en, bn) => (prefs.lang === 'bn' ? bn : en),
    set: p => setPrefs(prev => ({ ...prev, ...p })),
  }), [prefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs outside PrefsProvider');
  return ctx;
};
export const useT = () => usePrefs().t;

/** Display name of a record that has an optional Bangla name (accounts, items, projects). */
export const nameOf = (record: { name: string; nameBn?: string | null }, lang: string) =>
  (lang === 'bn' && record.nameBn ? record.nameBn : record.name);

/** Translated labels for server enums. */
export const statusLabel = (t: Ctx['t'], s: string) => ({
  POSTED: t('Unpaid', 'অপরিশোধিত'), PARTIAL: t('Partly paid', 'আংশিক পরিশোধ'), PAID: t('Paid', 'পরিশোধিত'), VOID: t('Void', 'বাতিল'),
  ACTIVE: t('Active', 'সক্রিয়'), CLOSED: t('Closed', 'বন্ধ'),
} as Record<string, string>)[s] ?? s;

export const accountTypeLabel = (t: Ctx['t'], s: string) => ({
  ASSET: t('Asset', 'সম্পদ'), LIABILITY: t('Liability', 'দায়'), EQUITY: t('Equity', 'মূলধন'), INCOME: t('Income', 'আয়'), EXPENSE: t('Expense', 'ব্যয়'),
} as Record<string, string>)[s] ?? s;

export const categoryLabel = (t: Ctx['t'], s: string) => ({
  PRODUCE: t('Farm produce', 'খামার উৎপাদন'), FEED: t('Feed', 'খাদ্য'), MEDICINE: t('Medicine', 'ওষুধ'), LIVESTOCK: t('Livestock', 'পশুপাখি'), SUPPLY: t('Supplies', 'সরবরাহ'), SERVICE: t('Service', 'সেবা'),
} as Record<string, string>)[s] ?? s;

/** Units are free text on an item; the common ones are translated, anything else is shown as typed. */
export const unitLabel = (t: Ctx['t'], u: string) => ({
  kg: t('kg', 'কেজি'), g: t('g', 'গ্রাম'), pcs: t('pcs', 'পিস'), piece: t('piece', 'পিস'), litre: t('litre', 'লিটার'), liter: t('litre', 'লিটার'), l: t('litre', 'লিটার'), ml: t('ml', 'মিলি'),
  pack: t('pack', 'প্যাকেট'), unit: t('unit', 'একক'), vial: t('vial', 'ভায়াল'), head: t('head', 'টি'), bag: t('bag', 'বস্তা'), dozen: t('dozen', 'ডজন'),
  tray: t('tray', 'ট্রে'), bottle: t('bottle', 'বোতল'), box: t('box', 'বাক্স'),
} as Record<string, string>)[u.trim().toLowerCase()] ?? u;

export const moveLabel =(t: Ctx['t'], s: string) => ({
  OPENING: t('Opening stock', 'প্রারম্ভিক মজুদ'), PURCHASE: t('Purchase', 'ক্রয়'), SALE: t('Sale', 'বিক্রয়'), PRODUCTION: t('Production', 'উৎপাদন'),
  CONSUMPTION: t('Consumed', 'ব্যবহৃত'), ADJUSTMENT: t('Adjustment', 'সমন্বয়'), GIFT: t('Gift / donation', 'উপহার / দান'), WASTE: t('Waste / loss', 'নষ্ট / ক্ষতি'), MORTALITY: t('Mortality', 'মৃত্যু'),
} as Record<string, string>)[s] ?? s;
