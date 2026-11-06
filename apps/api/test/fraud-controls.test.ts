// Insider-fraud controls: staff cannot back-date or void old records, voids need a real reason,
// and the owner gets an "unusual activity" report of voids, back-dated entries, discounts,
// stock write-offs, cash shortages, failed sign-ins and user/settings changes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { withVoucher } from './helpers/voucher.js';

let app: FastifyInstance;
let ownerCookie = '';
let managerCookie = '';
const PASSWORD = 'TestOwner2026';

const call = async (method: string, url: string, cookie: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: (await withVoucher(method, url, payload)) as any, headers: cookie ? { cookie } : {} });
  return { status: res.statusCode, body: res.json() as any };
};
const signIn = async (email: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  return { status: res.statusCode, cookie: String(res.headers['set-cookie']).split(';')[0] };
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const acc = async (code: string) => (await prisma.account.findUniqueOrThrow({ where: { code } })).id;
/** A cash expense (other money out), which a farm manager may record and void. */
const expense = async (cookie: string, date: string, amount = 100) =>
  call('POST', '/payments', cookie, { direction: 'OUT', date, cashAccountId: await acc('1010'), counterAccountId: await acc('6090'), amount, notes: 'Fraud-control test' });

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  ownerCookie = (await signIn('owner@test.local', PASSWORD)).cookie;
  const manager = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } });
  expect((await call('POST', '/users', ownerCookie, { name: 'Fraud Manager', email: 'fraud-manager@test.local', roleId: manager.id, password: 'ManagerTemp2026' })).status).toBe(200);
  managerCookie = (await signIn('fraud-manager@test.local', 'ManagerTemp2026')).cookie;
  expect((await call('POST', '/auth/change-password', managerCookie, { current: 'ManagerTemp2026', next: 'ManagerOwn2026' })).status).toBe(200);
});
afterAll(async () => app?.close());

describe('back-dating limit for staff', () => {
  // Test entries dated in the past are voided again, so other tests' period totals are untouched.
  it('lets a manager record (and void) something from the last few days', async () => {
    const p = await expense(managerCookie, day(-3));
    expect(p.status).toBe(200);
    expect((await call('POST', `/payments/${p.body.id}/void`, managerCookie, { reason: 'test entry, removing it' })).status).toBe(200);
  });
  it('stops a manager from back-dating more than 7 days', async () => {
    const res = await expense(managerCookie, day(-10));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/7 days/);
  });
  it('stops a manager from dating something in the future', async () => {
    expect((await expense(managerCookie, day(3))).status).toBe(400);
  });
  it('still lets the owner record an older date', async () => {
    const p = await expense(ownerCookie, day(-20));
    expect(p.status).toBe(200);
    expect((await call('POST', `/payments/${p.body.id}/void`, ownerCookie, { reason: 'test entry, removing it' })).status).toBe(200);
  });
});

describe('voiding', () => {
  it('needs a real reason, not just a word', async () => {
    const p = await expense(managerCookie, day(0));
    expect((await call('POST', `/payments/${p.body.id}/void`, managerCookie, { reason: 'mistake' })).status).toBe(400);
    expect((await call('POST', `/payments/${p.body.id}/void`, managerCookie, { reason: 'typed the amount twice' })).status).toBe(200);
  });
  it('a manager cannot void an old record; the owner can', async () => {
    const old = await expense(ownerCookie, day(-15), 250);
    expect(old.status).toBe(200);
    const res = await call('POST', `/payments/${old.body.id}/void`, managerCookie, { reason: 'never happened, removing it' });
    expect(res.status).toBe(403);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: old.body.id } })).status).toBe('POSTED');
    expect((await call('POST', `/payments/${old.body.id}/void`, ownerCookie, { reason: 'owner checked: entered twice' })).status).toBe(200);
  });
});

