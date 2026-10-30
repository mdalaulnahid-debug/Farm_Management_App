import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';

let app: FastifyInstance;
let cookie = '';
const PASSWORD = 'TestOwner2026';

const call = async (method: string, url: string, payload?: unknown, c = cookie) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: c ? { cookie: c } : {} });
  return { status: res.statusCode, body: res.json() as any };
};
const id = async (code: string) => (await prisma.account.findUniqueOrThrow({ where: { code } })).id;

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.local', password: PASSWORD } });
  cookie = String(res.headers['set-cookie']).split(';')[0];
});
afterAll(async () => app?.close());

describe('authentication & authorization', () => {
  it('rejects anonymous requests', async () => {
    expect((await call('GET', '/dashboard', undefined, '')).status).toBe(401);
  });
  it('rejects a wrong password', async () => {
    expect((await call('POST', '/auth/login', { email: 'owner@test.local', password: 'nope-nope-1' }, '')).status).toBe(401);
  });
  it('enforces role permissions on the server', async () => {
    const roles = (await call('GET', '/roles')).body.data;
    const operator = roles.find((r: any) => r.key === 'operator');
    expect((await call('POST', '/users', { name: 'Op User', email: 'op@test.local', roleId: operator.id, password: 'Operator2026' })).status).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'op@test.local', password: 'Operator2026' } });
    const opCookie = String(login.headers['set-cookie']).split(';')[0];
    expect((await call('GET', '/reports/profit-loss', undefined, opCookie)).status).toBe(403);
    expect((await call('GET', '/users', undefined, opCookie)).status).toBe(403);
    expect((await call('GET', '/dashboard', undefined, opCookie)).status).toBe(200);
  });
});

describe('October workbook history', () => {
  it('reconciles to the workbook closing figures', async () => {
    const bs = (await call('GET', '/reports/balance-sheet?asOf=2026-10-31')).body;
    const cash = bs.currentAssets.lines.find((l: any) => l.code === '1010').amount;
    const ar = bs.currentAssets.lines.find((l: any) => l.code === '1100').amount;
    expect(cash).toBe(15897);
    expect(ar).toBe(7072);
    expect(bs.balanced).toBe(true);
    const pl = (await call('GET', '/reports/profit-loss?from=2026-10-01&to=2026-10-31')).body;
    expect(pl.revenue).toBe(80618);
    expect(pl.totalExpenses).toBe(70719);
    expect(pl.netProfit).toBe(9899);
    const tb = (await call('GET', '/reports/trial-balance?asOf=2026-10-31')).body;
    expect(tb.balanced).toBe(true);
    const cf = (await call('GET', '/reports/cash-flow?from=2026-10-01&to=2026-10-31')).body;
    expect(cf.openingCash).toBe(-5410);
    expect(cf.closingCash).toBe(15897);
  });
});

