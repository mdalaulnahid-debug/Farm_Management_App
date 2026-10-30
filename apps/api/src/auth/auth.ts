// Password hashing (scrypt), opaque session tokens stored hashed, and request guards.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { Permission } from '../lib/constants.js';

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

export interface AuthUser {
  id: string; name: string; email: string; locale: string; mustChangePassword: boolean;
  role: { key: string; name: string }; permissions: Permission[];
}

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser }
}

/** Resolve the user from the session cookie (if any). Registered as an onRequest hook. */
export async function loadUser(req: FastifyRequest) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const session = await prisma.session.findUnique({ where: { id: hashToken(token) }, include: { user: { include: { role: true } } } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return;
  const u = session.user;
  req.user = {
    id: u.id, name: u.name, email: u.email, locale: u.locale, mustChangePassword: u.mustChangePassword,
    role: { key: u.role.key, name: u.role.name }, permissions: JSON.parse(u.role.permissions),
  };
}

export const actorOf = (req: FastifyRequest) => (req.user ? { id: req.user.id, ip: req.ip } : null);

/** Route guard: `preHandler: can('sales.create')`. Server-side authorization on every operation. */
export const can = (...perms: Permission[]) => async (req: FastifyRequest, _reply: FastifyReply) => {
  if (!req.user) throw unauthorized();
  if (perms.length && !perms.every(p => req.user!.permissions.includes(p))) throw forbidden();
};
export const authed = can();
