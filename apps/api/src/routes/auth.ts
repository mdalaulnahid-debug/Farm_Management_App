import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { parse, zOptText } from '../lib/validate.js';
import { PERMISSIONS } from '../lib/constants.js';
import { audit } from '../services/common.js';
import { actorOf, can, createSession, destroySession, hashPassword, passwordProblem, SESSION_COOKIE, signedIn, verifyPassword } from '../auth/auth.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export default async function authRoutes(app: FastifyInstance) {
  // Secure whenever the browser reached us over HTTPS (directly or via the trusted proxy, see TRUST_PROXY).
  const cookieOpts = (req: FastifyRequest) => ({
    path: '/', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' || req.protocol === 'https',
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.active) throw unauthorized('Email or password is incorrect.');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized(`Too many failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString()}.`);
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
      await audit(prisma, { id: user.id, ip: req.ip }, 'login_failed', 'user', user.id, `Failed sign-in for ${user.email}`);
      throw unauthorized('Email or password is incorrect.');
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }); // housekeeping
    const { token, expiresAt } = await createSession(user.id, req.ip, req.headers['user-agent']);
    await audit(prisma, { id: user.id, ip: req.ip }, 'login', 'user', user.id, `${user.name} signed in`);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts(req), expires: expiresAt });
    return { ok: true };
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
    const ended = await prisma.session.deleteMany({ where: { id, userId: req.user!.id } });
    if (!ended.count) throw notFound('Sign-in');
    if (id === req.sessionId) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await audit(prisma, actorOf(req), 'update', 'user', req.user!.id, 'Signed out one device');
    return { ok: true };
  });

  app.post('/auth/sessions/end-others', { preHandler: can() }, async req => {
    const ended = await prisma.session.deleteMany({ where: { userId: req.user!.id, id: { not: req.sessionId } } });
    await audit(prisma, actorOf(req), 'update', 'user', req.user!.id, `Signed out ${ended.count} other device${ended.count === 1 ? '' : 's'}`);
    return { ended: ended.count };
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
    return { data: users.map(({ passwordHash: _p, _count, ...u }) => ({ ...u, activeSessions: _count.sessions })) };
  });

  // End every sign-in of a user, e.g. a lost phone or someone who left. They can sign in again with their password.
  app.post('/users/:id/sign-out', { preHandler: can('users.manage') }, async req => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw notFound('User');
    if (user.role.key === 'owner' && !isOwner(req)) throw forbidden('Only the owner can change an owner account.');
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
