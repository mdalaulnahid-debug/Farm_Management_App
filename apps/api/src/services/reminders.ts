// Daily reminders (Web Push), so the books stay up to date every day (owner, 6 Nov 2026: "keep telling the users
// to update the daily operations such as recording collection, sales, spendings"). At the farm's morning time
// data-entry staff are asked for the day's eggs; at the evening time for the day's sales and money collected,
// spending (with vouchers), feed and medicine. While the job is not done they are asked again after 1 hour and
// after 2 hours, and at 2 hours the owner is told too. Each item counts as done when recorded, or when staff answer
// "none today" for it. Each slot is handled once per farm day.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import type { Db } from '../db.js';
import { farmMinuteOfDay, farmYmd } from '../lib/farm-time.js';
import { sqliteFile } from './backup.js';
import { SYS } from '../lib/constants.js';

export type Base = 'morning' | 'evening';
export type Slot = Base | `${Base}-again` | `${Base}-owner`;
/** What staff can answer "none today" for. */
export const NONE_ITEMS = ['feed', 'medicine', 'expenses', 'sales'] as const;
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

/** Morning: every active flock has today's eggs. Evening: sales or money collected, spending, feed for every
 *  active flock, and medicine, all recorded today, each of them or answered "none today". */
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
  // Sales done: an invoice, or money collected from a customer (a receipt against receivables). Owner capital,
  // loans, grants and other money in are not sales.
  const ar = (await db.account.findUnique({ where: { code: SYS.AR }, select: { id: true } }))?.id ?? '-';
  const sales = (await none(db, day, 'sales'))
    || (await db.salesInvoice.count({ where: { date, status: { not: 'VOID' } } })) > 0
    || (await db.payment.count({ where: { date, direction: 'IN', status: { not: 'VOID' }, counterAccountId: ar, party: { kind: { in: ['CUSTOMER', 'BOTH'] } } } })) > 0;
  return feed && medicine && expenses && sales;
}

const TEXT: Record<Base | 'again-morning' | 'again-evening' | 'owner-morning' | 'owner-evening', { en: Payload; bn: Payload }> = {
  morning: {
    en: { title: 'Today’s eggs', body: 'How many eggs were collected today? Any ducks died? Tap to record.', url: '/?flow=eggs' },
    bn: { title: 'আজকের ডিম', body: 'আজ কতগুলো ডিম সংগ্রহ হলো? কোনো হাঁস মারা গেছে? লিখতে চাপুন।', url: '/?flow=eggs' },
  },
  evening: {
    en: { title: 'Today’s books', body: 'Please record today’s sales and money collected, spending (with vouchers), feed and medicine, so the books stay up to date. Tap to start.', url: '/' },
    bn: { title: 'আজকের হিসাব', body: 'আজকের বিক্রি ও টাকা আদায়, খরচ (ভাউচারসহ), খাদ্য ও ওষুধ লিখুন, যাতে হিসাব হালনাগাদ থাকে। শুরু করতে চাপুন।', url: '/' },
  },
  'again-morning': {
    en: { title: 'Still waiting: today’s eggs', body: 'Today’s eggs are not recorded yet. Please record them now so the books stay up to date.', url: '/?flow=eggs' },
    bn: { title: 'এখনো বাকি: আজকের ডিম', body: 'আজকের ডিম এখনো লেখা হয়নি। হিসাব হালনাগাদ রাখতে এখনই লিখুন।', url: '/?flow=eggs' },
  },
  'again-evening': {
    en: { title: 'Still waiting: today’s books', body: 'Some of today’s sales, collections, spending, feed or medicine are not recorded yet. Tap to see what is left.', url: '/' },
    bn: { title: 'এখনো বাকি: আজকের হিসাব', body: 'আজকের বিক্রি, আদায়, খরচ, খাদ্য বা ওষুধের কিছু এখনো লেখা হয়নি। কী বাকি দেখতে চাপুন।', url: '/' },
  },
  'owner-morning': {
    en: { title: 'Morning eggs not recorded', body: 'Today’s egg count has not been entered yet.', url: '/production' },
    bn: { title: 'সকালের ডিম লেখা হয়নি', body: 'আজকের ডিমের হিসাব এখনো লেখা হয়নি।', url: '/production' },
  },
  'owner-evening': {
    en: { title: 'Today’s books are not complete', body: 'Today’s sales, collections, spending, feed or medicine are not all recorded yet.', url: '/' },
    bn: { title: 'আজকের হিসাব অসম্পূর্ণ', body: 'আজকের বিক্রি, আদায়, খরচ, খাদ্য বা ওষুধ সব এখনো লেখা হয়নি।', url: '/' },
  },
};

