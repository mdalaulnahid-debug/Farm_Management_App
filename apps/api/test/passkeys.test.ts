// Passkeys: which address a passkey belongs to, one-use challenges, device names, and (below) the routes, driven
// by a software authenticator so the fingerprint/face/PIN step is simulated without real hardware.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth/auth.js';
import { codeAt, stepAt } from '../src/auth/totp.js';
import { deviceName, issueChallenge, relyingParty, takeChallenge } from '../src/auth/passkeys.js';
import { resetPasswordFromConsole } from '../src/tools/reset-password.js';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';

const req = (protocol: string, host: string) => ({ protocol, host, hostname: host.replace(/:\d+$/, '') });

describe('passkey basics', () => {
  afterEach(() => { delete process.env.PASSKEY_ORIGIN; });

  it('belongs to the https address the browser used', () => {
    expect(relyingParty(req('https', 'farm.example.ts.net'))).toEqual({ rpID: 'farm.example.ts.net', origin: 'https://farm.example.ts.net' });
    expect(relyingParty(req('http', 'localhost:5173'))).toEqual({ rpID: 'localhost', origin: 'http://localhost:5173' });
    expect(relyingParty(req('http', '192.0.2.10:4000'))).toBeNull();
  });

  it('PASSKEY_ORIGIN overrides what the request says', () => {
    process.env.PASSKEY_ORIGIN = 'https://farm.example.ts.net';
    expect(relyingParty(req('http', '127.0.0.1:4000'))).toEqual({ rpID: 'farm.example.ts.net', origin: 'https://farm.example.ts.net' });
  });

  it('a challenge can be taken once, by the right step only', () => {
    const id = issueChallenge('login', 'abc', null);
    expect(takeChallenge(id, 'register')).toBeNull();
    const id2 = issueChallenge('login', 'def', 'u1');
    expect(takeChallenge(id2, 'login')).toEqual({ challenge: 'def', userId: 'u1' });
    expect(takeChallenge(id2, 'login')).toBeNull();
  });

  it('guesses a readable device name', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36')).toBe('Android phone · Chrome');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0')).toBe('Windows PC · Edge');
    expect(deviceName(undefined)).toBe('This device');
  });
});

// ───── The routes ─────
let app: FastifyInstance;
const PASSWORD = 'PasskeyUser2026';
const HOST = 'localhost:4400';
const ORIGIN = 'http://localhost:4400';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
let address = 0;
let users = 0;
const nextAddress = () => `10.11.${Math.floor(++address / 250)}.${address % 250}`;

const call = async (method: string, url: string, cookie = '', payload?: unknown, host = HOST) => {
  const res = await app.inject({
    method: method as any, url: `/api/v1${url}`, payload: payload as any, remoteAddress: nextAddress(),
    headers: { host, 'user-agent': EDGE, ...(cookie ? { cookie } : {}) },
  });
  const set = res.headers['set-cookie'];
  return { status: res.statusCode, text: res.body, body: res.json() as any, cookie: set ? String(set).split(';')[0] : '' };
};
const makeUser = async (roleKey = 'viewer') => {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  users++;
  return prisma.user.create({ data: { name: `Passkey user ${users}`, email: `user${users}@passkeys.test.local`, roleId: role.id, passwordHash: await hashPassword(PASSWORD) } });
};
const freshCode = async (email: string) => {
  const u = await prisma.user.update({ where: { email }, data: { totpLastStep: null } });
  return codeAt(u.totpSecret!, stepAt());
};
const passwordSignIn = async (email: string, password = PASSWORD) => {
  const r = await call('POST', '/auth/login', '', { email, password });
  expect(r.status).toBe(200);
  if (!r.body.twoStep) return r.cookie;
  const done = await call('POST', '/auth/login/two-step', '', { ticket: r.body.ticket, code: await freshCode(email) });
  expect(done.status).toBe(200);
  return done.cookie;
};
/** A user with 2-step sign-in on, signed in. */
const twoStepUser = async () => {
  const user = await makeUser();
  const cookie = await passwordSignIn(user.email);
  const start = await call('POST', '/auth/two-step/start', cookie, { password: PASSWORD });
  expect(start.status).toBe(200);
  expect((await call('POST', '/auth/two-step/confirm', cookie, { code: codeAt(start.body.secret, stepAt()) })).status).toBe(200);
  await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: null } });
  return { user, cookie };
};
const registerOptions = async (cookie: string) => {
  const r = await call('POST', '/auth/passkeys/options', cookie, { password: PASSWORD });
  expect(r.status).toBe(200);
  return r.body as { challengeId: string; options: any };
};
const addPasskey = async (cookie: string, auth = new SoftAuthenticator()) => {
  const { challengeId, options } = await registerOptions(cookie);
  const r = await call('POST', '/auth/passkeys', cookie, { challengeId, response: auth.register(options, ORIGIN) });
  expect(r.status).toBe(200);
  return auth;
};
const passkeySignIn = async (auth: SoftAuthenticator, opts: { uv?: boolean; counter?: number } = {}, origin = ORIGIN) => {
  const o = await call('POST', '/auth/passkey/login/options', '', {});
  expect(o.status).toBe(200);
  return call('POST', '/auth/passkey/login', '', { challengeId: o.body.challengeId, response: auth.assert(o.body.options, origin, opts) });
};
const passkeyCount = (userId: string) => prisma.passkey.count({ where: { userId } });
const failedPasskeyRows = (userId: string) => prisma.auditLog.count({ where: { action: 'login_failed', entityId: userId, summary: { contains: 'passkey' } } });

