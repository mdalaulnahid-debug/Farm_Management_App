// Data-entry staff can fix their own mistakes until midnight (Bangladesh time): their own entries made today
// can be voided and re-entered. Someone else's entries, or their own from yesterday, stay for the owner.
// "What I recorded today" lists exactly those own entries of today.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { farmDayStart, farmYmd, isSameFarmDay } from '../src/lib/farm-time.js';

let app: FastifyInstance;
let owner = '';
let rahim = '';
let karim = '';
let cashId = '';
let eggId = '';
let feedId = '';
let flockId = '';
const today = () => farmYmd();
const REASON = { reason: 'Typed the wrong number' };

const call = async (method: string, url: string, cookie: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: { cookie } });
  return { status: res.statusCode, body: res.json() as any };
};
let device = 0;
const signIn = async (email: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress: `10.7.0.${++device}` });
  expect(res.statusCode).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0];
};
const operator = async (email: string) => {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'operator' } });
  expect((await call('POST', '/users', owner, { name: email.split('@')[0], email, roleId: role.id, password: 'FixTemp2026' })).status).toBe(200);
  const c = await signIn(email, 'FixTemp2026');
  expect((await call('POST', '/auth/change-password', c, { current: 'FixTemp2026', next: 'FixOwn2026x' })).status).toBe(200);
  return c;
};
/** Pretend a record was made at 23:50 Bangladesh time yesterday. */
const yesterday = () => new Date(farmDayStart().getTime() - 10 * 60_000);
const sale = (cookie: string, received = true) => call('POST', '/invoices', cookie, {
  // An unpaid sale needs a known customer (walk-in buyers pay in full), so the buyer is a customer with a mobile number.
  date: today(), customer: { name: 'Fix Test Buyer', phone: '01700-000001' }, lines: [{ itemId: eggId, quantity: 30, unitPrice: 15 }], ...(received ? { received: { amount: 450, cashAccountId: cashId } } : {}),
});

beforeAll(async () => {
  // All test files share one database and only the first seed() runs, so every file seeds the same way (with history).
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  owner = await signIn('owner@test.local', 'TestOwner2026');
  rahim = await operator('fix-rahim@test.local');
  karim = await operator('fix-karim@test.local');
  cashId = (await prisma.account.findFirstOrThrow({ where: { code: '1010' } })).id;
  eggId = (await call('POST', '/items', owner, { sku: 'FIX-EGG', name: 'Fix eggs', category: 'PRODUCE', unit: 'pcs', salePrice: 15, valued: false })).body.id;
  feedId = (await call('POST', '/items', owner, { sku: 'FIX-FEED', name: 'Fix feed', category: 'FEED', unit: 'kg', purchasePrice: 40 })).body.id;
  flockId = (await call('POST', '/flocks', owner, { code: 'FIX-A', name: 'Fix flock', startDate: '2026-01-01', openingCount: 300 })).body.id;
  for (const [itemId, quantity, unitCost] of [[eggId, 5000, 0], [feedId, 500, 40]] as const) {
    expect((await call('POST', '/stock-adjustments', owner, { date: '2026-01-01', itemId, type: 'OPENING', quantity, unitCost })).status).toBe(200);
  }
});
afterAll(async () => app?.close());

describe('the farm clock', () => {
  it('starts the day at midnight in Barishal, not in UTC', () => {
    const half12 = new Date('2026-11-05T18:30:00Z'); // 00:30 on 6 November in Barishal
    expect(farmYmd(half12)).toBe('2026-11-06');
    expect(farmDayStart(half12).toISOString()).toBe('2026-11-05T18:00:00.000Z');
    expect(isSameFarmDay(new Date('2026-11-05T18:10:00Z'), half12)).toBe(true);
    expect(isSameFarmDay(new Date('2026-11-05T17:50:00Z'), half12)).toBe(false);
  });
});

