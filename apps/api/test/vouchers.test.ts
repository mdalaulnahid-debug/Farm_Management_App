// The owner's rule: no spending without the real voucher, and the voucher must match the entry.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { testVoucherPhoto } from './helpers/voucher.js';

let app: FastifyInstance;
let owner = '';
let viewer = '';
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
const voucher = (amount: number, extra: object = {}) => ({ number: 'V-77', date: DAY, amount, photos: [testVoucherPhoto], ...extra });
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
    expect((await send('POST', `/bills/${v.ownerId}/attachments`, owner, { dataUrl: testVoucherPhoto })).statusCode).toBe(400);
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
