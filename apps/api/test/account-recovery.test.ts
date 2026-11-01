// Account recovery and user-admin safety: temporary passwords must be replaced before any work,
// only the owner can create or change owner accounts, and the server console can reset a password.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { passwordProblem } from '../src/auth/auth.js';
import { resetPasswordFromConsole } from '../src/tools/reset-password.js';

let app: FastifyInstance;
let ownerCookie = '';
const PASSWORD = 'TestOwner2026';

const call = async (method: string, url: string, cookie: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: cookie ? { cookie } : {} });
  return { status: res.statusCode, body: res.json() as any };
};
const signIn = async (email: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  return { status: res.statusCode, cookie: String(res.headers['set-cookie']).split(';')[0] };
};
/** Sign in with a temporary password and replace it, as a new user does on first sign-in. */
const firstSignIn = async (email: string, temporary: string) => {
  const { cookie } = await signIn(email, temporary);
  expect((await call('POST', '/auth/change-password', cookie, { current: temporary, next: `${temporary}New` })).status).toBe(200);
  return cookie;
};
const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  // The seeded owner starts with a temporary password; these tests need a ready owner.
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  ownerCookie = (await signIn('owner@test.local', PASSWORD)).cookie;
});
afterAll(async () => app?.close());

describe('temporary password must be replaced on the server, not only on screen', () => {
  it('blocks every action except changing the password', async () => {
    expect((await call('POST', '/users', ownerCookie, { name: 'New Manager', email: 'new-manager@test.local', roleId: await roleId('manager'), password: 'TempPass2026' })).status).toBe(200);
    const { cookie } = await signIn('new-manager@test.local', 'TempPass2026');

    const blocked = await call('GET', '/dashboard', cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await call('GET', '/invoices', cookie)).status).toBe(403);

    // What the "set a new password" screen needs still works.
    expect((await call('GET', '/auth/me', cookie)).body.user.mustChangePassword).toBe(true);
    expect((await call('PATCH', '/auth/preferences', cookie, { locale: 'bn' })).status).toBe(200);
    expect((await call('POST', '/auth/change-password', cookie, { current: 'TempPass2026', next: 'MyOwnPass2026' })).status).toBe(200);

    expect((await call('GET', '/dashboard', cookie)).status).toBe(200);
  });
});

describe('only the owner can create or change owner accounts', () => {
  let adminCookie = '';
  let ownerId = '';

  beforeAll(async () => {
    // A non-owner role that may manage users, e.g. an office administrator.
    const role = await prisma.role.create({ data: { key: 'test-user-admin', name: 'User admin', permissions: JSON.stringify(['dashboard.view', 'users.manage']) } });
    expect((await call('POST', '/users', ownerCookie, { name: 'Office Admin', email: 'office-admin@test.local', roleId: role.id, password: 'AdminTemp2026' })).status).toBe(200);
    adminCookie = await firstSignIn('office-admin@test.local', 'AdminTemp2026');
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.local' } })).id;
  });

  it('a user admin cannot create an owner', async () => {
    const res = await call('POST', '/users', adminCookie, { name: 'Sneaky', email: 'sneaky@test.local', roleId: await roleId('owner'), password: 'SneakyPass2026' });
    expect(res.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: 'sneaky@test.local' } })).toBeNull();
  });

  it('a user admin cannot reset the owner’s password or disable the owner', async () => {
    const owner = { name: 'Farm Owner', email: 'owner@test.local', roleId: await roleId('owner') };
    expect((await call('PUT', `/users/${ownerId}`, adminCookie, { ...owner, password: 'TakenOver2026' })).status).toBe(403);
    expect((await call('PUT', `/users/${ownerId}`, adminCookie, { ...owner, active: false })).status).toBe(403);
    expect((await signIn('owner@test.local', PASSWORD)).status).toBe(200);
  });

  it('a user admin cannot promote anyone to owner', async () => {
    const viewer = await call('POST', '/users', adminCookie, { name: 'Plain Viewer', email: 'plain-viewer@test.local', roleId: await roleId('viewer'), password: 'ViewerTemp2026' });
    expect(viewer.status).toBe(200);
    const res = await call('PUT', `/users/${viewer.body.id}`, adminCookie, { name: 'Plain Viewer', email: 'plain-viewer@test.local', roleId: await roleId('owner') });
    expect(res.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: viewer.body.id }, include: { role: true } })).role.key).toBe('viewer');
  });

  it('a user admin cannot change what roles are allowed to do', async () => {
    const id = await roleId('viewer');
    expect((await call('PUT', `/roles/${id}`, adminCookie, { name: 'Viewer', permissions: ['users.manage', 'settings.manage'] })).status).toBe(403);
    expect(JSON.parse((await prisma.role.findUniqueOrThrow({ where: { id } })).permissions)).not.toContain('settings.manage');
  });

  it('the owner can add a spare owner account', async () => {
    expect((await call('POST', '/users', ownerCookie, { name: 'Spare Owner', email: 'spare-owner@test.local', roleId: await roleId('owner'), password: 'SpareTemp2026' })).status).toBe(200);
  });
});

describe('password reset from the server console', () => {
  it('gives a locked-out owner a temporary password and ends their old sign-ins', async () => {
    const email = 'console-owner@test.local';
    expect((await call('POST', '/users', ownerCookie, { name: 'Console Owner', email, roleId: await roleId('owner'), password: 'ConsoleTemp2026' })).status).toBe(200);
    const oldCookie = await firstSignIn(email, 'ConsoleTemp2026');
    // Forgotten password: too many wrong tries, and the account is even disabled.
    await prisma.user.update({ where: { email }, data: { failedLogins: 5, lockedUntil: new Date(Date.now() + 3_600_000), active: false } });

    const result = await resetPasswordFromConsole('  Console-Owner@TEST.local ');
    expect(result).not.toBeNull();
    const temporary = result!.temporary;
    expect(passwordProblem(temporary)).toBeNull();

    expect((await call('GET', '/auth/me', oldCookie)).status).toBe(401);
    const { status, cookie } = await signIn(email, temporary);
    expect(status).toBe(200);
    expect((await call('GET', '/dashboard', cookie)).body.error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await call('POST', '/auth/change-password', cookie, { current: temporary, next: 'BackInBusiness2026' })).status).toBe(200);
    expect((await call('GET', '/dashboard', cookie)).status).toBe(200);

    const log = await prisma.auditLog.findFirst({ where: { entityId: result!.user.id, summary: { contains: 'server console' } } });
    expect(log).not.toBeNull();
  });

  it('gives a different temporary password each time', async () => {
    const a = await resetPasswordFromConsole('console-owner@test.local');
    const b = await resetPasswordFromConsole('console-owner@test.local');
    expect(a!.temporary).not.toBe(b!.temporary);
  });

  it('returns nothing for an unknown email', async () => {
    expect(await resetPasswordFromConsole('nobody@test.local')).toBeNull();
  });
});
