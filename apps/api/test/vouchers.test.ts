// The owner's rule: no spending without the real voucher, and the voucher must match the entry.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { uniquePhoto } from './helpers/voucher.js';
import { ensureWalkInKey } from '../src/services/sales.js';

let app: FastifyInstance;
let owner = '';
let viewer = '';
let manager = '';
let accountant = '';
const PASSWORD = 'TestOwner2026';
const DAY = '2027-09-10';
let device = 0;
const send = (method: string, url: string, cookie: string, payload?: unknown) =>
  app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: { cookie } });
const acc = async (code: string) => (await prisma.account.findUniqueOrThrow({ where: { code } })).id;
const signIn = async (email: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress: `10.8.0.${++device}` });
  return String(res.headers['set-cookie']).split(';')[0];
};
const voucher = (amount: number, extra: object = {}) => ({ number: 'V-77', date: DAY, amount, photos: [uniquePhoto()], ...extra });
const expense = async (amount: number, v?: unknown) => send('POST', '/bills', owner, {
  date: DAY, lines: [{ description: 'Rickshaw fare to the feed market', quantity: 1, unitPrice: amount, accountId: await acc('6090') }],
  paid: { amount, cashAccountId: await acc('1010') }, ...(v === undefined ? {} : { voucher: v }),
});

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  owner = await signIn('owner@test.local', PASSWORD);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'viewer' } });
  expect((await send('POST', '/users', owner, { name: 'Voucher Viewer', email: 'v-viewer@test.local', roleId: role.id, password: 'ViewTemp2026' })).statusCode).toBe(200);
  const first = await signIn('v-viewer@test.local', 'ViewTemp2026');
  expect((await send('POST', '/auth/change-password', first, { current: 'ViewTemp2026', next: 'ViewOwn2026x' })).statusCode).toBe(200);
  viewer = first;
  for (const [key, email] of [['manager', 'v-manager@test.local'], ['accountant', 'v-accountant@test.local']] as const) {
    const r = await prisma.role.findUniqueOrThrow({ where: { key } });
    expect((await send('POST', '/users', owner, { name: `Voucher ${key}`, email, roleId: r.id, password: 'RoleTemp2026' })).statusCode).toBe(200);
    const c = await signIn(email, 'RoleTemp2026');
    expect((await send('POST', '/auth/change-password', c, { current: 'RoleTemp2026', next: 'RoleOwn2026x' })).statusCode).toBe(200);
    if (key === 'manager') manager = c; else accountant = c;
  }
});
afterAll(async () => { await app?.close(); });

describe('no spending without a matching voucher', () => {
  it('refuses an expense without a voucher, and nothing is posted', async () => {
    const before = await prisma.bill.count();
    const res = await expense(55);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/voucher/i);
    expect((await expense(55, { number: null, date: DAY, amount: 55, photos: [] })).statusCode).toBe(400);
    expect(await prisma.bill.count()).toBe(before);
  });

  it('refuses when the voucher amount differs from the entry, and nothing is posted', async () => {
    const bills = await prisma.bill.count();
    const entries = await prisma.journalEntry.count();
    const res = await expense(55, voucher(50));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/does not match|must match|so they match/i);
    expect(await prisma.bill.count()).toBe(bills);
    expect(await prisma.journalEntry.count()).toBe(entries);
  });

  it('saves the expense with its voucher and photo when they match', async () => {
    const res = await expense(55, voucher(55));
    expect(res.statusCode).toBe(200);
    const bill = res.json();
    const v = await prisma.voucher.findUniqueOrThrow({ where: { ownerType_ownerId: { ownerType: 'BILL', ownerId: bill.id } } });
    expect(Number(v.amount)).toBe(55);
    expect(v.status).toBe('UNCHECKED');
    expect(await prisma.attachment.count({ where: { ownerType: 'BILL', ownerId: bill.id } })).toBe(1);
  });

  it('a payment out needs a voucher too; money in and transfers between own accounts do not', async () => {
    const out = { direction: 'OUT', date: DAY, cashAccountId: await acc('1010'), counterAccountId: await acc('6090'), amount: 30, notes: 'Tea for workers' };
    expect((await send('POST', '/payments', owner, out)).statusCode).toBe(400);
    expect((await send('POST', '/payments', owner, { ...out, voucher: voucher(31) })).statusCode).toBe(400);
    expect((await send('POST', '/payments', owner, { ...out, voucher: voucher(30) })).statusCode).toBe(200);
    expect((await send('POST', '/payments', owner, { direction: 'IN', date: DAY, cashAccountId: await acc('1010'), counterAccountId: await acc('4500'), amount: 500 })).statusCode).toBe(200);
    const bank = (await prisma.account.findFirstOrThrow({ where: { subtype: 'BANK' } })).id;
    expect((await send('POST', '/transfers', owner, { date: DAY, fromAccountId: await acc('1010'), toAccountId: bank, amount: 10 })).statusCode).toBe(200);
  });
});