describe('order-to-cash and procure-to-pay', () => {
  it('posts a feed purchase to inventory, consumes it through production and expenses it at average cost', async () => {
    const feed = await prisma.item.findUniqueOrThrow({ where: { sku: 'FEED-LAYER' } });
    const flock = await prisma.flock.findUniqueOrThrow({ where: { code: 'FLK-01' } });
    await call('PUT', `/flocks/${flock.id}`, { code: flock.code, name: flock.name, species: 'DUCK', startDate: '2026-10-01', status: 'ACTIVE', currentCount: 500 });
    const supplier = (await call('POST', '/parties', { kind: 'SUPPLIER', name: 'Feed Mill Ltd', paymentTerms: 15 })).body;
    const bill = await call('POST', '/bills', { date: '2026-11-01', supplierId: supplier.id, lines: [{ itemId: feed.id, quantity: 100, unitPrice: 50 }, { itemId: feed.id, quantity: 100, unitPrice: 60 }] });
    expect(bill.status).toBe(200);
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: feed.id } })).avgCost)).toBe(55);

    const prod = await call('POST', '/production', { date: '2026-11-02', flockId: flock.id, eggsCollected: 400, eggsBroken: 10, mortality: 2, feedItemId: feed.id, feedQty: 40 });
    expect(prod.status).toBe(200);
    expect(prod.body.feedCost).toBe(2200);
    expect((await prisma.flock.findUniqueOrThrow({ where: { id: flock.id } })).currentCount).toBe(498);
    const pl = (await call('GET', '/reports/profit-loss?from=2026-11-01&to=2026-11-30')).body;
    expect(pl.operating.lines.find((l: any) => l.code === '6010').amount).toBe(2200);

    const pay = await call('POST', '/payments', { direction: 'OUT', date: '2026-11-05', partyId: supplier.id, cashAccountId: await id('1010'), amount: 4000, allocations: [{ billId: bill.body.id, amount: 4000 }] });
    expect(pay.status).toBe(200);
    expect((await call('GET', `/bills/${bill.body.id}`)).body.status).toBe('PARTIAL');
    const ap = (await call('GET', '/reports/ap-aging?asOf=2026-11-30')).body;
    expect(ap.totals.total).toBe(7000);
  });

  it('sells eggs on credit, collects, and blocks selling more eggs than in stock', async () => {
    const eggs = await prisma.item.findUniqueOrThrow({ where: { sku: 'EGG-DUCK' } });
    const customer = (await call('POST', '/parties', { kind: 'CUSTOMER', name: 'Rahim Store', paymentTerms: 7 })).body;
    const tooMany = await call('POST', '/invoices', { date: '2026-11-03', customerId: customer.id, lines: [{ itemId: eggs.id, quantity: 100000, unitPrice: 16 }] });
    expect(tooMany.status).toBe(400);
    const inv = await call('POST', '/invoices', { date: '2026-11-03', customerId: customer.id, discount: 20, lines: [{ itemId: eggs.id, quantity: 300, unitPrice: 16 }], received: { amount: 2000, cashAccountId: await id('1010') } });
    expect(inv.status).toBe(200);
    expect(inv.body.total).toBe(4780);
    const fresh = (await call('GET', `/invoices/${inv.body.id}`)).body;
    expect(fresh.status).toBe('PARTIAL');
    expect(fresh.amountPaid).toBe(2000);
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: eggs.id } })).qtyOnHand)).toBe(90);
  });

  it('voiding requires voiding receipts first and then fully reverses the invoice', async () => {
    const inv = (await call('GET', '/invoices?search=Rahim')).body.data[0];
    expect((await call('POST', `/invoices/${inv.id}/void`, { reason: 'entered twice' })).status).toBe(409);
    const detail = (await call('GET', `/invoices/${inv.id}`)).body;
    for (const a of detail.allocations) expect((await call('POST', `/payments/${a.paymentId}/void`, { reason: 'entered twice' })).status).toBe(200);
    expect((await call('POST', `/invoices/${inv.id}/void`, { reason: 'entered twice' })).status).toBe(200);
    const eggs = await prisma.item.findUniqueOrThrow({ where: { sku: 'EGG-DUCK' } });
    expect(Number(eggs.qtyOnHand)).toBe(390);
    const tb = (await call('GET', '/reports/trial-balance?asOf=2026-11-30')).body;
    expect(tb.balanced).toBe(true);
  });
});

describe('accounting controls', () => {
  it('refuses an unpaid bill with no supplier', async () => {
    const r = await call('POST', '/bills', { date: '2026-11-10', lines: [{ accountId: await id('6090'), quantity: 1, unitPrice: 500 }] });
    expect(r.status).toBe(400);
    const paid = await call('POST', '/bills', { date: '2026-11-10', lines: [{ accountId: await id('6090'), quantity: 1, unitPrice: 500 }], paid: { amount: 500, cashAccountId: await id('1010') } });
    expect(paid.status).toBe(200);
    expect((await call('GET', `/bills/${paid.body.id}`)).body.status).toBe('PAID');
  });
  it('rejects an unbalanced manual journal', async () => {
    const r = await call('POST', '/journals', { date: '2026-11-10', memo: 'Bad entry', lines: [{ accountId: await id('1010'), debit: 100 }, { accountId: await id('3010'), credit: 90 }] });
    expect(r.status).toBe(400);
  });
  it('blocks postings in a closed period', async () => {
    expect((await call('PUT', '/settings/lock-date', { lockDate: '2026-10-31' })).status).toBe(200);
    const r = await call('POST', '/journals', { date: '2026-10-15', memo: 'Back-dated', lines: [{ accountId: await id('1010'), debit: 100 }, { accountId: await id('3010'), credit: 100 }] });
    expect(r.status).toBe(409);
    await call('PUT', '/settings/lock-date', { lockDate: null });
  });
  it('records an audit trail', async () => {
    const r = await call('GET', '/audit');
    expect(r.body.total).toBeGreaterThan(10);
  });
});
