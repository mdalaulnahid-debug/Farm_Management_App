// 2-step sign-in: authenticator codes match the RFC 6238 test values, setup needs the password and a first
// code, sign-in then needs a code (or a one-time recovery code), a code is never accepted twice, wrong codes
// lock the account like wrong passwords, the owner can require it for everyone, and a lost phone can be reset.
// Uses its own accounts; the shared test owner never gets 2-step, and the farm-wide rule is always switched back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth/auth.js';
import { base32Decode, base32Encode, codeAt, stepAt, verifyCode } from '../src/auth/totp.js';
import { resetPasswordFromConsole } from '../src/tools/reset-password.js';

let app: FastifyInstance;
const PASSWORD = 'TwoStepUser2026';
let address = 0;
const nextAddress = () => `10.8.${Math.floor(++address / 250)}.${address % 250}`;

const call = async (method: string, url: string, cookie = '', payload?: unknown) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: payload as any, headers: cookie ? { cookie } : {}, remoteAddress: nextAddress() });
  const cookieHeader = res.headers['set-cookie'];
  return { status: res.statusCode, body: res.json() as any, cookie: cookieHeader ? String(cookieHeader).split(';')[0] : '' };
};

const makeUser = async (email: string, roleKey = 'viewer') => {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  return prisma.user.create({ data: { name: `2-step ${roleKey}`, email, roleId: role.id, passwordHash: await hashPassword(PASSWORD) } });
};
const passwordOnly = async (email: string) => {
  const r = await call('POST', '/auth/login', '', { email, password: PASSWORD });
  expect(r.status).toBe(200);
  return r;
};
const signIn = async (email: string) => {
  const r = await passwordOnly(email);
  expect(r.cookie).toBeTruthy();
  return r.cookie;
};
/** A code the server has not seen yet: forget the last used step, then take the current one. */
const freshCode = async (email: string) => {
  const u = await prisma.user.update({ where: { email }, data: { totpLastStep: null } });
  return codeAt(u.totpSecret!, stepAt());
};
/** Set up 2-step for a signed-in user through the API; returns the recovery codes. */
const setUp = async (cookie: string, email: string) => {
  const start = await call('POST', '/auth/two-step/start', cookie, { password: PASSWORD });
  expect(start.status).toBe(200);
  const done = await call('POST', '/auth/two-step/confirm', cookie, { code: codeAt(start.body.secret, stepAt()) });
  expect(done.status).toBe(200);
  await prisma.user.update({ where: { email }, data: { totpLastStep: null } });
  return done.body.recoveryCodes as string[];
};
const signInWithCode = async (email: string) => {
  const first = await passwordOnly(email);
  expect(first.body.twoStep).toBe(true);
  const r = await call('POST', '/auth/login/two-step', '', { ticket: first.body.ticket, code: await freshCode(email) });
  expect(r.status).toBe(200);
  return r.cookie;
};

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
  app = await buildApp();
});
afterAll(async () => {
  await prisma.organization.update({ where: { id: 'org' }, data: { requireTwoStep: false } });
  await prisma.user.updateMany({ where: { email: { endsWith: '@two-step.test.local' } }, data: { active: false } });
  await app?.close();
});

describe('authenticator codes', () => {
  // RFC 6238 appendix B, SHA-1, secret "12345678901234567890", 8 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('match the RFC 6238 test values', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(codeAt(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(codeAt(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(codeAt(secret, Math.floor(1234567890 / 30), 8)).toBe('89005924');
    expect(codeAt(secret, Math.floor(2000000000 / 30), 8)).toBe('69279037');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('accept one step of clock drift either way, not more, and never a used step again', () => {
    const now = 1_800_000_000_000;
    const s = stepAt(now);
    expect(verifyCode(secret, codeAt(secret, s - 1), null, now)).toBe(s - 1);
    expect(verifyCode(secret, codeAt(secret, s + 1), null, now)).toBe(s + 1);
    expect(verifyCode(secret, codeAt(secret, s - 2), null, now)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, s + 2), null, now)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, s), s, now)).toBeNull();
    expect(verifyCode(secret, 'abc123', null, now)).toBeNull();
  });
});

