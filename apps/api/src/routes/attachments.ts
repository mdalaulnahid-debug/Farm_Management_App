// Photos of the handwritten vouchers and receipt slips behind payments and bills, kept as proof.
// Adding one needs the right to view that kind of record and to make one (viewers and auditors only look).
// A wrong photo is "removed" (hidden, with who and when) but never deleted: the bytes and their SHA-256 stay, so
// the proof can always be recovered and matched to the audit log. The phone shrinks photos before upload.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { actorOf, can } from '../auth/auth.js';
import { audit } from '../services/common.js';
import type { Permission } from '../lib/constants.js';
import { addPhoto, decodePhoto, MAX_PHOTO_BYTES } from '../services/vouchers.js';

export const MAX_BYTES = MAX_PHOTO_BYTES;
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

/** A simple per-person sliding window, so one account cannot fill the database with photos. */
const recent = new Map<string, number[]>();
function tooMany(userId: string, now = Date.now()) {
  const times = (recent.get(userId) ?? []).filter(t => now - t < 60_000);
  if (times.length >= UPLOADS_PER_MINUTE) { recent.set(userId, times); return true; }
  times.push(now);
  recent.set(userId, times);
  return false;
}

/** A checked voucher (MATCHES or MISMATCH) locks the record's photos. */
const checkedVoucher = async (ownerType: string, ownerId: string) =>
  !!(await prisma.voucher.findFirst({ where: { ownerType, ownerId, status: { not: 'UNCHECKED' } } }));

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
      if (await checkedVoucher(k.type, owner.id)) throw badRequest('This voucher has been checked; its photos are locked.');
      const photo = decodePhoto(dataUrl);
      // Count and create together, so two uploads at once cannot pass the limit.
      return prisma.$transaction(db => addPhoto(db, actor, k.type as 'PAYMENT' | 'BILL', owner, photo));
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
      const voucher = await prisma.voucher.findUnique({ where: { ownerType_ownerId: { ownerType: k.type, ownerId: id } } });
      if (voucher && voucher.status !== 'UNCHECKED') throw badRequest('This voucher has been checked; its photos are locked.');
      if (voucher && (await prisma.attachment.count({ where: { ownerType: k.type, ownerId: id, removedAt: null } })) <= 1) {
        throw badRequest('This is the only photo of the voucher. Add the correct photo first, then remove this one.');
      }
      const actor = actorOf(req);
      await prisma.attachment.update({ where: { id: a.id }, data: { removedAt: new Date(), removedById: actor?.id ?? null } });
      await audit(prisma, actor, 'DETACH', k.type, id, 'Photo removed (kept in the database)', { attachmentId: a.id, size: a.size, sha256: a.sha256 });
      return { ok: true };
    });
  }
}