describe('passkeys', () => {
  beforeAll(async () => {
    await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
    await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
    app = await buildApp();
  });
  afterAll(async () => {
    await prisma.user.updateMany({ where: { email: { endsWith: '@passkeys.test.local' } }, data: { active: false } });
    await app?.close();
  });

  it('adds a passkey only with 2-step on and the password', async () => {
    const plain = await makeUser();
    const plainCookie = await passwordSignIn(plain.email);
    expect((await call('POST', '/auth/passkeys/options', plainCookie, { password: PASSWORD })).status).toBe(409);

    const { user, cookie } = await twoStepUser();
    expect((await call('POST', '/auth/passkeys/options', cookie, { password: 'NotThePassword1' })).status).toBe(400);
    await addPasskey(cookie);
    const list = await call('GET', '/auth/passkeys', cookie);
    expect(list.body.available).toBe(true);
    expect(list.body.twoStepOn).toBe(true);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].name).toBe('Windows PC · Edge');
    expect(list.text).not.toContain('publicKey');
    expect(await passkeyCount(user.id)).toBe(1);
  });

  it('signs in with one touch and counts as 2-step', async () => {
    const { user, cookie } = await twoStepUser();
    const auth = await addPasskey(cookie);
    const r = await passkeySignIn(auth);
    expect(r.status).toBe(200);
    expect(r.cookie).toBeTruthy();
    expect((await call('GET', '/auth/me', r.cookie)).status).toBe(200);
    const row = await prisma.auditLog.findFirst({ where: { action: 'login', entityId: user.id }, orderBy: { createdAt: 'desc' } });
    expect(row?.summary).toMatch(/signed in \(passkey\)$/);
    expect((await prisma.passkey.findFirstOrThrow({ where: { userId: user.id } })).lastUsedAt).not.toBeNull();
  });

  it('refuses a passkey made or used without the fingerprint or PIN check', async () => {
    const { user, cookie } = await twoStepUser();
    const { challengeId, options } = await registerOptions(cookie);
    const r = await call('POST', '/auth/passkeys', cookie, { challengeId, response: new SoftAuthenticator().register(options, ORIGIN, { uv: false }) });
    expect(r.status).toBe(400);
    expect(await passkeyCount(user.id)).toBe(0);
    const auth = await addPasskey(cookie);
    expect((await passkeySignIn(auth, { uv: false })).status).toBe(401);
  });

  it('a sign-in challenge works once, even in parallel', async () => {
    const { cookie } = await twoStepUser();
    const auth = await addPasskey(cookie);
    const o = await call('POST', '/auth/passkey/login/options', '', {});
    const body = { challengeId: o.body.challengeId, response: auth.assert(o.body.options, ORIGIN) };
    const both = await Promise.all([call('POST', '/auth/passkey/login', '', body), call('POST', '/auth/passkey/login', '', body)]);
    expect(both.map(r => r.status).sort()).toEqual([200, 401]);
  });

  it('an unknown passkey gets a clear message', async () => {
    const { cookie } = await twoStepUser();
    const stranger = new SoftAuthenticator();
    stranger.register((await registerOptions(cookie)).options, ORIGIN); // made on the device, never saved here
    const r = await passkeySignIn(stranger);
    expect(r.status).toBe(401);
    expect(r.body.message).toMatch(/not set up here/);
  });

  it('lists existing passkeys so a device cannot be added twice', async () => {
    const { cookie } = await twoStepUser();
    const auth = await addPasskey(cookie);
    const { options } = await registerOptions(cookie);
    expect(options.excludeCredentials.map((c: any) => c.id)).toContain(auth.credentials[0].id.toString('base64url'));
    expect(options.authenticatorSelection.userVerification).toBe('required');
  });

  it('refuses a copied passkey whose counter went backwards', async () => {
    const { user, cookie } = await twoStepUser();
    const auth = await addPasskey(cookie);
    expect((await passkeySignIn(auth, { counter: 5 })).status).toBe(200);
    expect((await passkeySignIn(auth, { counter: 3 })).status).toBe(401);
    expect(await failedPasskeyRows(user.id)).toBe(1);
  });

  it('a failed passkey check is recorded but does not lock the account', async () => {
    const { user, cookie } = await twoStepUser();
    const auth = await addPasskey(cookie);
    for (let i = 0; i < 6; i++) expect((await passkeySignIn(auth, {}, 'https://evil.example')).status).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLogins).toBe(0);
    expect(await failedPasskeyRows(user.id)).toBe(6);
    expect(await passwordSignIn(user.email)).toBeTruthy();
  });

  it('a disabled or locked account cannot use its passkey', async () => {
    const { user, cookie } = await twoStepUser();
    const auth = await addPasskey(cookie);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await passkeySignIn(auth)).status).toBe(401);
    await prisma.user.update({ where: { id: user.id }, data: { active: true, lockedUntil: new Date(Date.now() + 60_000) } });
    const locked = await passkeySignIn(auth);
    expect(locked.status).toBe(401);
    expect(locked.body.message).toMatch(/Too many failed attempts/);
  });

  it('turning off 2-step, an admin reset and the console reset remove passkeys', async () => {
    const a = await twoStepUser();
    await addPasskey(a.cookie);
    expect((await call('GET', '/auth/two-step', a.cookie)).body.passkeys).toBe(1);
    const off = await call('POST', '/auth/two-step/disable', a.cookie, { password: PASSWORD, code: await freshCode(a.user.email) });
    expect(off.status).toBe(200);
    expect(await passkeyCount(a.user.id)).toBe(0);
    const offRow = await prisma.auditLog.findFirst({ where: { entityId: a.user.id, summary: { startsWith: 'Turned off 2-step' } }, orderBy: { createdAt: 'desc' } });
    expect(offRow?.summary).toContain('removed 1 passkey');

    const b = await twoStepUser();
    await addPasskey(b.cookie);
    const ownerCookie = await passwordSignIn('owner@test.local', 'TestOwner2026');
    expect((await call('POST', `/users/${b.user.id}/reset-two-step`, ownerCookie)).status).toBe(200);
    expect(await passkeyCount(b.user.id)).toBe(0);

    const c = await twoStepUser();
    await addPasskey(c.cookie);
    await resetPasswordFromConsole(c.user.email);
    expect(await passkeyCount(c.user.id)).toBe(0);
  });

  it('a passkey sign-in still lands on the forced password change', async () => {
    const { user, cookie } = await twoStepUser();
    const auth = await addPasskey(cookie);
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    const r = await passkeySignIn(auth);
    expect(r.status).toBe(200);
    const s = await call('GET', '/auth/sessions', r.cookie);
    expect(s.status).toBe(403);
    expect(s.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('over plain http on another address, passkeys are unavailable', async () => {
    const { cookie } = await twoStepUser();
    const other = '192.0.2.10:4000';
    expect((await call('GET', '/auth/passkeys', cookie, undefined, other)).body.available).toBe(false);
    expect((await call('POST', '/auth/passkeys/options', cookie, { password: PASSWORD }, other)).status).toBe(400);
    expect((await call('POST', '/auth/passkey/login/options', '', {}, other)).status).toBe(400);
  });

  it('only your own passkeys can be renamed or removed', async () => {
    const a = await twoStepUser();
    await addPasskey(a.cookie);
    const id = (await call('GET', '/auth/passkeys', a.cookie)).body.data[0].id;
    const b = await twoStepUser();
    expect((await call('PATCH', `/auth/passkeys/${id}`, b.cookie, { name: 'Mine now' })).status).toBe(404);
    expect((await call('DELETE', `/auth/passkeys/${id}`, b.cookie)).status).toBe(404);
    expect((await call('PATCH', `/auth/passkeys/${id}`, a.cookie, { name: 'Office phone' })).status).toBe(200);
    expect((await call('GET', '/auth/passkeys', a.cookie)).body.data[0].name).toBe('Office phone');
    expect((await call('DELETE', `/auth/passkeys/${id}`, a.cookie)).status).toBe(200);
    expect(await passkeyCount(a.user.id)).toBe(0);
  });
});