describe('unusual activity report', () => {
  const ok = async (res: Promise<{ status: number; body: any }>) => {
    const r = await res;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.body.message}`);
    return r.body;
  };

  beforeAll(async () => {
    const eggs = await prisma.item.findUniqueOrThrow({ where: { sku: 'EGG-DUCK' } });
    // Exactly the eggs used below (10 sold + 2 wasted), at zero cost like produced eggs, so other tests' stock and costs are unchanged.
    await ok(call('POST', '/stock-adjustments', ownerCookie, { date: day(0), itemId: eggs.id, type: 'OPENING', quantity: 12, unitCost: 0 }));
    await ok(call('POST', '/invoices', managerCookie, { date: day(0), customer: {}, discount: 40, lines: [{ itemId: eggs.id, quantity: 10, unitPrice: 16 }], received: { amount: 120, cashAccountId: await acc('1010') } }));
    await ok(call('POST', '/stock-adjustments', managerCookie, { date: day(0), itemId: eggs.id, type: 'WASTE', quantity: 2 }));
    // Plenty of cash on the books, then a count that finds none of it.
    const cashIn = await ok(call('POST', '/payments', managerCookie, { direction: 'IN', date: day(0), cashAccountId: await acc('1010'), counterAccountId: await acc('4500'), amount: 500000 }));
    await ok(call('POST', '/cash-counts', managerCookie, { date: day(0), accountId: await acc('1010'), counted: 0 }));
    await ok(call('POST', `/payments/${cashIn.id}/void`, ownerCookie, { reason: 'test entry, removing it' }));
    for (let i = 0; i < 2; i++) expect((await signIn('fraud-manager@test.local', 'not-my-password-1')).status).toBe(401);
  });

  const report = async (cookie = ownerCookie) => call('GET', `/reports/activity?from=${day(-1)}&to=${day(1)}`, cookie);

  it('is for the owner and auditors only', async () => {
    expect((await report(managerCookie)).status).toBe(403);
    expect((await report()).status).toBe(200);
  });

  it('lists voids with who did them', async () => {
    const { voids } = (await report()).body;
    const v = voids.find((x: any) => x.summary.includes('typed the amount twice'));
    expect(v.user).toBe('Fraud Manager');
    expect(v.reason).toBe('typed the amount twice');
    // The owner voided two test entries with the same reason today: one line, not two.
    const same = voids.filter((x: any) => x.user === 'Farm Owner' && x.reason === 'test entry, removing it');
    expect(same).toHaveLength(1);
    expect(same[0].count).toBe(2);
    expect(same[0].records).toHaveLength(2);
  });

  it('groups back-dated entries by who entered them', async () => {
    const { backdated } = (await report()).body;
    // The owner's two old-dated test expenses (both voided since); the seed's history import may share the row.
    const owner = backdated.find((g: any) => g.user === 'Farm Owner' && g.earliest <= day(-20));
    expect(owner).toBeTruthy();
    expect(owner.count).toBeGreaterThanOrEqual(2);
    expect(owner.voided).toBeGreaterThanOrEqual(2);
    // The manager's 3-day-old expense is listed; their same-day sale, write-off and cash entries are not.
    const manager = backdated.filter((g: any) => g.user === 'Fraud Manager');
    expect(manager.reduce((s: number, g: any) => s + g.count, 0)).toBe(1);
  });

  it('lists discounts with their percentage', async () => {
    const d = (await report()).body.discounts.find((x: any) => x.discount === 40);
    expect(d.user).toBe('Fraud Manager');
    expect(d.percent).toBe(25);
  });

  it('lists stock written off, cash shortages and failed sign-ins', async () => {
    const r = (await report()).body;
    expect(r.writeOffs.find((w: any) => w.user === 'Fraud Manager' && w.type === 'WASTE').quantity).toBe(2);
    expect(r.cashShortages.find((c: any) => c.user === 'Fraud Manager').variance).toBeLessThan(0);
    expect(r.failedSignIns.find((f: any) => f.email === 'fraud-manager@test.local').count).toBe(2);
  });

  it('lists user and settings changes', async () => {
    const { adminChanges } = (await report()).body;
    expect(adminChanges.some((a: any) => a.summary.includes('fraud-manager@test.local'))).toBe(true);
  });
});
