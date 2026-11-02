import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { parse, zOptText } from '../lib/validate.js';
import { PERMISSIONS } from '../lib/constants.js';
import { audit } from '../services/common.js';
import { actorOf, can, createSession, destroySession, hashPassword, passwordProblem, passwordSet, SESSION_COOKIE, signedIn, verifyPassword } from '../auth/auth.js';
import { hashRecovery, newRecoveryCodes, newSecret, otpauthUrl, useRecoveryCode, verifyCode } from '../auth/totp.js';
import { endTicket, issueTicket, useTicketAttempt } from '../auth/two-step.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export default async function authRoutes(app: FastifyInstance) {
  // Secure whenever the browser reached us over HTTPS (directly or via the trusted proxy, see TRUST_PROXY).
  const cookieOpts = (req: FastifyRequest) => ({
    path: '/', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' || req.protocol === 'https',
  });

  // A wrong password or a wrong 2-step code counts the same: after MAX_FAILED the account waits LOCK_MINUTES.
  // The count goes up in the database itself, so attempts sent in parallel each count.
  const recordFailure = async (req: FastifyRequest, user: { id: string; email: string }, what: string) => {
    const { failedLogins } = await prisma.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
    if (failedLogins >= MAX_FAILED) await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } });
    await audit(prisma, { id: user.id, ip: req.ip }, 'login_failed', 'user', user.id, `Failed sign-in for ${user.email}${what}`);
  };
  /**
   * Accept the current authenticator code or an unused recovery code, and mark it used. The write only
   * succeeds if nobody used a code in the meantime, so the same code cannot open two sessions.
   */
  const claimSecondFactor = async (user: { id: string; totpSecret: string | null; totpLastStep: number | null; recoveryCodes: string | null }, code: string) => {
    if (!user.totpSecret) return null;
    const step = verifyCode(user.totpSecret, code, user.totpLastStep);
    if (step !== null) {
      const won = await prisma.user.updateMany({ where: { id: user.id, totpLastStep: user.totpLastStep }, data: { totpLastStep: step } });
      return won.count ? { how: ' (2-step code)' } : null;
    }
    const remaining = useRecoveryCode(user.recoveryCodes, code);
    if (remaining) {
      const won = await prisma.user.updateMany({ where: { id: user.id, recoveryCodes: user.recoveryCodes }, data: { recoveryCodes: JSON.stringify(remaining) } });
      return won.count ? { how: ` with a recovery code (${remaining.length} left)` } : null;
    }
    return null;
  };
  const lockedMessage = (until: Date) => `Too many failed attempts. Try again after ${until.toLocaleTimeString()}.`;
  const startSession = async (req: FastifyRequest, reply: FastifyReply, user: { id: string; name: string }, how: string, extra: Record<string, unknown> = {}) => {
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), ...extra } });
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }); // housekeeping
    const { token, expiresAt } = await createSession(user.id, req.ip, req.headers['user-agent']);
    await audit(prisma, { id: user.id, ip: req.ip }, 'login', 'user', user.id, `${user.name} signed in${how}`);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts(req), expires: expiresAt });
    return { ok: true };
  };

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.active) throw unauthorized('Email or password is incorrect.');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized(lockedMessage(user.lockedUntil));
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await recordFailure(req, user, '');
      throw unauthorized('Email or password is incorrect.');
    }
    // With 2-step sign-in on, the right password only earns a short-lived ticket for the code step.
    if (user.totpEnabledAt) return { twoStep: true, ticket: issueTicket(user.id) };
    return startSession(req, reply, user, '');
  });

  // Second step: the 6-digit code from the authenticator app, or one of the printed recovery codes.
  app.post('/auth/login/two-step', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ ticket: z.string().min(1).max(100), code: z.string().trim().min(1).max(20) }), req.body);
    const ticket = useTicketAttempt(body.ticket);
    if (!ticket) throw unauthorized('The sign-in took too long or had too many wrong codes. Enter your password again.');
    const user = await prisma.user.findUnique({ where: { id: ticket.userId } });
    if (!user || !user.active || !user.totpEnabledAt || !user.totpSecret) { endTicket(body.ticket); throw unauthorized('Enter your password again.'); }
    if (user.lockedUntil && user.lockedUntil > new Date()) { endTicket(body.ticket); throw unauthorized(lockedMessage(user.lockedUntil)); }
    const used = await claimSecondFactor(user, body.code);
    if (used) {
      endTicket(body.ticket);
      return startSession(req, reply, user, used.how);
    }
    await recordFailure(req, user, ' (wrong 2-step code)');
    throw unauthorized('That code is not right. Use the newest code in your authenticator app, and check that the phone shows the right time.');
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Public: the sign-in page shows the farm's name before anyone signs in.
  app.get('/auth/brand', async () => {
    const org = await prisma.organization.findUnique({ where: { id: 'org' }, select: { name: true, nameBn: true } });
    return { name: org?.name ?? 'FarmLedger', nameBn: org?.nameBn ?? null };
  });

  app.get('/auth/me', { preHandler: signedIn }, async req => {
    const org = await prisma.organization.findUnique({ where: { id: 'org' } });
    return { user: req.user, organization: org };
  });

  app.post('/auth/change-password', { preHandler: signedIn }, async req => {
    const body = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(body.current, user.passwordHash))) throw badRequest('Current password is incorrect.');
    const problem = passwordProblem(body.next);
    if (problem) throw badRequest(problem);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next), mustChangePassword: false } });
    // Whoever knew the old password is signed out everywhere else.
    const ended = await prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId } } });
    await audit(prisma, actorOf(req), 'update', 'user', user.id, `Changed own password${ended.count ? ` (signed out ${ended.count} other device${ended.count === 1 ? '' : 's'})` : ''}`);
    return { ok: true };
  });

  // ───── Where you are signed in ─────
  app.get('/auth/sessions', { preHandler: can() }, async req => {
    const sessions = await prisma.session.findMany({ where: { userId: req.user!.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    return {
      data: sessions.map(s => ({ id: s.id, current: s.id === req.sessionId, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt ?? s.createdAt, expiresAt: s.expiresAt, ip: s.ip, userAgent: s.userAgent ?? '' })),
    };
  });

  app.post('/auth/sessions/:id/end', { preHandler: can() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await prisma.session.findFirst({ where: { id, userId: req.user!.id } });
    if (!session) throw notFound('Sign-in');
    await prisma.session.deleteMany({ where: { id, userId: req.user!.id } });
    if (id === req.sessionId) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await audit(prisma, actorOf(req), 'update', 'user', req.user!.id,
      `Signed out one device (signed in ${session.createdAt.toISOString().slice(0, 16).replace('T', ' ')} from ${session.ip ?? 'unknown address'}, ${(session.userAgent ?? 'unknown browser').slice(0, 80)})`);
    return { ok: true };
  });

  app.post('/auth/sessions/end-others', { preHandler: can() }, async req => {
    const ended = await prisma.session.deleteMany({ where: { userId: req.user!.id, id: { not: req.sessionId } } });
    await audit(prisma, actorOf(req), 'update', 'user', req.user!.id, `Signed out ${ended.count} other device${ended.count === 1 ? '' : 's'}`);
    return { ended: ended.count };
  });

  // ───── 2-step sign-in (authenticator app) ─────
  const twoStepStatus = async (userId: string) => {
    const [user, org] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.organization.findUnique({ where: { id: 'org' }, select: { requireTwoStep: true } }),
    ]);
    const left: string[] = user.recoveryCodes ? JSON.parse(user.recoveryCodes) : [];
    return { enabled: !!user.totpEnabledAt, enabledAt: user.totpEnabledAt, required: !!org?.requireTwoStep, recoveryCodesLeft: user.totpEnabledAt ? left.length : 0 };
  };
  const newCodes = () => {
    const codes = newRecoveryCodes();
    return { codes, stored: JSON.stringify(codes.map(hashRecovery)) };
  };
  /** The current 6-digit code or an unused recovery code, to turn 2-step off or get new recovery codes. */
  const checkSecondFactor = async (userId: string, code: string) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabledAt || !user.totpSecret) throw conflict('2-step sign-in is not on.');
    if (!(await claimSecondFactor(user, code))) throw badRequest('That code is not right.');
  };

  app.get('/auth/two-step', { preHandler: passwordSet }, async req => twoStepStatus(req.user!.id));

  // Setting up, step 1: needs the password, so someone at an unlocked computer cannot tie the account to their phone.
  app.post('/auth/two-step/start', { preHandler: passwordSet, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const body = parse(z.object({ password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.totpEnabledAt) throw conflict('2-step sign-in is already on.');
    if (!(await verifyPassword(body.password, user.passwordHash))) throw badRequest('Password is incorrect.');
    const secret = newSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret, totpLastStep: null } });
    const org = await prisma.organization.findUnique({ where: { id: 'org' }, select: { name: true } });
    const url = otpauthUrl(org?.name ? `FarmLedger (${org.name})` : 'FarmLedger', user.email, secret);
    return { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }) };
  });

  // Step 2: the first code from the app proves it was set up right. Returns the recovery codes, shown only once.
  app.post('/auth/two-step/confirm', { preHandler: passwordSet, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const body = parse(z.object({ code: z.string().trim().min(1).max(20) }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.totpEnabledAt) throw conflict('2-step sign-in is already on.');
    if (!user.totpSecret) throw badRequest('Start the setup again.');
    const step = verifyCode(user.totpSecret, body.code);
    if (step === null) throw badRequest('That code is not right. Type the 6 digits the app shows now, and check that the phone shows the right time.');
    const { codes, stored } = newCodes();
    const won = await prisma.user.updateMany({ where: { id: user.id, totpEnabledAt: null, totpSecret: user.totpSecret }, data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: stored } });
    if (!won.count) throw conflict('2-step sign-in was just turned on from another window.');
    // Anyone already signed in elsewhere (perhaps with a stolen password) is signed out.
    const ended = await prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId } } });
    await audit(prisma, actorOf(req), 'update', 'user', user.id, `Turned on 2-step sign-in${ended.count ? ` (signed out ${ended.count} other device${ended.count === 1 ? '' : 's'})` : ''}`);
    return { recoveryCodes: codes };
  });

  app.post('/auth/two-step/disable', { preHandler: can(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const body = parse(z.object({ password: z.string().min(1), code: z.string().trim().min(1).max(20) }), req.body);
    if ((await twoStepStatus(req.user!.id)).required) throw conflict('Your farm requires 2-step sign-in for everyone, so it cannot be turned off.');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(body.password, user.passwordHash))) throw badRequest('Password is incorrect.');
    await checkSecondFactor(user.id, body.code);
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null } });
    await audit(prisma, actorOf(req), 'update', 'user', user.id, 'Turned off 2-step sign-in');
    return { ok: true };
  });

  app.post('/auth/two-step/recovery-codes', { preHandler: can(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const body = parse(z.object({ code: z.string().trim().min(1).max(20) }), req.body);
    await checkSecondFactor(req.user!.id, body.code);
    const { codes, stored } = newCodes();
    await prisma.user.update({ where: { id: req.user!.id }, data: { recoveryCodes: stored } });
    await audit(prisma, actorOf(req), 'update', 'user', req.user!.id, 'Made new 2-step recovery codes (the old ones no longer work)');
    return { recoveryCodes: codes };
  });

  app.patch('/auth/preferences', { preHandler: signedIn }, async req => {
    const body = parse(z.object({ locale: z.enum(['en', 'bn']) }), req.body);
    await prisma.user.update({ where: { id: req.user!.id }, data: { locale: body.locale } });
    return { ok: true };
  });

  // ───── User & role administration ─────
  // Managing users does not make someone the owner: only an owner may change roles or touch owner accounts.
  const isOwner = (req: FastifyRequest) => req.user!.role.key === 'owner';
  const roleOf = async (id: string) => {
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) throw badRequest('Choose a role.');
    return role;
  };

  app.get('/roles', { preHandler: can('users.manage') }, async () => {
    const roles = await prisma.role.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { users: true } } } });
    return { data: roles.map(r => ({ ...r, permissions: JSON.parse(r.permissions) })), permissions: PERMISSIONS };
  });

  app.put('/roles/:id', { preHandler: can('users.manage') }, async req => {
    if (!isOwner(req)) throw forbidden('Only the owner can change what a role is allowed to do.');
    const { id } = req.params as { id: string };
    const body = parse(z.object({ name: z.string().min(2).max(60), description: zOptText(200), permissions: z.array(z.enum(Object.keys(PERMISSIONS) as [string, ...string[]])) }), req.body);
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) throw notFound('Role');
    if (role.key === 'owner') throw conflict('The owner role always has full access.');
    const updated = await prisma.role.update({ where: { id }, data: { name: body.name, description: body.description, permissions: JSON.stringify(body.permissions) } });
    await audit(prisma, actorOf(req), 'update', 'role', id, `Updated role ${updated.name}`, body);
    return updated;
  });

  app.get('/users', { preHandler: can('users.manage') }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { role: true, _count: { select: { sessions: { where: { expiresAt: { gt: new Date() } } } } } },
    });
    return {
      data: users.map(({ passwordHash: _p, totpSecret: _s, totpLastStep: _l, recoveryCodes: _r, _count, ...u }) => ({ ...u, twoStepEnabled: !!u.totpEnabledAt, activeSessions: _count.sessions })),
    };
  });

  // Owner only: everyone must use 2-step sign-in. Whoever has not set it up is sent to the setup screen.
  app.put('/admin/two-step-policy', { preHandler: can('users.manage') }, async req => {
    if (!isOwner(req)) throw forbidden('Only the owner can change this.');
    const body = parse(z.object({ required: z.boolean() }), req.body);
    if (body.required && !req.user!.twoStepEnabled) throw conflict('Turn on 2-step sign-in for your own account first (My settings → Password & security).');
    await prisma.organization.update({ where: { id: 'org' }, data: { requireTwoStep: body.required } });
    const without = body.required ? await prisma.user.count({ where: { active: true, totpEnabledAt: null } }) : 0;
    await audit(prisma, actorOf(req), 'update', 'settings', 'org', body.required ? `Required 2-step sign-in for everyone (${without} still to set it up)` : 'Stopped requiring 2-step sign-in');
    return { required: body.required, stillToSetUp: without };
  });

  // Lost phone and no recovery codes: the person signs in with their password and sets 2-step up again.
  app.post('/users/:id/reset-two-step', { preHandler: can('users.manage') }, async req => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw notFound('User');
    if (user.role.key === 'owner' && !isOwner(req)) throw forbidden('Only the owner can change an owner account.');
    if (id === req.user!.id) throw conflict('Use My settings → Password & security to change your own 2-step sign-in.');
    await prisma.user.update({ where: { id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null } });
    const ended = await prisma.session.deleteMany({ where: { userId: id } });
    await audit(prisma, actorOf(req), 'update', 'user', id, `Reset 2-step sign-in for ${user.email} (signed out ${ended.count} device${ended.count === 1 ? '' : 's'})`);
    return { ok: true };
  });

  // End every sign-in of a user, e.g. a lost phone or someone who left. They can sign in again with their password.
  app.post('/users/:id/sign-out', { preHandler: can('users.manage') }, async req => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw notFound('User');
    if (user.role.key === 'owner' && !isOwner(req)) throw forbidden('Only the owner can change an owner account.');
    if (id === req.user!.id) throw conflict('Use My account → Where you are signed in to sign yourself out.');
    const ended = await prisma.session.deleteMany({ where: { userId: id } });
    await audit(prisma, actorOf(req), 'update', 'user', id, `Signed out ${user.email} everywhere (${ended.count} device${ended.count === 1 ? '' : 's'})`);
    return { ended: ended.count };
  });

  const userBody = z.object({
    name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(), phone: zOptText(30),
    roleId: z.string(), active: z.boolean().default(true), password: z.string().optional(),
  });

  app.post('/users', { preHandler: can('users.manage') }, async req => {
    const body = parse(userBody, req.body);
    if (!body.password) throw badRequest('Set an initial password.');
    const problem = passwordProblem(body.password);
    if (problem) throw badRequest(problem);
    if ((await roleOf(body.roleId)).key === 'owner' && !isOwner(req)) throw forbidden('Only the owner can add another owner.');
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict('A user with this email already exists.');
    const user = await prisma.user.create({ data: { name: body.name, email: body.email, phone: body.phone, roleId: body.roleId, active: body.active, passwordHash: await hashPassword(body.password), mustChangePassword: true } });
    await audit(prisma, actorOf(req), 'create', 'user', user.id, `Created user ${user.email}`);
    return { id: user.id };
  });

  app.put('/users/:id', { preHandler: can('users.manage') }, async req => {
    const { id } = req.params as { id: string };
    const body = parse(userBody, req.body);
    const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw notFound('User');
    const role = await roleOf(body.roleId);
    if ((user.role.key === 'owner' || role.key === 'owner') && !isOwner(req)) throw forbidden('Only the owner can change an owner account.');
    if (id === req.user!.id && (!body.active || body.roleId !== user.roleId)) throw conflict('You cannot deactivate yourself or change your own role.');
    const data: Record<string, unknown> = { name: body.name, email: body.email, phone: body.phone, roleId: body.roleId, active: body.active };
    if (body.password) {
      const problem = passwordProblem(body.password);
      if (problem) throw badRequest(problem);
      data.passwordHash = await hashPassword(body.password);
      data.mustChangePassword = true;
      data.failedLogins = 0;
      data.lockedUntil = null;
    }
    await prisma.user.update({ where: { id }, data });
    if (!body.active || body.password) await prisma.session.deleteMany({ where: { userId: id } });
    await audit(prisma, actorOf(req), 'update', 'user', id, `Updated user ${body.email}${body.password ? ' (password reset)' : ''}`);
    return { ok: true };
  });
}
