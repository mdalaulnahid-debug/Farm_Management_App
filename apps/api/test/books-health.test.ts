// Books health (P1-3): the ledger's invariants hold after normal work, and each kind of damage
// (a bug or a direct edit of the database file) is caught. Damage is made inside a transaction that
// is rolled back, so other tests never see it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { booksHealth } from '../src/services/health.js';

let app: FastifyInstance;
let cookie = '';
const PASSWORD = 'TestOwner2026';
// A quiet future month that no other test file reports on (only the owner may date entries ahead).
const day = () => '2027-06-15';
const call = async (method: string, url: string, payload?: unknown, c = cookie) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: c ? { cookie: c } : {} });
  if (res.statusCode !== 200) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json() as any;
};
const acc = async (code: string) => (await prisma.account.findUniqueOrThrow({ where: { code } })).id;
const failing = (r: Awaited<ReturnType<typeof booksHealth>>) => r.checks.filter(c => !c.ok).map(c => c.key);
const ownAccounts = async () => ({ inventoryAccountId: await acc('1291'), incomeAccountId: await acc('4991'), expenseAccountId: await acc('5991') });

/** Run `damage` and the health check in one transaction, then roll it all back. */
async function withDamage(damage: (db: Prisma.TransactionClient) => Promise<unknown>) {
  let result: Awaited<ReturnType<typeof booksHealth>> | undefined;
  await prisma.$transaction(async db => {
    await damage(db);
    result = await booksHealth(db);
    throw new Error('rollback');
  }).catch(e => { if ((e as Error).message !== 'rollback') throw e; });
  return result!;
}

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.local', password: PASSWORD } });
  cookie = String(res.headers['set-cookie']).split(';')[0];

  // A normal day: stock in, a credit sale partly paid, an unapplied receipt, a paid bill, and a void.
  // Own products and accounts, so the farm's stock, costs and monthly totals that other tests check are untouched.
  await call('POST', '/accounts', { code: '1291', name: 'Health check stock', type: 'ASSET', subtype: 'INVENTORY' });
  await call('POST', '/accounts', { code: '4991', name: 'Health check sales', type: 'INCOME', subtype: 'SALES' });
  await call('POST', '/accounts', { code: '5991', name: 'Health check cost of sales', type: 'EXPENSE', subtype: 'COGS' });
  const eggs = await call('POST', '/items', { sku: 'HEALTH-EGG', name: 'Health check eggs', category: 'PRODUCE', unit: 'pcs', ...(await ownAccounts()) });
  const feed = await call('POST', '/items', { sku: 'HEALTH-FEED', name: 'Health check feed A', category: 'FEED', unit: 'kg', ...(await ownAccounts()) });
  await call('POST', '/stock-adjustments', { date: day(), itemId: eggs.id, type: 'OPENING', quantity: 50, unitCost: 0 });
  const customer = await call('POST', '/parties', { kind: 'CUSTOMER', name: 'Health Check Store' });
  const supplier = await call('POST', '/parties', { kind: 'SUPPLIER', name: 'Health Check Feeds' });
  await call('POST', '/invoices', { date: day(), customerId: customer.id, lines: [{ itemId: eggs.id, quantity: 20, unitPrice: 15 }], received: { amount: 100, cashAccountId: await acc('1010') } });
  await call('POST', '/payments', { direction: 'IN', date: day(), partyId: customer.id, cashAccountId: await acc('1010'), amount: 50 });
  await call('POST', '/bills', { date: day(), supplierId: supplier.id, lines: [{ itemId: feed.id, quantity: 10, unitPrice: 40 }] });
  const sale = await call('POST', '/invoices', { date: day(), customerId: customer.id, lines: [{ itemId: eggs.id, quantity: 5, unitPrice: 15 }] });
  await call('POST', `/invoices/${sale.id}/void`, { reason: 'entered for the wrong customer' });

  // Less common but normal: refunds both ways, an opening balance journalled to receivables,
  // a voided payment, and a paid sale voided after voiding its receipt.
  await call('POST', '/payments', { direction: 'OUT', date: day(), partyId: customer.id, cashAccountId: await acc('1010'), counterAccountId: await acc('1100'), amount: 20, notes: 'Refund to customer' });
  await call('POST', '/payments', { direction: 'IN', date: day(), partyId: supplier.id, cashAccountId: await acc('1010'), counterAccountId: await acc('2010'), amount: 30, notes: 'Refund from supplier' });
  await call('POST', '/journals', { date: day(), memo: 'Opening balance owed by customer', opening: true, lines: [{ accountId: await acc('1100'), debit: 250, partyId: customer.id }, { accountId: await acc('3900'), credit: 250 }] });
  const wrongPayment = await call('POST', '/payments', { direction: 'OUT', date: day(), partyId: supplier.id, cashAccountId: await acc('1010'), amount: 40 });
  await call('POST', `/payments/${wrongPayment.id}/void`, { reason: 'paid the wrong supplier' });
  const paidSale = await call('POST', '/invoices', { date: day(), customerId: customer.id, lines: [{ itemId: eggs.id, quantity: 3, unitPrice: 15 }], received: { amount: 45, cashAccountId: await acc('1010') } });
  const receipt = (await call('GET', `/invoices/${paidSale.id}`)).allocations[0].paymentId;
  await call('POST', `/payments/${receipt}/void`, { reason: 'sale cancelled by the customer' });
  await call('POST', `/invoices/${paidSale.id}/void`, { reason: 'sale cancelled by the customer' });
});
afterAll(async () => app?.close());

