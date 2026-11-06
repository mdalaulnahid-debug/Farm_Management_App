// Comparing a period with the one before it, for the dashboard: which earlier period, how much each figure
// changed (and whether that is good), and one plain sentence about it.
import type { KpiDelta } from '@farmledger/design-system';
import { fmtNum } from './format';

export interface Range { from: string; to: string }
type T = (en: string, bn: string) => string;

/** The period just before `r`: the same number of whole months when `r` is whole months (so "this month"
 *  compares with last month), otherwise the same number of days. */
export function previousRange(r: Range): Range {
  const d = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00Z`);
  const iso = (v: Date) => v.toISOString().slice(0, 10);
  const f = d(r.from), to = d(r.to);
  const monthEnd = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  if (f.getUTCDate() === 1 && to.getUTCDate() === monthEnd) {
    const months = (to.getUTCFullYear() - f.getUTCFullYear()) * 12 + to.getUTCMonth() - f.getUTCMonth() + 1;
    return { from: iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - months, 1))), to: iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 0))) };
  }
  const days = Math.round((to.getTime() - f.getTime()) / 864e5) + 1;
  return { from: iso(new Date(f.getTime() - days * 864e5)), to: iso(new Date(f.getTime() - 864e5)) };
}

/** The two periods to compare, fairly. A period still in progress (e.g. "this month" on the 6th) is compared
 *  only up to today, against the same days of the earlier period: 1–6 Nov with 1–6 Oct, never 1–6 Nov with all
 *  of October. A finished period is compared whole, as `previousRange` gives it. `today` is YYYY-MM-DD. */
export function comparison(t: T, r: Range, today: string): { current: Range; previous: Range; clipped: boolean; vs: string } {
  const d = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00Z`);
  const iso = (v: Date) => v.toISOString().slice(0, 10);
  const f = d(r.from), to = d(r.to), now = d(today);
  if (now < f || now >= to) return { current: r, previous: previousRange(r), clipped: false, vs: periodWord(t, r) };
  const whole = f.getUTCDate() === 1 && to.getUTCDate() === new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  const current = { from: r.from.slice(0, 10), to: today };
  if (whole) {
    const months = (to.getUTCFullYear() - f.getUTCFullYear()) * 12 + to.getUTCMonth() - f.getUTCMonth() + 1;
    const back = (v: Date) => {
      // Same day number `months` earlier, kept inside that month (31 Mar → 28/29 Feb).
      const y = v.getUTCFullYear(), m = v.getUTCMonth() - months;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y, m, Math.min(v.getUTCDate(), last)));
    };
    const vs = months === 12 ? t('the same days last year', 'গত বছরের একই দিনগুলোর') : months === 1 ? t('the same days last month', 'গত মাসের একই দিনগুলোর') : t('the same days before', 'আগের একই দিনগুলোর');
    return { current, previous: { from: iso(back(f)), to: iso(back(now)) }, clipped: true, vs };
  }
  const days = Math.round((now.getTime() - f.getTime()) / 864e5) + 1;
  return { current, previous: { from: iso(new Date(f.getTime() - days * 864e5)), to: iso(new Date(f.getTime() - 864e5)) }, clipped: true, vs: t('the days before', 'আগের দিনগুলোর') };
}

/** What to call the earlier period in "vs …". */
export function periodWord(t: T, r: Range) {
  const f = new Date(`${r.from.slice(0, 10)}T00:00:00Z`), to = new Date(`${r.to.slice(0, 10)}T00:00:00Z`);
  const whole = f.getUTCDate() === 1 && to.getUTCDate() === new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  const months = (to.getUTCFullYear() - f.getUTCFullYear()) * 12 + to.getUTCMonth() - f.getUTCMonth() + 1;
  if (whole && months === 1) return t('last month', 'গত মাসের');
  if (whole && months === 12) return t('last year', 'গত বছরের');
  return t('the period before', 'আগের সময়ের');
}

/** Change from `prev` to `cur`: in % for amounts and counts, in points for a rate (`points`). */
export function change(t: T, lang: 'en' | 'bn', cur: number | null | undefined, prev: number | null | undefined, upIsGood: boolean | null, vs: string, points = false): KpiDelta | null {
  if (cur == null || prev == null || (cur === 0 && prev === 0)) return null;
  const title = t(`vs ${vs}`, `${vs} তুলনায়`);
  if (!points && prev === 0) return null; // Nothing to compare with (e.g. the first month of records).
  const diff = points ? cur - prev : ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(diff) < (points ? 0.5 : 1)) return { text: t('same', 'একই'), dir: 'flat', good: null, title };
  const dir = diff > 0 ? 'up' : 'down';
  const size = Math.abs(diff);
  const text = points ? `${fmtNum(size, lang, 1)} ${t('pts', 'পয়েন্ট')}` : `${fmtNum(size, lang, size >= 10 ? 0 : 1)}%`;
  return { text, dir, good: upIsGood === null ? null : (dir === 'up') === upIsGood, title };
}

/** One plain sentence on how the period went, from the changes worth mentioning. */
export function summary(t: T, vs: string, parts: [string, string, KpiDelta | null][]) {
  const said = parts.filter(([, , c]) => c).map(([en, bn, c]) => {
    const d = c!;
    if (d.dir === 'flat') return t(`${en} steady`, `${bn} প্রায় একই`);
    return d.dir === 'up' ? t(`${en} up ${d.text}`, `${bn} ${d.text} বেশি`) : t(`${en} down ${d.text}`, `${bn} ${d.text} কম`);
  });
  if (!said.length) return null;
  return t(`Compared with ${vs}: ${said.join(', ')}.`, `${vs} তুলনায়: ${said.join(', ')}।`);
}
