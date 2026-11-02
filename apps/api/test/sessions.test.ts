// Where you are signed in: list your own sign-ins, end one or all the others, a password change
// ends every other sign-in, and the owner can sign a user out of every device.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';

let app: FastifyInstance;
let ownerCookie = '';
const PASSWORD = 'TestOwner2026';

const call = async (method: string, url: string, cookie: string, payload?: unknown) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: cookie ? { cookie } : {} });
  return { status: res.statusCode, body: res.json() as any };
};
// Each sign-in comes from its own device address, as on the farm (and stays under the per-address sign-in limit).
let device = 0;
const signIn = async (email: string, password: string, userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130') => {
  const remoteAddress = `10.0.${Math.floor(++device / 250)}.${device % 250}`;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, headers: { 'user-agent': userAgent }, remoteAddress });
  expect(res.statusCode).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0];
};
const alive = async (cookie: string) => (await call('GET', '/auth/me', cookie)).status === 200;

/** A staff member with three devices signed in: office PC, phone and a laptop. */
const staffWithDevices = async (email: string) => {
  const viewer = await prisma.role.findUniqueOrThrow({ where: { key: 'viewer' } });
  expect((await call('POST', '/users', ownerCookie, { name: 'Device User', email, roleId: viewer.id, password: 'DeviceTemp2026' })).status).toBe(200);
  const first = await signIn(email, 'DeviceTemp2026');
  expect((await call('POST', '/auth/change-password', first, { current: 'DeviceTemp2026', next: 'DeviceOwn2026' })).status).toBe(200);
  return {
    pc: first,
    phone: await signIn(email, 'DeviceOwn2026', 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile'),
    laptop: await signIn(email, 'DeviceOwn2026', 'Mozilla/5.0 (Macintosh) Safari/605'),
  };
};

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  ownerCookie = await signIn('owner@test.local', PASSWORD);
});
afterAll(async () => app?.close());

describe('your own sign-ins', () => {
  it('lists every device you are signed in on, marking this one', async () => {
    const d = await staffWithDevices('devices-list@test.local');
    const { status, body } = await call('GET', '/auth/sessions', d.phone);
    expect(status).toBe(200);
    expect(body.data).toHaveLength(3);
    const current = body.data.filter((s: any) => s.current);
    expect(current).toHaveLength(1);
    expect(current[0].userAgent).toContain('Android');
    expect(body.data.every((s: any) => s.ip && s.createdAt && s.expiresAt)).toBe(true);
  });

  it('never shows anyone else’s sign-ins', async () => {
    const { body } = await call('GET', '/auth/sessions', ownerCookie);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.local' } });
    const ownIds = (await prisma.session.findMany({ where: { userId: owner.id } })).map(s => s.id);
    expect(body.data.every((s: any) => ownIds.includes(s.id))).toBe(true);
  });

  it('ends one other device', async () => {
    const d = await staffWithDevices('devices-one@test.local');
    const laptop = (await call('GET', '/auth/sessions', d.pc)).body.data.find((s: any) => s.userAgent.includes('Macintosh'));
    expect((await call('POST', `/auth/sessions/${laptop.id}/end`, d.pc)).status).toBe(200);
    expect(await alive(d.laptop)).toBe(false);
    expect(await alive(d.pc)).toBe(true);
    expect(await alive(d.phone)).toBe(true);
  });

  it('cannot end someone else’s sign-in', async () => {
    const d = await staffWithDevices('devices-other@test.local');
    const ownerSession = (await call('GET', '/auth/sessions', ownerCookie)).body.data.find((s: any) => s.current);
    expect((await call('POST', `/auth/sessions/${ownerSession.id}/end`, d.pc)).status).toBe(404);
    expect(await alive(ownerCookie)).toBe(true);
  });

  it('"sign out everywhere else" keeps only this device', async () => {
    const d = await staffWithDevices('devices-all@test.local');
    const res = await call('POST', '/auth/sessions/end-others', d.pc);
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(2);
    expect(await alive(d.pc)).toBe(true);
    expect(await alive(d.phone)).toBe(false);
    expect(await alive(d.laptop)).toBe(false);
    expect(await prisma.auditLog.findFirst({ where: { summary: { contains: 'Signed out 2 other devices' } } })).not.toBeNull();
  });

  it('changing your password signs out your other devices', async () => {
    const d = await staffWithDevices('devices-pw@test.local');
    expect((await call('POST', '/auth/change-password', d.phone, { current: 'DeviceOwn2026', next: 'NewSecret2026' })).status).toBe(200);
    expect(await alive(d.phone)).toBe(true);
    expect(await alive(d.pc)).toBe(false);
    expect(await alive(d.laptop)).toBe(false);
  });

  it('someone still on a temporary password cannot list or end sign-ins', async () => {
    const viewer = await prisma.role.findUniqueOrThrow({ where: { key: 'viewer' } });
    expect((await call('POST', '/users', ownerCookie, { name: 'New Person', email: 'devices-temp@test.local', roleId: viewer.id, password: 'TempOnly2026' })).status).toBe(200);
    const c = await signIn('devices-temp@test.local', 'TempOnly2026');
    expect((await call('GET', '/auth/sessions', c)).status).toBe(403);
    expect((await call('POST', '/auth/sessions/end-others', c)).status).toBe(403);
  });

  it('records which device was signed out', async () => {
    const d = await staffWithDevices('devices-audit@test.local');
    const phone = (await call('GET', '/auth/sessions', d.pc)).body.data.find((s: any) => s.userAgent.includes('Android'));
    expect((await call('POST', `/auth/sessions/${phone.id}/end`, d.pc)).status).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { summary: { contains: 'Android' }, AND: { summary: { contains: 'Signed out one device' } } } })).not.toBeNull();
  });

  it('records when each sign-in was last used', async () => {
    const d = await staffWithDevices('devices-seen@test.local');
    await call('GET', '/auth/me', d.phone);
    const phone = (await call('GET', '/auth/sessions', d.phone)).body.data.find((s: any) => s.current);
    expect(phone.lastSeenAt).toBeTruthy();
  });
});

