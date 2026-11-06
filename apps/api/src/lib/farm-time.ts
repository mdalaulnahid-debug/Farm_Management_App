// The farm's clock. "Today", "same day" and reminder times are Bangladesh time (Asia/Dhaka, UTC+6, no
// daylight saving), whatever time zone the server runs in. 00:30 in Barishal is 18:30 UTC the day before.
export const FARM_TZ_OFFSET_MIN = 360;
const OFFSET_MS = FARM_TZ_OFFSET_MIN * 60_000;

/** The instant the farm's current day began (00:00 Dhaka), as a UTC Date. */
export function farmDayStart(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_MS);
}

/** The farm's calendar date (YYYY-MM-DD) at `now`. */
export const farmYmd = (now: Date = new Date()) => new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);

/** Both instants fall on the same farm calendar day. */
export const isSameFarmDay = (a: Date, b: Date) => farmYmd(a) === farmYmd(b);

/** Minutes since 00:00 Dhaka at `now` (0–1439). */
export const farmMinuteOfDay = (now: Date = new Date()) => Math.floor(((now.getTime() + OFFSET_MS) % 86_400_000) / 60_000);
