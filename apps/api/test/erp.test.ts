import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneBackups } from '../src/services/backup.js';

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
    const cash = bs.currentAssets.lines.find((l: any) => l.code === '1010')?.amount ?? 0;
    const ar = bs.currentAssets.lines.find((l: any) => l.code === '1100').amount;
    expect(cash).toBe(15897);
    expect(ar).toBe(7072);
    expect(bs.balanced).toBe(true);
    const pl = (await call('GET', '/reports/profit-loss?from=2026-10-01&to=2026-10-31')).body;
    expect(pl.revenue).toBe(80618);
    expect(pl.totalExpenses).toBe(70719);
    expect(pl.operatingProfit).toBe(9899);
    expect(pl.otherIncome.lines.find((l: any) => l.code === '4510').amount).toBe(15000);
    expect(pl.netProfit).toBe(24899);
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

describe('customer by name + phone on the চালান', () => {
  it('adds a new buyer to the customer list, then recognises the same phone typed differently', async () => {
    const eggs = await prisma.item.findUniqueOrThrow({ where: { sku: 'EGG-DUCK' } });
    const first = await call('POST', '/invoices', { date: '2026-11-12', customer: { name: 'Karim Mia', phone: '01711-223344' }, lines: [{ itemId: eggs.id, quantity: 10, unitPrice: 16 }] });
    expect(first.status).toBe(200);
    expect(first.body.customer.name).toBe('Karim Mia');
    expect(first.body.customer.phone).toBe('01711223344');
    const lookup = await call('GET', `/parties/lookup?phone=${encodeURIComponent('+880 ১৭১১ ২২৩৩৪৪')}`);
    expect(lookup.body.match?.id).toBe(first.body.customer.id);
    const second = await call('POST', '/invoices', { date: '2026-11-12', customer: { name: 'Karim', phone: '8801711223344' }, lines: [{ itemId: eggs.id, quantity: 5, unitPrice: 16 }] });
    expect(second.body.customer.id).toBe(first.body.customer.id);
    expect(await prisma.party.count({ where: { name: { startsWith: 'Karim' } } })).toBe(1);
  });
  it('uses Walk-in customers when no name or phone is given', async () => {
    const eggs = await prisma.item.findUniqueOrThrow({ where: { sku: 'EGG-DUCK' } });
    const r = await call('POST', '/invoices', { date: '2026-11-12', customer: {}, lines: [{ itemId: eggs.id, quantity: 1, unitPrice: 16 }] });
    expect(r.body.customer.name).toBe('Walk-in customers');
  });
});

describe('stock: medicine usage and physical count', () => {
  it('buys vaccine into stock, expenses it when used, and posts a count difference', async () => {
    const vac = await prisma.item.findUniqueOrThrow({ where: { sku: 'VAC-PLAGUE' } });
    expect(vac.trackInventory && vac.valued).toBe(true);
    const bill = await call('POST', '/bills', { date: '2026-11-13', lines: [{ itemId: vac.id, quantity: 10, unitPrice: 120 }], paid: { amount: 1200, cashAccountId: await id('1010') } });
    expect(bill.status).toBe(200);
    const use = await call('POST', '/stock-adjustments', { date: '2026-11-14', itemId: vac.id, type: 'USAGE', quantity: 3 });
    expect(use.body.value).toBe(360);
    const pl = (await call('GET', '/reports/profit-loss?from=2026-11-14&to=2026-11-14')).body;
    expect(pl.operating.lines.find((l: any) => l.code === '6020').amount).toBe(360);
    const count = await call('POST', '/stock-adjustments', { date: '2026-11-15', itemId: vac.id, type: 'COUNT', quantity: 6 });
    expect(count.body.difference).toBe(-1);
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: vac.id } })).qtyOnHand)).toBe(6);
    const same = await call('POST', '/stock-adjustments', { date: '2026-11-15', itemId: vac.id, type: 'COUNT', quantity: 6 });
    expect(same.body.difference).toBe(0);
  });
});

