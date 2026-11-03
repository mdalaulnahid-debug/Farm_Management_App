// Password hashing (scrypt), opaque session tokens stored hashed, and request guards.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import type { Permission } from '../lib/constants.js';
import { audit } from '../services/common.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
export const SESSION_COOKIE = 'fl_session';

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, PARAMS);
  return timingSafeEqual(key, expected);
}

export function passwordProblem(pw: string) {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createSession(userId: string, ip?: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  const hours = Number(process.env.SESSION_HOURS || 12);
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt, ip, userAgent: userAgent?.slice(0, 200) } });
  return { token, expiresAt };
}

export const destroySession = (token: string) => prisma.session.deleteMany({ where: { id: hashToken(token) } });

/** Secure whenever the browser reached us over HTTPS (directly or via the trusted proxy, see TRUST_PROXY). */
export const cookieOpts = (req: FastifyRequest) => ({
  path: '/', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' || req.protocol === 'https',
});

/**
 * A successful sign-in (password, 2-step code or passkey): clear failed tries, open a session, record it as
 * "<name> signed in<how>" and set the cookie.
 */
export async function startSession(req: FastifyRequest, reply: FastifyReply, user: { id: string; name: string }, how: string, extra: Record<string, unknown> = {}) {
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), ...extra } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }); // housekeeping
  const { token, expiresAt } = await createSession(user.id, req.ip, req.headers['user-agent']);
  await audit(prisma, { id: user.id, ip: req.ip }, 'login', 'user', user.id, `${user.name} signed in${how}`);
  reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts(req), expires: expiresAt });
  return { ok: true as const };
}

export const lockedMessage = (until: Date) => `Too many failed attempts. Try again after ${until.toLocaleTimeString()}.`;

export interface AuthUser {
  id: string; name: string; email: string; locale: string; mustChangePassword: boolean;
  /** 2-step sign-in is on for this account. */
  twoStepEnabled: boolean;
  /** The farm requires 2-step sign-in and this account has not set it up yet. */
  mustSetUpTwoStep: boolean;
  role: { key: string; name: string }; permissions: Permission[];
}

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser; sessionId?: string }
}

const SEEN_EVERY_MS = 5 * 60_000;

/** Resolve the user from the session cookie (if any). Registered as an onRequest hook. */
export async function loadUser(req: FastifyRequest) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const session = await prisma.session.findUnique({ where: { id: hashToken(token) }, include: { user: { include: { role: true } } } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return;
  req.sessionId = session.id;
  if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > SEEN_EVERY_MS) {
    // Best effort: a busy database must never turn an ordinary request into an error.
    await prisma.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  const u = session.user;
  const twoStepEnabled = !!u.totpEnabledAt;
  const required = twoStepEnabled ? false : !!(await prisma.organization.findUnique({ where: { id: 'org' }, select: { requireTwoStep: true } }))?.requireTwoStep;
  req.user = {
    id: u.id, name: u.name, email: u.email, locale: u.locale, mustChangePassword: u.mustChangePassword,
    twoStepEnabled, mustSetUpTwoStep: required,
    role: { key: u.role.key, name: u.role.name }, permissions: JSON.parse(u.role.permissions),
  };
}

export const actorOf = (req: FastifyRequest) =>
  (req.user ? { id: req.user.id, ip: req.ip, mayBackdate: req.user.permissions.includes('settings.manage') } : null);

/**
 * Route guard: `preHandler: can('sales.create')`. Server-side authorization on every operation.
 * Someone still on a temporary password may do nothing until they have chosen their own, and when the
 * farm requires 2-step sign-in, nothing until they have set it up.
 */
export const can = (...perms: Permission[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  await passwordSet(req, reply);
  if (req.user!.mustSetUpTwoStep) throw new AppError(403, 'Set up 2-step sign-in before continuing.', 'TWO_STEP_REQUIRED');
  if (perms.length && !perms.every(p => req.user!.permissions.includes(p))) throw forbidden();
};
export const authed = can();
/** Signed in, even on a temporary password. Only for what the "set a new password" screen needs. */
export const signedIn = async (req: FastifyRequest, _reply: FastifyReply) => {
  if (!req.user) throw unauthorized();
};
/** Signed in with their own password, 2-step set up or not. Only for what the 2-step setup screen needs. */
export const passwordSet = async (req: FastifyRequest, _reply: FastifyReply) => {
  if (!req.user) throw unauthorized();
  if (req.user.mustChangePassword) throw new AppError(403, 'Set a new password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
};
