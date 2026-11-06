// Bilingual UI (English / বাংলা). Strings are written inline as t('English', 'বাংলা') next to
// where they are used, so every screen is translated by construction and nothing drifts.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadFontSet, type FontSet } from './fonts';

export type { FontSet };

export type Lang = 'en' | 'bn';
export type Theme = 'light' | 'dark' | 'system';
export type Motion = 'full' | 'reduce';
export type Density = 'comfortable' | 'compact';
export type Accent = 'green' | 'blue' | 'purple' | 'amber';

/** Only display preferences live here — nothing that changes data or what a user may do. */
/** `home` is the page opened after sign-in; `banglaCalendar` shows the Bangla date on the dashboard;
 *  `fontSet` the reading font; `simple` the big-button workspace; `lite` no photos or animation (slow phones). */
export interface Prefs { lang: Lang; theme: Theme; density: Density; fontSize: number; accent: Accent; motion: Motion; banglaCalendar: boolean; home: string; fontSet: FontSet; simple: boolean; lite: boolean }
interface Ctx extends Prefs {
  t: (en: string, bn: string) => string;
  set: (p: Partial<Prefs>) => void;
  /** The theme actually shown (resolves 'system' from the device). */
  dark: boolean;
  /** Puts every display preference except the language back to its default. */
  reset: () => void;
  /** Takes on settings saved with the account (after sign-in) without saving them back. */
  adopt: (p: Partial<Prefs>) => void;
}

const KEY = 'farmledger.prefs.v2';
export const DEFAULTS: Prefs = { lang: 'en', theme: 'system', density: 'comfortable', fontSize: 14, accent: 'green', motion: 'full', banglaCalendar: true, home: '/', fontSet: 'clean', simple: false, lite: false };

// Settings follow the person: while someone is signed in, every change is also saved to their account
// (lib/auth.tsx registers the saver). The language has its own call; an older server without this simply
// keeps the settings in this browser.
type Saver = (p: Partial<Omit<Prefs, 'lang'>>) => void;
let remoteSave: Saver | null = null;
export const setRemoteSaver = (fn: Saver | null) => { remoteSave = fn; };
let pending: Partial<Prefs> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
const saveRemote = (p: Partial<Prefs>) => {
  const { lang: _lang, ...rest } = p;
  if (!remoteSave || !Object.keys(rest).length) return;
  pending = { ...pending, ...rest };
  clearTimeout(timer);
  timer = setTimeout(() => { const p2 = pending; pending = {}; remoteSave?.(p2); }, 800);
};
const deviceDark = () => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const read = (): Prefs => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
};

const PrefsContext = createContext<Ctx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(read);
  const [systemDark, setSystemDark] = useState(deviceDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(deviceDark());
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, []);
  const dark = prefs.theme === 'system' ? systemDark : prefs.theme === 'dark';
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.motion = prefs.motion;
    root.dataset.density = prefs.density;
    root.dataset.accent = prefs.accent;
    // Lite mode: chosen in My settings, or automatic when the phone's data saver is on.
    const saveData = !!(navigator as any).connection?.saveData || !!window.matchMedia?.('(prefers-reduced-data: reduce)').matches;
    root.dataset.lite = String(prefs.lite || saveData);
    // The new font is applied once its files are in, so text never flashes in a fallback face.
    loadFontSet(prefs.fontSet).then(() => { root.dataset.font = prefs.fontSet; }, () => { root.dataset.font = 'clean'; });
    root.lang = prefs.lang;
    root.style.setProperty('--fs', `${prefs.density === 'compact' ? prefs.fontSize - 1 : prefs.fontSize}px`);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  }, [prefs, dark]);
  const value = useMemo<Ctx>(() => ({
    ...prefs,
    t: (en, bn) => (prefs.lang === 'bn' ? bn : en),
    set: p => { setPrefs(prev => ({ ...prev, ...p })); saveRemote(p); },
    dark,
    reset: () => { setPrefs(prev => ({ ...DEFAULTS, lang: prev.lang })); saveRemote({ ...DEFAULTS }); },
    adopt: p => setPrefs(prev => ({ ...prev, ...p })),
  }), [prefs, dark]);
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
