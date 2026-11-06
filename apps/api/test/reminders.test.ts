// Daily reminders: at the owner's chosen times (Bangladesh time) data-entry staff are asked for the morning
// eggs and the evening feed, medicine and expenses; an hour later again if not done; two hours later the
// owner is told. Never twice in a day, never once the job is done, and only owner/admin set the times.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { dueSlots, isPushEndpoint, runReminders, vapidKeys, type Sent } from '../src/services/reminders.js';
import { farmYmd } from '../src/lib/farm-time.js';

let app: FastifyInstance;
let owner = '';
let operator = '';
let reopen: string[] = [];
const cfg = { on: true, morning: '10:00', evening: '17:00' };
/** 6 Nov 2026 at hh:mm in Bangladesh (UTC+6). */
const at = (hhmm: string) => new Date(`2026-11-06T${hhmm}:00+06:00`);

const call = async (method: string, url: string, cookie: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: { cookie } });
  return { status: res.statusCode, body: res.json() as any };
};
let device = 0;
const signIn = async (email: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress: `10.6.0.${++device}` });
  expect(res.statusCode).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0];
};
const subscribe = (cookie: string, n: string) => call('POST', '/push/subscribe', cookie, { endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: `key-${n}`, auth: `auth-${n}` } });

beforeAll(async () => {
  // All test files share one database and only the first seed() runs, so every file seeds the same way (with history).
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  owner = await signIn('owner@test.local', 'TestOwner2026');
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'operator' } });
  expect((await call('POST', '/users', owner, { name: 'Remind Op', email: 'remind-op@test.local', roleId: role.id, password: 'RemindTemp2026' })).status).toBe(200);
  const first = await signIn('remind-op@test.local', 'RemindTemp2026');
  expect((await call('POST', '/auth/change-password', first, { current: 'RemindTemp2026', next: 'RemindOwn2026' })).status).toBe(200);
  operator = first;
  // Only this test's flock is active, so "done" depends on it alone (the others are reopened afterwards).
  reopen = (await prisma.flock.findMany({ where: { status: 'ACTIVE' } })).map(f => f.id);
  await prisma.flock.updateMany({ where: { id: { in: reopen } }, data: { status: 'CLOSED' } });
  await call('POST', '/flocks', owner, { code: 'REM-A', name: 'Reminder flock', startDate: '2026-01-01', openingCount: 100 });
});
afterAll(async () => {
  await prisma.flock.updateMany({ where: { id: { in: reopen } }, data: { status: 'ACTIVE' } });
  await prisma.flock.updateMany({ where: { code: 'REM-A' }, data: { status: 'CLOSED' } });
  await app?.close();
});

describe('which reminder is due', () => {
  it('follows the morning and evening times, then +1 h and +2 h', () => {
    expect(dueSlots(at('09:59'), cfg)).toEqual([]);
    expect(dueSlots(at('10:00'), cfg)).toEqual(['morning']);
    expect(dueSlots(at('10:03'), cfg)).toEqual(['morning']); // a late tick still catches it
    expect(dueSlots(at('11:00'), cfg)).toEqual(['morning-again']);
    expect(dueSlots(at('12:00'), cfg)).toEqual(['morning-owner']);
    expect(dueSlots(at('17:00'), cfg)).toEqual(['evening']);
    expect(dueSlots(at('19:01'), cfg)).toEqual(['evening-owner']);
    expect(dueSlots(at('10:00'), { ...cfg, on: false })).toEqual([]);
    expect(dueSlots(at('09:30'), { ...cfg, morning: '09:30', evening: '18:00' })).toEqual(['morning']);
    expect(dueSlots(at('20:00'), { ...cfg, morning: '09:30', evening: '18:00' })).toEqual(['evening-owner']);
  });
});

