// Slip photos: a photo of the handwritten voucher or receipt kept with a payment or bill as proof.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { withVoucher } from './helpers/voucher.js';

let app: FastifyInstance;
let cookie = '';
const PASSWORD = 'TestOwner2026';
const req = async (method: string, url: string, payload?: unknown) =>
  app.inject({ method: method as any, url: `/api/v1${url}`, payload: (await withVoucher(method, url, payload)) as any, headers: { cookie } });
const ok = async (method: string, url: string, payload?: unknown) => {
  const res = await req(method, url, payload);
  if (res.statusCode !== 200) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json() as any;
};
const acc = async (code: string) => (await prisma.account.findUniqueOrThrow({ where: { code } })).id;
// The first bytes are what make a file a JPEG / PNG; the rest is filler for the test.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 3)]);
const url = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`;
let paymentId = '';
let billId = '';

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.local', password: PASSWORD } });
  cookie = String(res.headers['set-cookie']).split(';')[0];
  const supplier = await ok('POST', '/parties', { kind: 'SUPPLIER', name: 'Slip Photo Feeds' });
  paymentId = (await ok('POST', '/payments', { direction: 'OUT', date: '2027-08-02', cashAccountId: await acc('1010'), counterAccountId: await acc('6090'), amount: 35, notes: 'Rickshaw fare, handwritten slip' })).id;
  billId = (await ok('POST', '/bills', { date: '2027-08-02', supplierId: supplier.id, lines: [{ description: 'Feed delivery', quantity: 1, unitPrice: 120, accountId: await acc('6090') }] })).id;
});
afterAll(async () => { await app.close(); });

describe('slip photos', () => {
  it('keeps a photo with a payment and shows it back exactly', async () => {
    const a = await ok('POST', `/payments/${paymentId}/attachments`, { dataUrl: url('image/jpeg', jpeg) });
    expect(a).toMatchObject({ mime: 'image/jpeg', size: jpeg.length });
    expect(a.data).toBeUndefined();
    const slip = await ok('GET', `/payments/${paymentId}`);
    // The payment already has its voucher photo (saved with it); this one is added after.
    expect(slip.attachments.map((x: any) => x.id)).toContain(a.id);
    expect(slip.attachments).toHaveLength(2);
    const img = await req('GET', `/payments/${paymentId}/attachments/${a.id}`);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.rawPayload.equals(jpeg)).toBe(true);
    const log = await prisma.auditLog.findFirst({ where: { action: 'ATTACH', entityId: paymentId } });
    expect(log?.summary).toMatch(/Photo added/);
    expect(JSON.parse(log!.data!).sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(img.headers['cache-control']).toContain('no-store');
  });

  it('keeps a photo with a bill, and a photo is only reachable through its own record', async () => {
    const a = await ok('POST', `/bills/${billId}/attachments`, { dataUrl: url('image/png', png) });
    expect((await ok('GET', `/bills/${billId}`)).attachments).toHaveLength(2); // its voucher photo + this one
    expect((await req('GET', `/payments/${paymentId}/attachments/${a.id}`)).statusCode).toBe(404);
    expect((await req('GET', `/bills/${billId}/attachments/${a.id}`)).statusCode).toBe(200);
  });

  it('refuses files that are not photos, mislabelled photos, oversized photos and unknown records', async () => {
    expect((await req('POST', `/payments/${paymentId}/attachments`, { dataUrl: url('image/png', jpeg) })).statusCode).toBe(400);
    expect((await req('POST', `/payments/${paymentId}/attachments`, { dataUrl: `data:text/html;base64,${Buffer.from('<script>').toString('base64')}` })).statusCode).toBe(400);
    expect((await req('POST', `/payments/${paymentId}/attachments`, { dataUrl: url('image/jpeg', Buffer.from('not really a jpeg')) })).statusCode).toBe(400);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1.5 * 1024 * 1024 + 10)]);
    expect((await req('POST', `/payments/${paymentId}/attachments`, { dataUrl: url('image/jpeg', big) })).statusCode).toBe(400);
    expect((await req('POST', '/payments/nope/attachments', { dataUrl: url('image/jpeg', jpeg) })).statusCode).toBe(404);
  });

  it('a removed photo is hidden but kept as evidence, with who removed it', async () => {
    const a = await ok('POST', `/payments/${paymentId}/attachments`, { dataUrl: url('image/jpeg', jpeg) });
    await ok('DELETE', `/payments/${paymentId}/attachments/${a.id}`);
    expect((await req('GET', `/payments/${paymentId}/attachments/${a.id}`)).statusCode).toBe(404);
    expect((await ok('GET', `/payments/${paymentId}`)).attachments.map((x: any) => x.id)).not.toContain(a.id);
    const kept = await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(kept.removedAt).not.toBeNull();
    expect(kept.removedById).not.toBeNull();
    expect(Buffer.from(kept.data).equals(jpeg)).toBe(true);
    const log = await prisma.auditLog.findFirst({ where: { action: 'DETACH', entityId: paymentId } });
    expect(JSON.parse(log!.data!).sha256).toBe(kept.sha256);
  });

  it('refuses photos on a void record', async () => {
    const pay = await ok('POST', '/payments', { direction: 'OUT', date: '2027-08-03', cashAccountId: await acc('1010'), counterAccountId: await acc('6090'), amount: 12, notes: 'Entered twice' });
    await ok('POST', `/payments/${pay.id}/void`, { reason: 'entered twice by mistake' });
    expect((await req('POST', `/payments/${pay.id}/attachments`, { dataUrl: url('image/jpeg', jpeg) })).statusCode).toBe(400);
  });

  it('limits how many photos one person can send per minute', async () => {
    let refused = 0;
    // Every photo counts: the voucher photo a payment out is saved with, and photos added afterwards.
    for (let i = 0; i < 25 && !refused; i++) {
      const made = await req('POST', '/payments', { direction: 'OUT', date: '2027-08-04', cashAccountId: await acc('1010'), counterAccountId: await acc('6090'), amount: 1, notes: `Rate ${i}` });
      if (made.statusCode === 400 && /Too many/.test(made.body)) { refused = i + 1; break; }
      const res = await req('POST', `/payments/${made.json().id}/attachments`, { dataUrl: url('image/jpeg', Buffer.concat([jpeg, Buffer.from([i])])) });
      if (res.statusCode === 400 && /Too many/.test(res.body)) refused = i + 1;
    }
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThanOrEqual(11); // 2 photos per round, 20 per minute
  });
});
