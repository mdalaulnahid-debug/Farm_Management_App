// Staff record a flock's day in more than one sitting: eggs in the morning, deaths and feed in the evening.
// The evening entry adds to the day (addToDay) instead of being refused, and the day's report adds them up
// without counting the flock's birds twice.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { ymd } from '../src/lib/dates.js';

let app: FastifyInstance;
let owner = '';
let flockId = '';
let feedId = '';
// A day of its own so other test files' production does not mix in.
const DAY = ymd(new Date(Date.now() - 20 * 86_400_000));

const call = async (method: string, url: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: { cookie: owner } });
  return { status: res.statusCode, body: res.json() as any };
};
const flock = () => prisma.flock.findUniqueOrThrow({ where: { id: flockId } });
const feed = () => prisma.item.findUniqueOrThrow({ where: { id: feedId } });

beforeAll(async () => {
  await seed({ adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.local', password: 'TestOwner2026' }, remoteAddress: '10.8.0.1' });
  owner = String(res.headers['set-cookie']).split(';')[0];
  flockId = (await call('POST', '/flocks', { code: 'SESS-A', name: 'Sessions flock', startDate: '2026-01-01', openingCount: 500 })).body.id;
  feedId = (await call('POST', '/items', { sku: 'SESS-FEED', name: 'Sessions feed', category: 'FEED', unit: 'kg', purchasePrice: 50 })).body.id;
  expect((await call('POST', '/stock-adjustments', { date: '2026-01-01', itemId: feedId, type: 'OPENING', quantity: 200, unitCost: 50 })).status).toBe(200);
});
afterAll(async () => app?.close());

describe('adding to the day’s production', () => {
  let eveningId = '';

  it('keeps one record per flock and day unless the entry says it adds to the day', async () => {
    expect((await call('POST', '/production', { date: DAY, flockId, eggsCollected: 420, eggsBroken: 5 })).status).toBe(200);
    const again = await call('POST', '/production', { date: DAY, flockId, eggsCollected: 0, mortality: 2 });
    expect(again.status).toBe(409);
  });

  it('adds the evening’s deaths and feed to the same day', async () => {
    const res = await call('POST', '/production', { date: DAY, flockId, eggsCollected: 0, mortality: 2, feedItemId: feedId, feedQty: 10, addToDay: true });
    expect(res.status).toBe(200);
    eveningId = res.body.id;
    expect((await flock()).currentCount).toBe(498);
    expect(Number((await feed()).qtyOnHand)).toBe(190);
    const logs = await prisma.productionLog.findMany({ where: { flockId, status: 'POSTED' } });
    expect(logs).toHaveLength(2);
  });

  it('reports the day as one: totals add up and the laying rate counts the flock once', async () => {
    const { body } = await call('GET', `/reports/production?from=${DAY}&to=${DAY}`);
    const day = body.days.find((d: any) => d.date === DAY);
    expect(day).toMatchObject({ eggs: 420, broken: 5, mortality: 2, feedQty: 10 });
    expect(day.birds).toBe(498);
    expect(day.layingRate).toBeCloseTo((420 / 498) * 100, 1);
  });

  it('voiding the evening entry gives back the birds and the feed', async () => {
    expect((await call('POST', `/production/${eveningId}/void`, { reason: 'Entered twice by mistake' })).status).toBe(200);
    expect((await flock()).currentCount).toBe(500);
    expect(Number((await feed()).qtyOnHand)).toBe(200);
  });
});