describe('healthy books', () => {
  it('all checks pass after normal work', async () => {
    const r = await booksHealth(prisma);
    expect(failing(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checks.map(c => c.key)).toEqual(['entries_balanced', 'trial_balance', 'voids_reversed', 'receivables', 'payables', 'stock_quantities', 'inventory_value']);
    expect(r.checks.find(c => c.key === 'inventory_value')!.kind).toBe('drift');
  });

  it('is available to the owner and auditors, not to staff', async () => {
    expect((await call('GET', '/reports/books-health')).ok).toBe(true);
    const operator = await prisma.role.findUniqueOrThrow({ where: { key: 'operator' } });
    await call('POST', '/users', { name: 'Health Op', email: 'health-op@test.local', roleId: operator.id, password: 'HealthTemp2026' });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'health-op@test.local', password: 'HealthTemp2026' } });
    const op = String(login.headers['set-cookie']).split(';')[0];
    await call('POST', '/auth/change-password', { current: 'HealthTemp2026', next: 'HealthOwn2026' }, op);
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/books-health', headers: { cookie: op } });
    expect(res.statusCode).toBe(403);
  });
});

describe('damage is caught', () => {
  it('an extra amount slipped into one entry', async () => {
    const r = await withDamage(async db => {
      const line = await db.journalLine.findFirstOrThrow({ where: { entry: { status: 'POSTED' }, debit: { gt: 0 } } });
      await db.journalLine.update({ where: { id: line.id }, data: { debit: num(line.debit) + 500 } });
    });
    expect(failing(r)).toEqual(expect.arrayContaining(['entries_balanced', 'trial_balance']));
    expect(r.checks.find(c => c.key === 'entries_balanced')!.examples).toHaveLength(1);
  });

  it('an entry marked void without its reversal', async () => {
    const r = await withDamage(async db => {
      const e = await db.journalEntry.findFirstOrThrow({ where: { status: 'POSTED', sourceType: 'MANUAL' } })
        .catch(() => db.journalEntry.findFirstOrThrow({ where: { status: 'POSTED' } }));
      await db.journalEntry.update({ where: { id: e.id }, data: { status: 'VOID' } });
    });
    expect(failing(r)).toContain('voids_reversed');
  });

  it('an invoice marked paid without the money', async () => {
    const r = await withDamage(async db => {
      const inv = await db.salesInvoice.findFirstOrThrow({ where: { status: { in: ['POSTED', 'PARTIAL'] } } });
      await db.salesInvoice.update({ where: { id: inv.id }, data: { amountPaid: inv.total, status: 'PAID' } });
    });
    expect(failing(r)).toEqual(['receivables']);
  });

  it('a bill marked paid without the money', async () => {
    const r = await withDamage(async db => {
      const bill = await db.bill.findFirstOrThrow({ where: { status: { in: ['POSTED', 'PARTIAL'] } } });
      await db.bill.update({ where: { id: bill.id }, data: { amountPaid: bill.total, status: 'PAID' } });
    });
    expect(failing(r)).toEqual(['payables']);
  });

  it('stock changed without a movement', async () => {
    const r = await withDamage(async db => {
      const eggs = await db.item.findUniqueOrThrow({ where: { sku: 'HEALTH-EGG' } });
      await db.item.update({ where: { id: eggs.id }, data: { qtyOnHand: num(eggs.qtyOnHand) - 30 } });
    });
    expect(failing(r)).toContain('stock_quantities');
    expect(r.checks.find(c => c.key === 'stock_quantities')!.examples[0]).toMatch(/HEALTH-EGG/);
  });

  it('stock value changed behind the ledger', async () => {
    const r = await withDamage(async db => {
      const feed = await db.item.findUniqueOrThrow({ where: { sku: 'HEALTH-FEED' } });
      await db.item.update({ where: { id: feed.id }, data: { avgCost: num(feed.avgCost) + 25 } });
    });
    expect(failing(r)).toEqual(['inventory_value']);
  });

  it('the rolled-back damage left the real books healthy', async () => {
    expect((await booksHealth(prisma)).ok).toBe(true);
  });
});

describe('known drift (R2): voiding a sale after the average cost changed', () => {
  // Runs last and uses its own product, so other tests' stock and costs are untouched.
  it('shows as stock-value drift only, not as tampering', async () => {
    const item = await call('POST', '/items', { sku: 'HEALTH-R2', name: 'Health check feed', category: 'FEED', unit: 'kg', ...(await ownAccounts()) });
    const supplier = await call('POST', '/parties', { kind: 'SUPPLIER', name: 'R2 Feeds' });
    const customer = await call('POST', '/parties', { kind: 'CUSTOMER', name: 'R2 Buyer' });
    await call('POST', '/bills', { date: day(), supplierId: supplier.id, lines: [{ itemId: item.id, quantity: 10, unitPrice: 40 }] });
    const sale = await call('POST', '/invoices', { date: day(), customerId: customer.id, lines: [{ itemId: item.id, quantity: 5, unitPrice: 60 }] });
    await call('POST', '/bills', { date: day(), supplierId: supplier.id, lines: [{ itemId: item.id, quantity: 10, unitPrice: 100 }] });
    await call('POST', `/invoices/${sale.id}/void`, { reason: 'checking the known average-cost drift' });
    const r = await booksHealth(prisma);
    expect(failing(r)).toEqual(['inventory_value']);
    expect(r.integrityOk).toBe(true);
  });
});

function num(v: unknown) { return Number(v ?? 0); }