describe('sending', () => {
  const day = (hhmm: string) => at(hhmm);
  let sent: Sent[] = [];
  const send = async (s: Sent) => { sent.push(s); };

  it('asks data-entry staff in the morning, but not the owner', async () => {
    await subscribe(operator, 'op-phone');
    await subscribe(owner, 'owner-phone');
    sent = [];
    await runReminders(prisma, day('10:00'), send);
    expect(sent.map(s => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/op-phone']);
    expect(sent[0].payload.url).toBe('/?flow=eggs');
  });

  it('never sends the same reminder twice in a day', async () => {
    sent = [];
    await runReminders(prisma, day('10:01'), send);
    expect(sent).toEqual([]);
  });

  it('tells the owner at +2 h when the morning eggs are still not recorded', async () => {
    sent = [];
    await runReminders(prisma, day('11:00'), send);
    expect(sent.map(s => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/op-phone']);
    sent = [];
    await runReminders(prisma, day('12:00'), send);
    expect(sent.map(s => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/owner-phone']);
  });

  it('one failing phone does not stop the others; the failure is logged', async () => {
    await subscribe(operator, 'broken-phone');
    const errors: string[] = [];
    const sentTo: string[] = [];
    const flaky = async (s: Sent) => { if (s.endpoint.endsWith('broken-phone')) throw new Error('push service down'); sentTo.push(s.endpoint); };
    await runReminders(prisma, new Date('2026-11-09T10:00:00+06:00'), flaky, { error: m => errors.push(m) });
    expect(sentTo).toContain('https://fcm.googleapis.com/fcm/send/op-phone');
    expect(errors.join()).toMatch(/push service down/);
    await call('DELETE', '/push/subscribe', operator, { endpoint: 'https://fcm.googleapis.com/fcm/send/broken-phone' });
  });

  it('stays quiet once the job is done', async () => {
    const flock = await prisma.flock.findFirstOrThrow({ where: { code: 'REM-A' } });
    await prisma.productionLog.create({ data: { date: new Date('2026-11-06T00:00:00Z'), flockId: flock.id, eggsCollected: 80, feedQty: 6 } });
    await prisma.reminderLog.createMany({ data: [{ day: '2026-11-06', slot: 'none-medicine', kind: 'none' }, { day: '2026-11-06', slot: 'none-expenses', kind: 'none' }] });
    sent = [];
    await runReminders(prisma, day('17:00'), send);
    expect(sent).toEqual([]);
  });
});

describe('settings and subscriptions', () => {
  it('only the owner or an admin sets the times, in HH:MM', async () => {
    expect((await call('GET', '/settings/reminders', owner)).body).toEqual({ on: true, morning: '10:00', evening: '17:00' });
    expect((await call('PUT', '/settings/reminders', owner, { on: true, morning: '25:00', evening: '17:00' })).status).toBe(400);
    // +1 h and +2 h must stay on the same farm day.
    expect((await call('PUT', '/settings/reminders', owner, { on: true, morning: '10:00', evening: '22:30' })).status).toBe(400);
    expect((await call('PUT', '/settings/reminders', operator, { on: true, morning: '09:00', evening: '17:00' })).status).toBe(403);
    expect((await call('PUT', '/settings/reminders', owner, { on: true, morning: '09:30', evening: '18:00' })).status).toBe(200);
    expect((await call('GET', '/settings/reminders', owner)).body).toMatchObject({ morning: '09:30', evening: '18:00' });
  });

  it('gives the public key, and a phone can unsubscribe', async () => {
    expect((await call('GET', '/push/key', operator)).body.publicKey).toMatch(/^[A-Za-z0-9_-]{60,}$/);
    expect((await call('DELETE', '/push/subscribe', operator, { endpoint: 'https://fcm.googleapis.com/fcm/send/op-phone' })).status).toBe(200);
    expect(await prisma.pushSubscription.count({ where: { endpoint: 'https://fcm.googleapis.com/fcm/send/op-phone' } })).toBe(0);
  });

  it('records "none today" for feed, medicine or expenses', async () => {
    expect((await call('POST', '/me/today/none', operator, { what: 'feed' })).status).toBe(200);
    expect(await prisma.reminderLog.count({ where: { day: farmYmd(), slot: 'none-feed' } })).toBe(1);
    expect((await call('POST', '/me/today/none', operator, { what: 'feed' })).status).toBe(200); // twice is fine
    expect((await call('POST', '/me/today/none', operator, { what: 'eggs' })).status).toBe(400);
    expect((await call('GET', '/me/today', owner)).body.none).toContain('feed');
    expect(await prisma.auditLog.count({ where: { entity: 'reminder', summary: { startsWith: 'Marked no feed today' } } })).toBe(1);
  });

  it('only accepts browser push services as phone addresses (no requests to other servers)', async () => {
    for (const endpoint of ['https://169.254.169.254/latest/meta-data', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.example/x',
      'https://fcm.googleapis.com:8443/x', 'https://localhost/x', 'https://user:pw@fcm.googleapis.com/x']) {
      expect((await call('POST', '/push/subscribe', operator, { endpoint, keys: { p256dh: 'key-abcdefghij', auth: 'auth-x' } })).status, endpoint).toBe(400);
      expect(isPushEndpoint(endpoint)).toBe(false);
    }
    for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://db5p.notify.windows.com/w/?token=abc', 'https://web.push.apple.com/QabcD']) {
      expect(isPushEndpoint(ok), ok).toBe(true);
    }
  });

  it('refuses to run with only one of the two VAPID keys set', () => {
    process.env.VAPID_PUBLIC_KEY = 'only-the-public-half';
    try { expect(() => vapidKeys()).toThrow(/both/); } finally { delete process.env.VAPID_PUBLIC_KEY; }
  });
});
