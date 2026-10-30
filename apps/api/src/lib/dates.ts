// Business dates are calendar days. They are stored as UTC midnight and exchanged as YYYY-MM-DD.

export const toDate = (ymd: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Invalid date: ${ymd}`);
  return new Date(`${ymd}T00:00:00.000Z`);
};
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
export const today = () => ymd(new Date());
/** End of the given day, for inclusive "as of" filters. */
export const endOf = (ymdStr: string) => new Date(`${ymdStr}T23:59:59.999Z`);
export const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 86_400_000);
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