describe('checking vouchers', () => {
  it('lists unchecked vouchers with the entry and photos, and counts them for the dashboard', async () => {
    const list = (await send('GET', '/vouchers', owner)).json().data;
    const mine = list.find((v: any) => v.number === 'V-77' && v.entry.kind === 'bill');
    expect(mine.entry.total).toBe(55);
    expect(mine.photos).toHaveLength(1);
    expect((await send('GET', '/vouchers/summary', owner)).json().unchecked).toBeGreaterThanOrEqual(2);
  });

  it('a viewer cannot see or check vouchers', async () => {
    expect((await send('GET', '/vouchers', viewer)).statusCode).toBe(403);
    const v = await prisma.voucher.findFirstOrThrow({ where: { number: 'V-77' } });
    expect((await send('POST', `/vouchers/${v.id}/check`, viewer, { result: 'MATCHES' })).statusCode).toBe(403);
  });

  it('records who checked and when, and locks the photos once checked', async () => {
    const v = await prisma.voucher.findFirstOrThrow({ where: { number: 'V-77', ownerType: 'BILL' } });
    expect((await send('POST', `/vouchers/${v.id}/check`, owner, { result: 'MISMATCH' })).statusCode).toBe(400); // needs a note
    expect((await send('POST', `/vouchers/${v.id}/check`, owner, { result: 'MATCHES' })).statusCode).toBe(200);
    const checked = await prisma.voucher.findUniqueOrThrow({ where: { id: v.id } });
    expect(checked.status).toBe('MATCHES');
    expect(checked.checkedById).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entity: 'voucher', entityId: v.ownerId, summary: { contains: 'matches' } } })).toBe(1);
    const photo = await prisma.attachment.findFirstOrThrow({ where: { ownerType: 'BILL', ownerId: v.ownerId } });
    expect((await send('DELETE', `/bills/${v.ownerId}/attachments/${photo.id}`, owner)).statusCode).toBe(400);
    expect((await send('POST', `/bills/${v.ownerId}/attachments`, owner, { dataUrl: uniquePhoto() })).statusCode).toBe(400);
  });

  it('the last photo of an unchecked voucher cannot be removed (the proof would be gone)', async () => {
    const v = await prisma.voucher.findFirstOrThrow({ where: { ownerType: 'PAYMENT', status: 'UNCHECKED', amount: 30 } });
    const photo = await prisma.attachment.findFirstOrThrow({ where: { ownerType: 'PAYMENT', ownerId: v.ownerId } });
    expect((await send('DELETE', `/payments/${v.ownerId}/attachments/${photo.id}`, owner)).statusCode).toBe(400);
  });

  it('flags a voucher that does not match, with the reason', async () => {
    const v = await prisma.voucher.findFirstOrThrow({ where: { ownerType: 'PAYMENT', status: 'UNCHECKED', amount: 30 } });
    expect((await send('POST', `/vouchers/${v.id}/check`, owner, { result: 'MISMATCH', note: 'Paper says 20 taka' })).statusCode).toBe(200);
    const flagged = (await send('GET', '/vouchers?status=MISMATCH', owner)).json().data;
    expect(flagged.map((x: any) => x.id)).toContain(v.id);
    expect((await send('GET', '/vouchers/summary', owner)).json().mismatched).toBeGreaterThanOrEqual(1);
  });
});