describe('setting it up', () => {
  const email = 'setup@two-step.test.local';
  let cookie = '';
  beforeAll(async () => { await makeUser(email); cookie = await signIn(email); });

  it('needs the password', async () => {
    expect((await call('POST', '/auth/two-step/start', cookie, { password: 'NotMyPassword1' })).status).toBe(400);
  });

  it('gives a QR code and secret, and needs a right first code', async () => {
    const start = await call('POST', '/auth/two-step/start', cookie, { password: PASSWORD });
    expect(start.status).toBe(200);
    expect(start.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(start.body.otpauthUrl).toContain(`secret=${start.body.secret}`);
    expect((await call('POST', '/auth/two-step/confirm', cookie, { code: '000000' })).status).toBe(400);
    expect((await call('GET', '/auth/two-step', cookie)).body.enabled).toBe(false);
    const done = await call('POST', '/auth/two-step/confirm', cookie, { code: codeAt(start.body.secret, stepAt()) });
    expect(done.status).toBe(200);
    expect(done.body.recoveryCodes).toHaveLength(10);
    const status = (await call('GET', '/auth/two-step', cookie)).body;
    expect(status).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    expect(await prisma.auditLog.findFirst({ where: { summary: 'Turned on 2-step sign-in', userId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id } })).not.toBeNull();
  });

  it('cannot be started again while it is on', async () => {
    expect((await call('POST', '/auth/two-step/start', cookie, { password: PASSWORD })).status).toBe(409);
  });

  it('keeps the secret and recovery codes out of the user list', async () => {
    await makeUser('list-owner@two-step.test.local', 'owner');
    const list = await call('GET', '/users', await signIn('list-owner@two-step.test.local'));
    const me = list.body.data.find((u: any) => u.email === email);
    expect(me.twoStepEnabled).toBe(true);
    expect(me).not.toHaveProperty('totpSecret');
    expect(me).not.toHaveProperty('recoveryCodes');
  });
});

describe('signing in', () => {
  const email = 'signin@two-step.test.local';
  let codes: string[] = [];
  beforeAll(async () => {
    await makeUser(email);
    codes = await setUp(await signIn(email), email);
  });

  it('the password alone gives no session, only a ticket for the code step', async () => {
    const r = await passwordOnly(email);
    expect(r.body).toMatchObject({ twoStep: true });
    expect(r.body.ticket).toBeTruthy();
    expect(r.cookie).toBe('');
  });

  it('the right code signs in', async () => {
    const cookie = await signInWithCode(email);
    expect((await call('GET', '/auth/me', cookie)).body.user.twoStepEnabled).toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { action: 'login', summary: { contains: '(2-step code)' } } })).not.toBeNull();
  });

  it('a code that was already used is refused', async () => {
    const first = await passwordOnly(email);
    const code = await freshCode(email);
    expect((await call('POST', '/auth/login/two-step', '', { ticket: first.body.ticket, code })).status).toBe(200);
    const again = await passwordOnly(email);
    expect((await call('POST', '/auth/login/two-step', '', { ticket: again.body.ticket, code })).status).toBe(401);
    await prisma.user.update({ where: { email }, data: { failedLogins: 0, lockedUntil: null } });
  });

  it('a recovery code works once', async () => {
    const first = await passwordOnly(email);
    expect((await call('POST', '/auth/login/two-step', '', { ticket: first.body.ticket, code: codes[0].toUpperCase() })).status).toBe(200);
    const again = await passwordOnly(email);
    expect((await call('POST', '/auth/login/two-step', '', { ticket: again.body.ticket, code: codes[0] })).status).toBe(401);
    expect((await call('POST', '/auth/login/two-step', '', { ticket: again.body.ticket, code: codes[1] })).status).toBe(200);
    await prisma.user.update({ where: { email }, data: { failedLogins: 0, lockedUntil: null } });
  });

  it('a made-up ticket gets nowhere', async () => {
    expect((await call('POST', '/auth/login/two-step', '', { ticket: 'made-up', code: await freshCode(email) })).status).toBe(401);
  });

  it('wrong codes count like wrong passwords and lock the account', async () => {
    const lockEmail = 'lock@two-step.test.local';
    await makeUser(lockEmail);
    await setUp(await signIn(lockEmail), lockEmail);
    const first = await passwordOnly(lockEmail);
    for (let i = 0; i < 5; i++) expect((await call('POST', '/auth/login/two-step', '', { ticket: first.body.ticket, code: '000000' })).status).toBe(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: lockEmail } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect((await call('POST', '/auth/login/two-step', '', { ticket: first.body.ticket, code: await freshCode(lockEmail) })).status).toBe(401);
    expect((await call('POST', '/auth/login', '', { email: lockEmail, password: PASSWORD })).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { userId: user.id, action: 'login_failed', summary: { contains: 'wrong 2-step code' } } })).toBe(5);
  });
});