describe('owner signs a user out everywhere', () => {
  it('ends every sign-in of that user and shows the count in the user list', async () => {
    const d = await staffWithDevices('devices-admin@test.local');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'devices-admin@test.local' } });
    expect((await call('GET', '/users', ownerCookie)).body.data.find((u: any) => u.id === user.id).activeSessions).toBe(3);

    const res = await call('POST', `/users/${user.id}/sign-out`, ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(3);
    for (const c of [d.pc, d.phone, d.laptop]) expect(await alive(c)).toBe(false);
    expect((await call('GET', '/users', ownerCookie)).body.data.find((u: any) => u.id === user.id).activeSessions).toBe(0);
    expect(await prisma.auditLog.findFirst({ where: { entityId: user.id, summary: { contains: 'Signed out devices-admin@test.local everywhere' } } })).not.toBeNull();
  });

  it('a user admin who is not the owner cannot sign the owner out', async () => {
    const role = await prisma.role.create({ data: { key: 'sessions-user-admin', name: 'User admin', permissions: JSON.stringify(['dashboard.view', 'users.manage']) } });
    expect((await call('POST', '/users', ownerCookie, { name: 'Office Admin', email: 'sessions-admin@test.local', roleId: role.id, password: 'AdminTemp2026' })).status).toBe(200);
    const admin = await signIn('sessions-admin@test.local', 'AdminTemp2026');
    expect((await call('POST', '/auth/change-password', admin, { current: 'AdminTemp2026', next: 'AdminOwn2026' })).status).toBe(200);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.local' } });
    expect((await call('POST', `/users/${owner.id}/sign-out`, admin)).status).toBe(403);
    expect(await alive(ownerCookie)).toBe(true);
  });

  it('the admin button is not for your own account', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.local' } });
    expect((await call('POST', `/users/${owner.id}/sign-out`, ownerCookie)).status).toBe(409);
    expect(await alive(ownerCookie)).toBe(true);
  });

  it('needs the right to manage users', async () => {
    const d = await staffWithDevices('devices-noadmin@test.local');
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.local' } });
    expect((await call('POST', `/users/${owner.id}/sign-out`, d.pc)).status).toBe(403);
    expect(await alive(ownerCookie)).toBe(true);
  });
});