describe('round 2: every way money leaves the farm', () => {
  it('a journal paying money out needs a voucher; moves between own accounts and non-cash entries do not', async () => {
    const out = { date: DAY, memo: 'Paid the electrician', lines: [{ accountId: await acc('6090'), debit: 400 }, { accountId: await acc('1010'), credit: 400 }] };
    expect((await send('POST', '/journals', owner, out)).statusCode).toBe(400);
    expect((await send('POST', '/journals', owner, { ...out, voucher: voucher(400, { number: 'J-1', photos: [uniquePhoto()] }) })).statusCode).toBe(200);
    const bank = (await prisma.account.findFirstOrThrow({ where: { subtype: 'BANK' } })).id;
    expect((await send('POST', '/journals', owner, { date: DAY, memo: 'Cash deposited to bank', lines: [{ accountId: bank, debit: 100 }, { accountId: await acc('1010'), credit: 100 }] })).statusCode).toBe(200);
    expect((await send('POST', '/journals', owner, { date: DAY, memo: 'Reclassify an expense', lines: [{ accountId: await acc('6090'), debit: 50 }, { accountId: await acc('6010'), credit: 50 }] })).statusCode).toBe(200);
  });

  it('money sent to a side project needs a voucher; money coming back does not', async () => {
    // Its own side project, so other tests' project totals are untouched.
    const side = (await send('POST', '/projects', owner, { code: 'VCHTEST', name: 'Voucher test project', kind: 'OTHER' })).json();
    const out = { date: DAY, projectId: side.id, direction: 'OUT', cashAccountId: await acc('1010'), amount: 700 };
    expect((await send('POST', '/project-transfers', owner, out)).statusCode).toBe(400);
    expect((await send('POST', '/project-transfers', owner, { ...out, voucher: voucher(700, { number: 'P-1', photos: [uniquePhoto()] }) })).statusCode).toBe(200);
    expect((await send('POST', '/project-transfers', owner, { ...out, direction: 'IN', amount: 200 })).statusCode).toBe(200);
  });

  it('a cash shortage is written off by the owner only, with a reason', async () => {
    // Other test files share this database, so first make sure the book shows cash to be short of.
    expect((await send('POST', '/payments', owner, { direction: 'IN', date: DAY, cashAccountId: await acc('1010'), counterAccountId: await acc('4500'), amount: 100000 })).statusCode).toBe(200);
    const count = { date: DAY, accountId: await acc('1010'), counted: 0, postVariance: true };
    expect((await send('POST', '/cash-counts', manager, { ...count, notes: 'Short' })).statusCode).toBe(403);
    expect((await send('POST', '/cash-counts', owner, count)).statusCode).toBe(400);
    expect((await send('POST', '/cash-counts', owner, { ...count, notes: 'Money missing from the box, being looked into' })).statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { entity: 'cash_count', summary: { contains: 'written off by the owner: Money missing from the box' } } })).toBe(1);
    // Counting without writing anything off is still for managers.
    expect((await send('POST', '/cash-counts', manager, { ...count, postVariance: false })).statusCode).toBe(200);
  });
});

describe('round 2: one voucher, one entry', () => {
  const supplierBill = async (supplierId: string, amount: number, v: unknown, paid = true) => send('POST', '/bills', owner, {
    date: DAY, supplierId, lines: [{ description: 'Feed bags', quantity: 1, unitPrice: amount, accountId: await acc('6090') }], paid: paid ? { amount, cashAccountId: await acc('1010') } : null, voucher: v,
  });
  it('refuses the same photo or the same number from the same supplier twice; a void entry frees them', async () => {
    const a = (await send('POST', '/parties', owner, { kind: 'SUPPLIER', name: 'Voucher Feeds A' })).json();
    const b = (await send('POST', '/parties', owner, { kind: 'SUPPLIER', name: 'Voucher Feeds B' })).json();
    const photo = uniquePhoto();
    const first = await supplierBill(a.id, 90, voucher(90, { number: '501', photos: [photo] }), false); // on credit, so it can be voided
    expect(first.statusCode).toBe(200);
    expect((await supplierBill(b.id, 90, voucher(90, { number: '777', photos: [photo] }))).json().message).toMatch(/already used/);
    expect((await supplierBill(a.id, 90, voucher(90, { number: '501', photos: [uniquePhoto()] }))).json().message).toMatch(/already entered/);
    expect((await supplierBill(b.id, 90, voucher(90, { number: '501', photos: [uniquePhoto()] }))).statusCode).toBe(200); // another supplier's 501
    expect((await send('POST', `/bills/${first.json().id}/void`, owner, { reason: 'entered against the wrong supplier' })).statusCode).toBe(200);
    expect((await supplierBill(a.id, 90, voucher(90, { number: '501', photos: [photo] }))).statusCode).toBe(200);
  });

  it('the voucher date must be the entry date or a few days before, never after', async () => {
    expect((await expense(20, voucher(20, { date: '2027-09-11', photos: [uniquePhoto()] }))).json().message).toMatch(/after the entry/);
    expect((await expense(20, voucher(20, { date: '2027-07-01', photos: [uniquePhoto()] }))).json().message).toMatch(/older than the entry/);
    expect((await expense(20, voucher(20, { date: '2027-09-05', number: null, photos: [uniquePhoto()] }))).statusCode).toBe(200);
  });

  it('refuses someone not signed in before reading a large upload', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/bills', payload: { blob: 'x'.repeat(3 * 1024 * 1024) } });
    expect(res.statusCode).toBe(401);
  });
});

