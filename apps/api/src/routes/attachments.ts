// Photos of the handwritten vouchers and receipt slips behind payments and bills, kept as proof.
// Adding one needs the right to view that kind of record and to make one (viewers and auditors only look).
// A wrong photo is "removed" (hidden, with who and when) but never deleted: the bytes and their SHA-256 stay, so
// the proof can always be recovered and matched to the audit log. The phone shrinks photos before upload.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { actorOf, can } from '../auth/auth.js';
import { audit } from '../services/common.js';
import type { Permission } from '../lib/constants.js';

/** Phones send about 100–400 KB (1600 px JPEG); 1.5 MB leaves room for a PNG from a computer. */
export const MAX_BYTES = 1.5 * 1024 * 1024;
const PER_RECORD = 10;
/** Uploads per person per minute. */
export const UPLOADS_PER_MINUTE = 20;
const KINDS = {
  payments: {
    type: 'PAYMENT', label: 'Payment', view: 'banking.view', remove: 'banking.manage',
    // Receipts are made with sales rights, supplier payments with purchase rights, other money with banking rights.
    create: [['banking.view', 'sales.create'], ['banking.view', 'purchases.create'], ['banking.view', 'banking.manage']],
    find: (id: string) => prisma.payment.findUnique({ where: { id }, select: { id: true, number: true, status: true } }),
  },
  bills: {
    type: 'BILL', label: 'Bill', view: 'purchases.view', remove: 'purchases.void',
    create: [['purchases.view', 'purchases.create']],
    find: (id: string) => prisma.bill.findUnique({ where: { id }, select: { id: true, number: true, status: true } }),
  },
} as const;

/** Signed in and holding every permission of at least one of the sets. */
const canAny = (sets: readonly (readonly string[])[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  await can()(req, reply);
  const mine = req.user!.permissions as readonly string[];
  if (!sets.some(set => set.every(p => mine.includes(p as Permission)))) throw forbidden();
};

/** The image type from its first bytes, so a file is what it says it is. */
function sniff(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** A simple per-person sliding window, so one account cannot fill the database with photos. */
const recent = new Map<string, number[]>();
function tooMany(userId: string, now = Date.now()) {
  const times = (recent.get(userId) ?? []).filter(t => now - t < 60_000);
  if (times.length >= UPLOADS_PER_MINUTE) { recent.set(userId, times); return true; }
  times.push(now);
  recent.set(userId, times);
  return false;
}

/** Metadata of the photos still shown on one record (never the image bytes, never removed ones). */
export function listAttachments(ownerType: string, ownerId: string) {
  return prisma.attachment.findMany({ where: { ownerType, ownerId, removedAt: null }, select: { id: true, mime: true, size: true, createdAt: true, createdById: true }, orderBy: { createdAt: 'asc' } });
}

export default async function attachmentRoutes(app: FastifyInstance) {
  for (const [path, k] of Object.entries(KINDS)) {
    app.post(`/${path}/:id/attachments`, { preHandler: canAny(k.create), bodyLimit: 2.5 * 1024 * 1024 }, async req => {
      const actor = actorOf(req);
      if (tooMany(req.user!.id)) throw badRequest(`Too many photos at once. Wait a minute (${UPLOADS_PER_MINUTE} per minute at most).`);
      const { dataUrl } = parse(z.object({ dataUrl: z.string().max(2.1 * 1024 * 1024) }), req.body);
      const owner = await k.find((req.params as any).id);
      if (!owner) throw notFound(k.label);
      if (owner.status === 'VOID') throw badRequest(`This ${k.label.toLowerCase()} is void; photos cannot be added to it.`);
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!m) throw badRequest('Send a JPEG, PNG or WebP photo.');
      const bytes = Buffer.from(m[2], 'base64');
      const mime = sniff(bytes);
      if (!mime || mime !== m[1]) throw badRequest('That file is not a photo.');
      if (bytes.length > MAX_BYTES) throw badRequest('The photo is too large (1.5 MB at most).');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      // Count and create together, so two uploads at once cannot pass the limit.
      const a = await prisma.$transaction(async db => {
        if (await db.attachment.count({ where: { ownerType: k.type, ownerId: owner.id, removedAt: null } }) >= PER_RECORD) throw badRequest(`At most ${PER_RECORD} photos per record.`);
        const made = await db.attachment.create({ data: { ownerType: k.type, ownerId: owner.id, mime, size: bytes.length, sha256, data: bytes, createdById: actor?.id ?? null }, select: { id: true, mime: true, size: true, createdAt: true, createdById: true } });
        await audit(db, actor, 'ATTACH', k.type, owner.id, `Photo added to ${owner.number}`, { attachmentId: made.id, size: made.size, sha256 });
        return made;
      });
      return a;
    });

    app.get(`/${path}/:id/attachments/:aid`, { preHandler: can(k.view as Permission) }, async (req, reply: FastifyReply) => {
      const { id, aid } = req.params as any;
      const a = await prisma.attachment.findFirst({ where: { id: aid, ownerType: k.type, ownerId: id, removedAt: null } });
      if (!a) throw notFound('Photo');
      return reply.header('content-type', a.mime).header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').send(Buffer.from(a.data));
    });

    app.delete(`/${path}/:id/attachments/:aid`, { preHandler: can(k.remove as Permission) }, async req => {
      const { id, aid } = req.params as any;
      const a = await prisma.attachment.findFirst({ where: { id: aid, ownerType: k.type, ownerId: id, removedAt: null }, select: { id: true, size: true, sha256: true } });
      if (!a) throw notFound('Photo');
      const actor = actorOf(req);
      await prisma.attachment.update({ where: { id: a.id }, data: { removedAt: new Date(), removedById: actor?.id ?? null } });
      await audit(prisma, actor, 'DETACH', k.type, id, 'Photo removed (kept in the database)', { attachmentId: a.id, size: a.size, sha256: a.sha256 });
      return { ok: true };
    });
  }
}
