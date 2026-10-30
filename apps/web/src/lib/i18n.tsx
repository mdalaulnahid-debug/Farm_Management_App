// Bilingual UI (English / বাংলা). Strings are written inline as t('English', 'বাংলা') next to
// where they are used, so every screen is translated by construction and nothing drifts.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'bn';
export type Theme = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

interface Prefs { lang: Lang; theme: Theme; density: Density; fontSize: number }
interface Ctx extends Prefs {
  t: (en: string, bn: string) => string;
  set: (p: Partial<Prefs>) => void;
}

const KEY = 'farmledger.prefs.v2';
const read = (): Prefs => {
  const fallback: Prefs = { lang: 'en', theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', density: 'comfortable', fontSize: 14 };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return fallback; }
};

const PrefsContext = createContext<Ctx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(read);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.density;
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

export const moveLabel = (t: Ctx['t'], s: string) => ({
  OPENING: t('Opening stock', 'প্রারম্ভিক মজুদ'), PURCHASE: t('Purchase', 'ক্রয়'), SALE: t('Sale', 'বিক্রয়'), PRODUCTION: t('Production', 'উৎপাদন'),
  CONSUMPTION: t('Consumed', 'ব্যবহৃত'), ADJUSTMENT: t('Adjustment', 'সমন্বয়'), GIFT: t('Gift / donation', 'উপহার / দান'), WASTE: t('Waste / loss', 'নষ্ট / ক্ষতি'), MORTALITY: t('Mortality', 'মৃত্যু'),
} as Record<string, string>)[s] ?? s;