describe('round 2: checking is done by someone else', () => {
  it('nobody checks their own voucher (except the owner); only the owner changes a verdict', async () => {
    const made = await send('POST', '/payments', accountant, { direction: 'OUT', date: DAY, cashAccountId: await acc('1010'), counterAccountId: await acc('6090'), amount: 15, notes: 'Stamps', voucher: voucher(15, { number: null, photos: [uniquePhoto()] }) });
    expect(made.statusCode).toBe(200);
    const v = await prisma.voucher.findUniqueOrThrow({ where: { ownerType_ownerId: { ownerType: 'PAYMENT', ownerId: made.json().id } } });
    expect((await send('POST', `/vouchers/${v.id}/check`, accountant, { result: 'MATCHES' })).statusCode).toBe(403);
    expect((await send('POST', `/vouchers/${v.id}/check`, owner, { result: 'MATCHES' })).statusCode).toBe(200);
    const other = await prisma.voucher.findFirstOrThrow({ where: { status: 'UNCHECKED', NOT: { createdById: (await prisma.user.findUniqueOrThrow({ where: { email: 'v-accountant@test.local' } })).id } } });
    expect((await send('POST', `/vouchers/${other.id}/check`, accountant, { result: 'MATCHES' })).statusCode).toBe(200);
    expect((await send('POST', `/vouchers/${other.id}/check`, accountant, { result: 'MISMATCH', note: 'changed my mind' })).statusCode).toBe(403);
    expect((await send('POST', `/vouchers/${other.id}/check`, owner, { result: 'MISMATCH', note: 'Paper shows a different shop' })).statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { entity: 'voucher', entityId: other.ownerId, summary: { contains: 're-checked by the owner' } } })).toBe(1);
  });

  it('only the owner or a checker may remove an original voucher photo; the check page still shows it', async () => {
    const res = await expense(33, voucher(33, { number: 'R-9', photos: [uniquePhoto()] }));
    const billId = res.json().id;
    const original = await prisma.attachment.findFirstOrThrow({ where: { ownerType: 'BILL', ownerId: billId, isVoucher: true } });
    expect((await send('POST', `/bills/${billId}/attachments`, owner, { dataUrl: uniquePhoto() })).statusCode).toBe(200);
    expect((await send('DELETE', `/bills/${billId}/attachments/${original.id}`, manager)).statusCode).toBe(403);
    expect((await send('DELETE', `/bills/${billId}/attachments/${original.id}`, owner)).statusCode).toBe(200);
    const row = (await send('GET', '/vouchers', owner)).json().data.find((v: any) => v.ownerId === billId);
    expect(row.removedPhotos.map((p: any) => p.id)).toContain(original.id);
    expect((await send('GET', `/vouchers/${row.id}/photos/${original.id}`, owner)).statusCode).toBe(200);
  });
});

describe('round 2: imports stop at the go-live date', () => {
  it('refuses a past-records workbook that reaches the go-live date', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../../upload/', import.meta.url);
    const name = readdirSync(dir).find(f => f.endsWith('.xlsx'))!;
    const file = { fileName: name, fileBase64: readFileSync(new URL(name, dir)).toString('base64') };
    await prisma.organization.update({ where: { id: 'org' }, data: { voucherRuleFrom: new Date('2026-10-20T00:00:00Z') } });
    try {
      const preview = (await send('POST', '/import/workbook/preview', owner, file)).json();
      expect(preview.errors.join(' ')).toMatch(/cannot be imported as past records/);
      expect((await send('POST', '/import/workbook', owner, { ...file, replaceExisting: true })).statusCode).toBe(400);
    } finally {
      await prisma.organization.update({ where: { id: 'org' }, data: { voucherRuleFrom: null } });
    }
  });
});

describe('round 2: the walk-in customer is marked once, never guessed', () => {
  it('marks a single untagged "Walk-in customers", and refuses to guess between two', async () => {
    const warn: string[] = [];
    const log = { warn: (m: string) => warn.push(m) };
    expect(await ensureWalkInKey(prisma, log)).toBe('ok');
    const walkIn = await prisma.party.findFirstOrThrow({ where: { systemKey: 'WALK_IN' } });
    await prisma.party.update({ where: { id: walkIn.id }, data: { systemKey: null } });
    try {
      expect(await ensureWalkInKey(prisma, log)).toBe('tagged');
      await prisma.party.update({ where: { id: walkIn.id }, data: { systemKey: null } });
      const twin = await prisma.party.create({ data: { kind: 'CUSTOMER', name: 'Walk-in customers' } });
      expect(await ensureWalkInKey(prisma, log)).toBe('ambiguous');
      expect(warn.join()).toMatch(/2 customers are named/);
      await prisma.party.delete({ where: { id: twin.id } });
    } finally {
      await prisma.party.update({ where: { id: walkIn.id }, data: { systemKey: 'WALK_IN' } });
    }
  });
});