describe('turning it off and new recovery codes', () => {
  const email = 'off@two-step.test.local';
  let cookie = '';
  beforeAll(async () => {
    await makeUser(email);
    await setUp(await signIn(email), email);
    cookie = await signInWithCode(email);
  });

  it('new recovery codes need a code, and replace the old ones', async () => {
    expect((await call('POST', '/auth/two-step/recovery-codes', cookie, { code: '000000' })).status).toBe(400);
    const r = await call('POST', '/auth/two-step/recovery-codes', cookie, { code: await freshCode(email) });
    expect(r.status).toBe(200);
    expect(r.body.recoveryCodes).toHaveLength(10);
  });

  it('turning off needs the password and a code', async () => {
    expect((await call('POST', '/auth/two-step/disable', cookie, { password: 'WrongPassword1', code: await freshCode(email) })).status).toBe(400);
    expect((await call('POST', '/auth/two-step/disable', cookie, { password: PASSWORD, code: '000000' })).status).toBe(400);
    expect((await call('POST', '/auth/two-step/disable', cookie, { password: PASSWORD, code: await freshCode(email) })).status).toBe(200);
    expect((await passwordOnly(email)).cookie).toBeTruthy();
  });
});

describe('the farm-wide rule and a lost phone', () => {
  const ownerEmail = 'owner@two-step.test.local';
  const staffEmail = 'staff@two-step.test.local';
  let owner = '';
  beforeAll(async () => {
    await makeUser(ownerEmail, 'owner');
    await makeUser(staffEmail);
    owner = await signIn(ownerEmail);
  });
  afterAll(async () => { await prisma.organization.update({ where: { id: 'org' }, data: { requireTwoStep: false } }); });

  it('the owner must have 2-step on before requiring it', async () => {
    expect((await call('PUT', '/admin/two-step-policy', owner, { required: true })).status).toBe(409);
    await setUp(owner, ownerEmail);
    owner = await signInWithCode(ownerEmail);
  });

  it('only the owner can change the rule, even with the right to manage users', async () => {
    const role = await prisma.role.create({ data: { key: 'two-step-user-admin', name: 'User admin', permissions: JSON.stringify(['dashboard.view', 'users.manage']) } });
    const adminEmail = 'admin@two-step.test.local';
    const u = await makeUser(adminEmail);
    await prisma.user.update({ where: { id: u.id }, data: { roleId: role.id } });
    expect((await call('PUT', '/admin/two-step-policy', await signIn(adminEmail), { required: true })).status).toBe(403);
  });

  it('when required, someone without it can only reach the setup screen', async () => {
    const staff = await signIn(staffEmail);
    const r = await call('PUT', '/admin/two-step-policy', owner, { required: true });
    expect(r.status).toBe(200);
    expect(r.body.stillToSetUp).toBeGreaterThan(0);
    const me = await call('GET', '/auth/me', staff);
    expect(me.status).toBe(200);
    expect(me.body.user.mustSetUpTwoStep).toBe(true);
    const blocked = await call('GET', '/items', staff);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('TWO_STEP_REQUIRED');
    expect((await call('GET', '/auth/two-step', staff)).body).toMatchObject({ enabled: false, required: true });
    await setUp(staff, staffEmail);
    expect((await call('GET', '/items', staff)).status).toBe(200);
  });

  it('when required, it cannot be turned off', async () => {
    const staff = await signInWithCode(staffEmail);
    expect((await call('POST', '/auth/two-step/disable', staff, { password: PASSWORD, code: await freshCode(staffEmail) })).status).toBe(409);
  });

  it('the owner can reset a lost phone: the person is signed out and sets it up again', async () => {
    const staff = await signInWithCode(staffEmail);
    const id = (await prisma.user.findUniqueOrThrow({ where: { email: staffEmail } })).id;
    expect((await call('POST', `/users/${id}/reset-two-step`, owner)).status).toBe(200);
    expect((await call('GET', '/auth/me', staff)).status).toBe(401);
    const again = await signIn(staffEmail);
    expect((await call('GET', '/auth/me', again)).body.user.mustSetUpTwoStep).toBe(true);
  });

  it('the reset is not for your own account', async () => {
    const id = (await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id;
    expect((await call('POST', `/users/${id}/reset-two-step`, owner)).status).toBe(409);
  });

  it('switching the rule off lets people in without it again', async () => {
    expect((await call('PUT', '/admin/two-step-policy', owner, { required: false })).status).toBe(200);
    const staff = await signIn(staffEmail);
    expect((await call('GET', '/items', staff)).status).toBe(200);
  });
});

describe('requests sent at the same moment', () => {
  it('the same code opens only one session', async () => {
    const email = 'race-code@two-step.test.local';
    await makeUser(email);
    await setUp(await signIn(email), email);
    const ticket = (await passwordOnly(email)).body.ticket;
    const code = await freshCode(email);
    const results = await Promise.all(Array.from({ length: 4 }, () => call('POST', '/auth/login/two-step', '', { ticket, code })));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
  });

  it('one recovery code opens only one session', async () => {
    const email = 'race-recovery@two-step.test.local';
    await makeUser(email);
    const codes = await setUp(await signIn(email), email);
    const ticket = (await passwordOnly(email)).body.ticket;
    const results = await Promise.all(Array.from({ length: 4 }, () => call('POST', '/auth/login/two-step', '', { ticket, code: codes[0] })));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
  });

  it('a burst of wrong codes counts every one, and the ticket allows only 5 tries', async () => {
    const email = 'race-burst@two-step.test.local';
    await makeUser(email);
    await setUp(await signIn(email), email);
    const ticket = (await passwordOnly(email)).body.ticket;
    const results = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/auth/login/two-step', '', { ticket, code: '000000' })));
    expect(results.every(r => r.status === 401)).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.failedLogins).toBe(5);
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('turning 2-step on signs out every other device', async () => {
    const email = 'other-devices@two-step.test.local';
    await makeUser(email);
    const elsewhere = await signIn(email);
    await setUp(await signIn(email), email);
    expect((await call('GET', '/auth/me', elsewhere)).status).toBe(401);
  });
});

describe('the console password reset', () => {
  it('also turns 2-step off, for a lost phone', async () => {
    const email = 'console@two-step.test.local';
    await makeUser(email);
    await setUp(await signIn(email), email);
    const r = await resetPasswordFromConsole(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.totpEnabledAt).toBeNull();
    expect(user.totpSecret).toBeNull();
    const first = await call('POST', '/auth/login', '', { email, password: r!.temporary });
    expect(first.cookie).toBeTruthy();
  });
});