export async function reminderConfig(db: Db): Promise<ReminderConfig> {
  const org = await db.organization.findUnique({ where: { id: 'org' } });
  return { on: org?.remindersOn ?? true, morning: org?.reminderMorning ?? '10:00', evening: org?.reminderEvening ?? '17:00' };
}

/** The push services browsers use. Subscriptions may only point at these, so the server never sends requests to
 *  an address a user chose (no server-side request forgery into the farm's network). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];
export function isPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && PUSH_HOSTS.some(h => h.test(u.hostname));
  } catch { return false; }
}

/** Handle every slot due at `now`: record it (once per day), and if the job is not done, send to the right people.
 *  One phone failing never stops the others: each failure is logged and the next phone is tried. */
export async function runReminders(db: Db, now: Date, send: (s: Sent) => Promise<void>, log?: { error: (m: string) => void }) {
  const slots = dueSlots(now, await reminderConfig(db));
  const day = farmYmd(now);
  for (const slot of slots) {
    const base = slot.split('-')[0] as Base;
    if (await db.reminderLog.findUnique({ where: { day_slot: { day, slot } } })) continue;
    const done = await isDone(db, base, day);
    await db.reminderLog.create({ data: { day, slot, kind: done ? 'done' : 'sent' } });
    if (done) continue;
    // Staff are asked at the time, again at +1 h, and once more at +2 h, when the owner is told as well.
    const toOwner = slot.endsWith('-owner');
    const users = await db.user.findMany({ where: { active: true, role: { key: { in: toOwner ? ['owner', 'operator'] : ['operator'] } } }, select: { id: true, locale: true, role: { select: { key: true } } } });
    const subs = await db.pushSubscription.findMany({ where: { userId: { in: users.map(u => u.id) } } });
    for (const s of subs) {
      const lang = users.find(u => u.id === s.userId)?.locale === 'bn' ? 'bn' : 'en';
      const isOwner = users.find(u => u.id === s.userId)?.role.key === 'owner';
      const text = isOwner ? `owner-${base}` : slot === base ? base : `again-${base}`;
      const payload = TEXT[text as keyof typeof TEXT][lang];
      try {
        await send({ userId: s.userId, endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth }, payload });
      } catch (e) {
        log?.error(`Reminder ${slot} to one phone of user ${s.userId} failed: ${(e as Error).message}`);
      }
    }
  }
}

// ───── Web Push keys and sending ─────

/** VAPID keys from VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (both or neither), or generated once and kept in
 *  VAPID_FILE (default: vapid.json next to the database; tests point it at a temp folder). */
export function vapidKeys(): { publicKey: string; privateKey: string } {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!!pub !== !!priv) throw new Error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither.');
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const file = process.env.VAPID_FILE || join(dirname(sqliteFile()), 'vapid.json');
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
    if (!isPushEndpoint(s.endpoint)) { await db.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }); return; }
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
  const send = pushSender(db); // throws at start-up when only one VAPID key is set
  const tick = () => runReminders(db, new Date(), send, log).catch(e => log.error(`Daily reminders failed: ${(e as Error).message}`));
  return setInterval(tick, 60_000).unref();
}
