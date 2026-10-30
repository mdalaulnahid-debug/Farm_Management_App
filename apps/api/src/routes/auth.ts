import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { parse, zOptText } from '../lib/validate.js';
import { PERMISSIONS } from '../lib/constants.js';
import { audit } from '../services/common.js';
import { actorOf, authed, can, createSession, destroySession, hashPassword, passwordProblem, SESSION_COOKIE, verifyPassword } from '../auth/auth.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export default async function authRoutes(app: FastifyInstance) {
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' };

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
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts, expires: expiresAt });
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: authed }, async req => {
    const org = await prisma.organization.findUnique({ where: { id: 'org' } });
    return { user: req.user, organization: org };
  });

  app.post('/auth/change-password', { preHandler: authed }, async req => {
    const body = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(body.current, user.passwordHash))) throw badRequest('Current password is incorrect.');
    const problem = passwordProblem(body.next);
    if (problem) throw badRequest(problem);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next), mustChangePassword: false } });
    await audit(prisma, actorOf(req), 'update', 'user', user.id, 'Changed own password');
    return { ok: true };
  });

  app.patch('/auth/preferences', { preHandler: authed }, async req => {
    const body = parse(z.object({ locale: z.enum(['en', 'bn']) }), req.body);
    await prisma.user.update({ where: { id: req.user!.id }, data: { locale: body.locale } });
    return { ok: true };
  });

  // ───── User & role administration ─────
  app.get('/roles', { preHandler: can('users.manage') }, async () => {
    const roles = await prisma.role.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { users: true } } } });
    return { data: roles.map(r => ({ ...r, permissions: JSON.parse(r.permissions) })), permissions: PERMISSIONS };
  });

  app.put('/roles/:id', { preHandler: can('users.manage') }, async req => {
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
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' }, include: { role: true } });
    return { data: users.map(({ passwordHash: _p, ...u }) => u) };
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
