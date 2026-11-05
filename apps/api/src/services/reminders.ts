// Daily reminders (Web Push). At the farm's morning and evening times (Bangladesh time) data-entry staff are
// asked for the day's eggs, then for feed, medicine and expenses. One hour later they are asked again if the
// job is still not done, and two hours later the owner is told. Each slot is handled once per farm day.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import type { Db } from '../db.js';
import { farmMinuteOfDay, farmYmd } from '../lib/farm-time.js';
import { sqliteFile } from './backup.js';

export type Base = 'morning' | 'evening';
export type Slot = Base | `${Base}-again` | `${Base}-owner`;
export interface ReminderConfig { on: boolean; morning: string; evening: string }
export interface Payload { title: string; body: string; url: string }
export interface Sent { userId: string; endpoint: string; keys: { p256dh: string; auth: string }; payload: Payload }

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
/** A tick a few minutes late (busy server, sleeping laptop) still sends the reminder. */
const GRACE_MIN = 5;

/** The reminder slots that start at `now` (within a few minutes' grace). */
export function dueSlots(now: Date, cfg: ReminderConfig): Slot[] {
  if (!cfg.on) return [];
  const m = farmMinuteOfDay(now);
  const out: Slot[] = [];
  for (const base of ['morning', 'evening'] as const) {
    const start = minutes(cfg[base]);
    ([[base, 0], [`${base}-again`, 60], [`${base}-owner`, 120]] as const).forEach(([slot, after]) => {
      const t = start + after;
      if (m >= t && m < t + GRACE_MIN) out.push(slot as Slot);
    });
  }
  return out;
}

const none = async (db: Db, day: string, what: string) => !!(await db.reminderLog.findUnique({ where: { day_slot: { day, slot: `none-${what}` } } }));

/** Morning: every active flock has today's eggs. Evening: feed for every active flock, and medicine and expenses
 *  recorded today, each of them or answered "none today". */
export async function isDone(db: Db, base: Base, day: string): Promise<boolean> {
  const date = new Date(`${day}T00:00:00Z`);
  const flocks = await db.flock.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  const logs = await db.productionLog.findMany({ where: { date, status: 'POSTED' }, select: { flockId: true, eggsCollected: true, feedQty: true } });
  const sum = (id: string, f: (l: (typeof logs)[number]) => number) => logs.filter(l => l.flockId === id).reduce((a, l) => a + f(l), 0);
  if (base === 'morning') return flocks.every(f => sum(f.id, l => l.eggsCollected) > 0);
  const feed = (await none(db, day, 'feed')) || flocks.every(f => sum(f.id, l => Number(l.feedQty)) > 0);
  const medicine = (await none(db, day, 'medicine'))
    || (await db.stockMove.count({ where: { date, voided: false, type: 'CONSUMPTION', item: { category: 'MEDICINE' } } })) > 0;
  const expenses = (await none(db, day, 'expenses')) || (await db.bill.count({ where: { date, status: { not: 'VOID' } } })) > 0;
  return feed && medicine && expenses;
}

const TEXT: Record<Base | 'owner-morning' | 'owner-evening', { en: Payload; bn: Payload }> = {
  morning: {
    en: { title: 'Today’s eggs', body: 'How many eggs were collected today? Any ducks died? Tap to record.', url: '/?flow=eggs' },
    bn: { title: 'আজকের ডিম', body: 'আজ কতগুলো ডিম সংগ্রহ হলো? কোনো হাঁস মারা গেছে? লিখতে চাপুন।', url: '/?flow=eggs' },
  },
  evening: {
    en: { title: 'Evening entries', body: 'Please record today’s feed, medicine and expenses. Tap to start.', url: '/?flow=evening' },
    bn: { title: 'সন্ধ্যার হিসাব', body: 'আজকের খাদ্য, ওষুধ ও খরচ লিখুন। শুরু করতে চাপুন।', url: '/?flow=evening' },
  },
  'owner-morning': {
    en: { title: 'Morning eggs not recorded', body: 'Today’s egg count has not been entered yet.', url: '/production' },
    bn: { title: 'সকালের ডিম লেখা হয়নি', body: 'আজকের ডিমের হিসাব এখনো লেখা হয়নি।', url: '/production' },
  },
  'owner-evening': {
    en: { title: 'Evening entries missing', body: 'Today’s feed, medicine or expenses are not all recorded yet.', url: '/production' },
    bn: { title: 'সন্ধ্যার হিসাব বাকি', body: 'আজকের খাদ্য, ওষুধ বা খরচ সব এখনো লেখা হয়নি।', url: '/production' },
  },
};

export async function reminderConfig(db: Db): Promise<ReminderConfig> {
  const org = await db.organization.findUnique({ where: { id: 'org' } });
  return { on: org?.remindersOn ?? true, morning: org?.reminderMorning ?? '10:00', evening: org?.reminderEvening ?? '17:00' };
}

/** Handle every slot due at `now`: record it (once per day), and if the job is not done, send to the right people. */
export async function runReminders(db: Db, now: Date, send: (s: Sent) => Promise<void>) {
  const slots = dueSlots(now, await reminderConfig(db));
  const day = farmYmd(now);
  for (const slot of slots) {
    const base = slot.split('-')[0] as Base;
    if (await db.reminderLog.findUnique({ where: { day_slot: { day, slot } } })) continue;
    const done = await isDone(db, base, day);
    await db.reminderLog.create({ data: { day, slot, kind: done ? 'done' : 'sent' } });
    if (done) continue;
    const toOwner = slot.endsWith('-owner');
    const users = await db.user.findMany({ where: { active: true, role: { key: toOwner ? 'owner' : 'operator' } }, select: { id: true, locale: true } });
    const subs = await db.pushSubscription.findMany({ where: { userId: { in: users.map(u => u.id) } } });
    for (const s of subs) {
      const lang = users.find(u => u.id === s.userId)?.locale === 'bn' ? 'bn' : 'en';
      const payload = TEXT[(toOwner ? `owner-${base}` : base) as keyof typeof TEXT][lang];
      await send({ userId: s.userId, endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth }, payload });
    }
  }
}

// ───── Web Push keys and sending ─────

/** VAPID keys from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or generated once and kept next to the database. */
export function vapidKeys(): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const file = join(dirname(sqliteFile()), 'vapid.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const keys = webpush.generateVAPIDKeys();
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

/** Real sender. A phone that has uninstalled the app or turned reminders off (404/410) is forgotten. */
export const pushSender = (db: Db) => {
  const { publicKey, privateKey } = vapidKeys();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:farmledger@localhost', publicKey, privateKey);
  return async (s: Sent) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(s.payload), { TTL: 3 * 3600 });
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
      else throw e;
    }
  };
};

/** Checks every minute. Started by the server only, never by tests. */
export function startReminderScheduler(db: Db, log: { error: (m: string) => void }) {
  const send = pushSender(db);
  const tick = () => runReminders(db, new Date(), send).catch(e => log.error(`Daily reminders failed: ${(e as Error).message}`));
  return setInterval(tick, 60_000).unref();
}
