// Unusual sign-ins in the owner's activity report: a new address (not someone's first sign-in),
// sign-ins at night, and a sign-in right after several wrong passwords.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { isQuietHour } from '../src/services/activity.js';

let app: FastifyInstance;
let ownerCookie = '';
const PASSWORD = 'TestOwner2026';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const login = (email: string, password: string, remoteAddress: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress });
const report = async () => (await app.inject({ method: 'GET', url: `/api/v1/reports/activity?from=${day(-1)}&to=${day(1)}`, headers: { cookie: ownerCookie } })).json() as any;
const rowsFor = async (email: string) => (await report()).signIns.filter((s: any) => s.email === email);

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  const res = await login('owner@test.local', PASSWORD, '10.50.0.1');
  ownerCookie = String(res.headers['set-cookie']).split(';')[0];
  const viewer = await prisma.role.findUniqueOrThrow({ where: { key: 'viewer' } });
  for (const email of ['alerts-a@test.local', 'alerts-b@test.local']) {
    await app.inject({ method: 'POST', url: '/api/v1/users', headers: { cookie: ownerCookie }, payload: { name: 'Alert Staff', email, roleId: viewer.id, password: 'AlertPass2026' } });
  }
});
afterAll(async () => app?.close());

describe('unusual sign-ins', () => {
  it('a first ever sign-in is not listed as a new address', async () => {
    expect((await login('alerts-a@test.local', 'AlertPass2026', '10.60.0.1')).statusCode).toBe(200);
    expect((await rowsFor('alerts-a@test.local')).some((s: any) => s.reasons.includes('new_address'))).toBe(false);
  });

  it('signing in again from the usual address is not listed as new', async () => {
    expect((await login('alerts-a@test.local', 'AlertPass2026', '10.60.0.1')).statusCode).toBe(200);
    expect((await rowsFor('alerts-a@test.local')).some((s: any) => s.reasons.includes('new_address'))).toBe(false);
  });

  it('a sign-in from a different address is listed as new', async () => {
    expect((await login('alerts-a@test.local', 'AlertPass2026', '172.16.9.9')).statusCode).toBe(200);
    const row = (await rowsFor('alerts-a@test.local')).find((s: any) => s.ip === '172.16.9.9');
    expect(row.reasons).toContain('new_address');
  });

  it('a sign-in straight after three wrong passwords is listed', async () => {
    for (let i = 0; i < 3; i++) expect((await login('alerts-b@test.local', 'wrong-pass-123', '10.70.0.1')).statusCode).toBe(401);
    expect((await login('alerts-b@test.local', 'AlertPass2026', '10.70.0.1')).statusCode).toBe(200);
    const row = (await rowsFor('alerts-b@test.local')).find((s: any) => s.reasons.includes('after_failures'));
    expect(row.failures).toBe(3);
  });

  it('night means 10 pm to 6 am on the farm computer’s clock', () => {
    const at = (h: number) => { const d = new Date(); d.setHours(h, 30, 0, 0); return d; };
    expect([at(23), at(2), at(5)].every(isQuietHour)).toBe(true);
    expect([at(6), at(12), at(21)].some(isQuietHour)).toBe(false);
  });

  it('the report counts them', async () => {
    const r = await report();
    expect(r.counts.unusualSignIns).toBe(r.signIns.length);
    expect(r.counts.unusualSignIns).toBeGreaterThanOrEqual(2);
  });
});
