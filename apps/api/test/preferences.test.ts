// Display settings follow the person: saved with the account, returned on every sign-in, never shared
// between people, and only known, sensible values are accepted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';

let app: FastifyInstance;
let owner = '';
let operator = '';

const call = async (method: string, url: string, cookie: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: cookie ? { cookie } : {} });
  return { status: res.statusCode, body: res.json() as any };
};
let device = 0;
const signIn = async (email: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress: `10.9.0.${++device}` });
  expect(res.statusCode).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0];
};

beforeAll(async () => {
  // All test files share one database and only the first seed() runs, so every file seeds the same way (with history).
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  owner = await signIn('owner@test.local', 'TestOwner2026');
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'operator' } });
  expect((await call('POST', '/users', owner, { name: 'Rahim', email: 'prefs-op@test.local', roleId: role.id, password: 'PrefsTemp2026' })).status).toBe(200);
  const first = await signIn('prefs-op@test.local', 'PrefsTemp2026');
  expect((await call('POST', '/auth/change-password', first, { current: 'PrefsTemp2026', next: 'PrefsOwn2026' })).status).toBe(200);
  operator = first;
});
afterAll(async () => app?.close());

describe('personal display settings', () => {
  it('starts empty and comes back on /auth/me after saving', async () => {
    expect((await call('GET', '/auth/me', operator)).body.user.preferences).toBeNull();
    expect((await call('PATCH', '/auth/preferences', operator, { prefs: { fontSet: 'easy', simple: true, fontSize: 16 } })).status).toBe(200);
    expect((await call('GET', '/auth/me', operator)).body.user.preferences).toEqual({ fontSet: 'easy', simple: true, fontSize: 16 });
  });

  it('follows the person to a new device', async () => {
    const other = await signIn('prefs-op@test.local', 'PrefsOwn2026');
    expect((await call('GET', '/auth/me', other)).body.user.preferences).toMatchObject({ fontSet: 'easy', simple: true });
  });

  it('merges a partial save into what is already saved', async () => {
    expect((await call('PATCH', '/auth/preferences', operator, { prefs: { theme: 'dark' } })).status).toBe(200);
    expect((await call('GET', '/auth/me', operator)).body.user.preferences).toEqual({ fontSet: 'easy', simple: true, fontSize: 16, theme: 'dark' });
  });

  it('never shows one person’s settings to another', async () => {
    expect((await call('GET', '/auth/me', owner)).body.user.preferences).toBeNull();
  });

  it('refuses unknown settings and out-of-range values', async () => {
    expect((await call('PATCH', '/auth/preferences', operator, { prefs: { fontSize: 40 } })).status).toBe(400);
    expect((await call('PATCH', '/auth/preferences', operator, { prefs: { fontSet: 'comic' } })).status).toBe(400);
    expect((await call('PATCH', '/auth/preferences', operator, { prefs: { isAdmin: true } })).status).toBe(400);
    expect((await call('PATCH', '/auth/preferences', operator, { prefs: { home: 'https://evil.example' } })).status).toBe(400);
  });

  it('still saves the language on its own', async () => {
    expect((await call('PATCH', '/auth/preferences', operator, { locale: 'bn' })).status).toBe(200);
    const me = (await call('GET', '/auth/me', operator)).body.user;
    expect(me.locale).toBe('bn');
    expect(me.preferences.theme).toBe('dark');
  });
});