describe('grants and side projects', () => {
  it('records a grant from a person as grant income and adds the donor to contacts', async () => {
    const r = await call('POST', '/grants', { date: '2026-11-16', donor: { name: 'Abdul Karim', phone: '01811-000111' }, amount: 5000, cashAccountId: await id('1010') });
    expect(r.status).toBe(200);
    expect(r.body.party.kind).toBe('DONOR');
    const again = await call('POST', '/grants', { date: '2026-11-17', donor: { name: 'A. Karim', phone: '+8801811000111' }, amount: 1000, cashAccountId: await id('1010') });
    expect(again.body.party.id).toBe(r.body.party.id);
    const pl = (await call('GET', '/reports/profit-loss?from=2026-11-16&to=2026-11-17')).body;
    expect(pl.otherIncome.lines.find((l: any) => l.code === '4510').amount).toBe(6000);
    expect(pl.revenue).toBe(0);
    expect((await call('GET', '/grants')).body.total).toBe(21000);
  });

  it('moves money to a side project without touching the duck farm profit', async () => {
    const projects = (await call('GET', '/projects')).body.data;
    const duck = projects.find((p: any) => p.code === 'DUCK');
    const cow = projects.find((p: any) => p.code === 'COW');
    expect(duck.isMain).toBe(true);
    const out = await call('POST', '/project-transfers', { date: '2026-11-18', projectId: cow.id, direction: 'OUT', cashAccountId: await id('1010'), amount: 8000 });
    expect(out.status).toBe(200);
    await call('POST', '/project-transfers', { date: '2026-11-20', projectId: cow.id, direction: 'IN', cashAccountId: await id('1010'), amount: 3000 });
    const summary = (await call('GET', '/projects/summary')).body.data;
    expect(summary.find((p: any) => p.code === 'COW')).toMatchObject({ sent: 8000, returned: 3000, held: 5000 });
    const plDuck = (await call('GET', `/reports/profit-loss?from=2026-11-18&to=2026-11-20&projectId=${duck.id}`)).body;
    expect(plDuck.totalExpenses).toBe(0);
    const bs = (await call('GET', '/reports/balance-sheet?asOf=2026-11-30')).body;
    expect(bs.currentAssets.lines.find((l: any) => l.code === '1400').amount).toBe(5000);
    expect(bs.balanced).toBe(true);
    expect((await call('POST', '/project-transfers', { date: '2026-11-18', projectId: duck.id, direction: 'OUT', cashAccountId: await id('1010'), amount: 1 })).status).toBe(400);
  });

  it('can void a side-project transfer', async () => {
    const list = (await call('GET', '/project-transfers')).body.data;
    expect(list).toHaveLength(2);
    expect((await call('POST', `/journals/${list[0].id}/void`, { reason: 'entered by mistake' })).status).toBe(200);
    const summary = (await call('GET', '/projects/summary')).body.data;
    expect(summary.find((p: any) => p.code === 'COW').held).toBe(8000);
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

describe('workbook backlog import', () => {
  const file = async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../../upload/', import.meta.url);
    const name = readdirSync(dir).find(f => f.endsWith('.xlsx'))!;
    return { fileName: name, fileBase64: readFileSync(new URL(name, dir)).toString('base64') };
  };
  const octCash = async () => (await call('GET', '/reports/balance-sheet?asOf=2026-10-31')).body.currentAssets.lines.find((l: any) => l.code === '1010')?.amount ?? 0;

  it('previews the workbook and reconciles closing cash with the sheet', async () => {
    const r = await call('POST', '/import/workbook/preview', await file());
    expect(r.status).toBe(200);
    expect(r.body.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r.body.rows).toHaveLength(5);
    expect(r.body.totals.closingCash).toBe(15897);
    expect(r.body.totals.cashMatches).toBe(true);
    expect(r.body.totals.netSales).toBe(80618);
    expect(r.body.hasExisting).toBe(true);
    expect(r.body.errors).toEqual([]);
  });

  it('refuses to import over existing records unless replacing is confirmed', async () => {
    expect((await call('POST', '/import/workbook', await file())).status).toBe(400);
  });

  it('replaces the period without double counting, and can be undone', async () => {
    const r = await call('POST', '/import/workbook', { ...(await file()), replaceExisting: true });
    expect(r.status).toBe(200);
    expect(await octCash()).toBe(15897);
    const pl = (await call('GET', '/reports/profit-loss?from=2026-10-01&to=2026-10-31')).body;
    expect(pl.revenue).toBe(80618);
    expect(pl.operatingProfit).toBe(9899);
    expect(pl.otherIncome.lines.find((l: any) => l.code === '4510').amount).toBe(15000);
    expect(pl.netProfit).toBe(24899);

    const batches = (await call('GET', '/import/batches')).body.data;
    const live = batches.filter((b: any) => b.status === 'POSTED');
    expect(live).toHaveLength(1);
    expect((await call('POST', `/import/batches/${live[0].id}/undo`, { reason: 'testing undo' })).status).toBe(200);
    expect(await octCash()).toBe(0);
    expect((await call('GET', '/reports/trial-balance?asOf=2026-12-31')).body.balanced).toBe(true);
  });
});

describe('automatic backups', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'farmledger-test-backups-'));
    process.env.BACKUP_DIR = dir;
  });
  afterAll(() => {
    delete process.env.BACKUP_DIR;
    rmSync(dir, { recursive: true, force: true });
  });
  const download = async (name: string, c = cookie) => app.inject({ method: 'GET', url: `/api/v1/admin/backups/${name}`, headers: { cookie: c } });

  it('takes a manual backup that is a real SQLite database and lists it', async () => {
    const res = await call('POST', '/admin/backups');
    expect(res.status).toBe(200);
    expect(res.body.name).toMatch(/^farmledger-\d{4}-\d{2}-\d{2}-\d{4}\.db$/);
    expect(res.body.size).toBeGreaterThan(0);
    const bytes = readFileSync(join(dir, res.body.name));
    expect(bytes.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\u0000');
    expect(readdirSync(dir).filter(n => n.startsWith('.tmp-'))).toEqual([]);
    const list = await call('GET', '/admin/backups');
    expect(list.status).toBe(200);
    expect(list.body.dir).toBe(dir);
    expect(list.body.keepDays).toBe(30);
    expect(list.body.copyDir).toBeNull();
    expect(list.body.data[0]).toMatchObject({ name: res.body.name, size: res.body.size });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'backup', entityId: res.body.name } });
    expect(audit).not.toBeNull();
  });

  it('downloads a backup by name and refuses bad or unknown names', async () => {
    const name = (await call('GET', '/admin/backups')).body.data[0].name;
    const ok = await download(name);
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.length).toBe(readFileSync(join(dir, name)).length);
    expect(ok.rawPayload.subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
    expect((await download('..%2Fx.db')).statusCode).toBe(400);
    expect((await download('..%2F..%2Ffarmledger-2026-01-01-0000.db')).statusCode).toBe(400);
    expect((await download('foo.db')).statusCode).toBe(400);
    expect((await download('farmledger-1999-01-01-0000.db')).statusCode).toBe(404);
    // The old one-click download still works.
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/backup', headers: { cookie } })).statusCode).toBe(200);
  });

  it('is limited to users who manage settings', async () => {
    const roles = (await call('GET', '/roles')).body.data;
    const viewer = roles.find((r: any) => r.key === 'viewer');
    expect((await call('POST', '/users', { name: 'Backup Viewer', email: 'backup-viewer@test.local', roleId: viewer.id, password: 'Viewer2026x' })).status).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'backup-viewer@test.local', password: 'Viewer2026x' } });
    const viewerCookie = String(login.headers['set-cookie']).split(';')[0];
    const name = (await call('GET', '/admin/backups')).body.data[0].name;
    expect((await call('GET', '/admin/backups', undefined, viewerCookie)).status).toBe(403);
    expect((await call('POST', '/admin/backups', undefined, viewerCookie)).status).toBe(403);
    expect((await download(name, viewerCookie)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/backup', headers: { cookie: viewerCookie } })).statusCode).toBe(403);
  });

  it('prunes old backups but keeps the newest 7 and files it does not own', async () => {
    const recent = (await call('GET', '/admin/backups')).body.data.map((b: any) => b.name);
    for (let d = 1; d <= 10; d++) writeFileSync(join(dir, `farmledger-2020-01-${String(d).padStart(2, '0')}-0900.db`), 'old');
    writeFileSync(join(dir, 'notes.txt'), 'keep me');
    writeFileSync(join(dir, 'farmledger-old.db'), 'keep me too');
    const deleted = pruneBackups();
    expect(deleted).toContain('farmledger-2020-01-01-0900.db');
    expect(existsSync(join(dir, 'farmledger-2020-01-01-0900.db'))).toBe(false);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
    expect(existsSync(join(dir, 'farmledger-old.db'))).toBe(true);
    const left = (await call('GET', '/admin/backups')).body.data.map((b: any) => b.name);
    expect(left.length).toBe(7);
    for (const n of recent) expect(left).toContain(n);
  });
});