describe('fixing your own entries the same day', () => {
  it('an operator cancels their own cash sale: the sale and its cash receipt are both void', async () => {
    const inv = (await sale(rahim)).body;
    const res = await call('POST', `/invoices/${inv.id}/void`, rahim, REASON);
    expect(res.status).toBe(200);
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('VOID');
    const pays = await prisma.paymentAllocation.findMany({ where: { invoiceId: inv.id }, include: { payment: true } });
    expect(pays.length).toBeGreaterThan(0);
    expect(pays.every(p => p.payment.status === 'VOID')).toBe(true);
  });

  it('cannot cancel someone else’s sale', async () => {
    const inv = (await sale(rahim)).body;
    expect((await call('POST', `/invoices/${inv.id}/void`, karim, REASON)).status).toBe(403);
  });

  it('cannot cancel their own sale from yesterday', async () => {
    const inv = (await sale(rahim, false)).body;
    await prisma.salesInvoice.update({ where: { id: inv.id }, data: { createdAt: yesterday() } });
    expect((await call('POST', `/invoices/${inv.id}/void`, rahim, REASON)).status).toBe(403);
    expect((await call('POST', `/invoices/${inv.id}/void`, owner, REASON)).status).toBe(200);
  });

  it('production: own today yes, own yesterday no (the owner still can)', async () => {
    const today1 = (await call('POST', '/production', rahim, { date: today(), flockId, eggsCollected: 250 })).body;
    expect((await call('POST', `/production/${today1.id}/void`, karim, REASON)).status).toBe(403);
    expect((await call('POST', `/production/${today1.id}/void`, rahim, REASON)).status).toBe(200);
    const old = (await call('POST', '/production', rahim, { date: today(), flockId, eggsCollected: 240 })).body;
    await prisma.productionLog.update({ where: { id: old.id }, data: { createdAt: yesterday() } });
    expect((await call('POST', `/production/${old.id}/void`, rahim, REASON)).status).toBe(403);
    expect((await call('POST', `/production/${old.id}/void`, owner, REASON)).status).toBe(200);
  });

  it('feed or medicine taken from stock can be cancelled: quantity, cost and books come back', async () => {
    const before = await prisma.item.findUniqueOrThrow({ where: { id: feedId } });
    const used = (await call('POST', '/stock-adjustments', rahim, { date: today(), itemId: feedId, type: 'USAGE', quantity: 12 })).body;
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: feedId } })).qtyOnHand)).toBe(Number(before.qtyOnHand) - 12);
    expect((await call('POST', `/stock-adjustments/${used.sourceId}/void`, karim, REASON)).status).toBe(403);
    expect((await call('POST', `/stock-adjustments/${used.sourceId}/void`, rahim, REASON)).status).toBe(200);
    const after = await prisma.item.findUniqueOrThrow({ where: { id: feedId } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand));
    expect(Number(after.avgCost)).toBeCloseTo(Number(before.avgCost), 4);
    const je = await prisma.journalEntry.findFirst({ where: { sourceType: 'ADJUSTMENT', sourceId: used.sourceId } });
    expect(je?.status).toBe('VOID');
    expect((await call('POST', `/stock-adjustments/${used.sourceId}/void`, rahim, REASON)).status).toBe(409);
  });
});

describe('what I recorded today', () => {
  it('lists only my own entries made today, newest first', async () => {
    const mine = (await sale(karim, false)).body;
    const old = (await sale(karim, false)).body;
    await prisma.salesInvoice.update({ where: { id: old.id }, data: { createdAt: yesterday() } });
    await sale(rahim, false);
    const { status, body } = await call('GET', '/me/today', karim);
    expect(status).toBe(200);
    const ids = body.entries.map((e: any) => e.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(old.id);
    const rahimId = (await prisma.user.findUniqueOrThrow({ where: { email: 'fix-rahim@test.local' } })).id;
    const rahimsInvoices = await prisma.salesInvoice.findMany({ where: { createdById: rahimId } });
    for (const r of rahimsInvoices) expect(ids).not.toContain(r.id);
    expect(body.entries.every((e: any) => e.canFix === true)).toBe(true);
    const times = body.entries.map((e: any) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('leaves out entries that were cancelled', async () => {
    const inv = (await sale(karim, false)).body;
    expect((await call('POST', `/invoices/${inv.id}/void`, karim, REASON)).status).toBe(200);
    const { body } = await call('GET', '/me/today', karim);
    expect(body.entries.map((e: any) => e.id)).not.toContain(inv.id);
  });
});
