// Checking vouchers: the owner or accountant looks at each spending's voucher photo beside the entry and marks it
// "Matches" or "Doesn't match". Who and when is recorded and audited; a checked voucher's photos are locked.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse, zOptText } from '../lib/validate.js';
import { actorOf, can } from '../auth/auth.js';
import { audit } from '../services/common.js';

const STATUSES = ['UNCHECKED', 'MISMATCH', 'MATCHES'] as const;

/** The entry behind each voucher, for the side-by-side check. Void records are left out (nothing to check). */
async function withEntries(vouchers: { id: string; ownerType: string; ownerId: string }[]) {
  const billIds = vouchers.filter(v => v.ownerType === 'BILL').map(v => v.ownerId);
  const payIds = vouchers.filter(v => v.ownerType === 'PAYMENT').map(v => v.ownerId);
  const [bills, pays, photos] = await Promise.all([
    prisma.bill.findMany({ where: { id: { in: billIds } }, include: { supplier: { select: { name: true } }, lines: { select: { description: true, quantity: true, amount: true } } } }),
    prisma.payment.findMany({ where: { id: { in: payIds } }, include: { party: { select: { name: true } } } }),
    prisma.attachment.findMany({ where: { ownerId: { in: [...billIds, ...payIds] }, removedAt: null }, select: { id: true, ownerId: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  return vouchers.flatMap(v => {
    const b = v.ownerType === 'BILL' ? bills.find(x => x.id === v.ownerId) : undefined;
    const p = v.ownerType === 'PAYMENT' ? pays.find(x => x.id === v.ownerId) : undefined;
    const rec = b ?? p;
    if (!rec || rec.status === 'VOID') return [];
    return [{
      ...v,
      entry: b
        ? { kind: 'bill', id: b.id, number: b.number, date: b.date, total: Number(b.total), party: b.supplier?.name ?? null, lines: b.lines.map(l => ({ description: l.description, quantity: Number(l.quantity), amount: Number(l.amount) })), notes: b.notes }
        : { kind: 'payment', id: p!.id, number: p!.number, date: p!.date, total: Number(p!.amount), party: p!.party?.name ?? null, method: p!.method, reference: p!.reference, notes: p!.notes },
      photos: photos.filter(x => x.ownerId === v.ownerId).map(x => x.id),
    }];
  });
}

export default async function voucherRoutes(app: FastifyInstance) {
  app.get('/vouchers', { preHandler: can('accounting.manage') }, async req => {
    const { status } = parse(z.object({ status: z.enum(STATUSES).default('UNCHECKED') }), req.query);
    const list = await prisma.voucher.findMany({ where: { status }, orderBy: [{ createdAt: 'asc' }], take: 200 });
    return { data: await withEntries(list) };
  });

  /** Counts for the owner's dashboard. */
  app.get('/vouchers/summary', { preHandler: can('accounting.manage') }, async () => {
    const live = await withEntries(await prisma.voucher.findMany({ where: { status: { in: ['UNCHECKED', 'MISMATCH'] } } }));
    return { unchecked: live.filter(v => (v as any).status === 'UNCHECKED').length, mismatched: live.filter(v => (v as any).status === 'MISMATCH').length };
  });

  app.post('/vouchers/:id/check', { preHandler: can('accounting.manage') }, async req => {
    const { result, note } = parse(z.object({ result: z.enum(['MATCHES', 'MISMATCH']), note: zOptText(300) }), req.body);
    const v = await prisma.voucher.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) throw notFound('Voucher');
    if (result === 'MISMATCH' && !note) throw badRequest('Say what does not match, so it can be put right.');
    const actor = actorOf(req);
    await prisma.voucher.update({ where: { id: v.id }, data: { status: result, checkedById: actor?.id ?? null, checkedAt: new Date(), note: note ?? null } });
    await audit(prisma, actor, 'update', 'voucher', v.ownerId, result === 'MATCHES' ? 'Voucher checked: matches the entry' : `Voucher checked: does NOT match (${note})`, { voucherId: v.id, result });
    return { ok: true };
  });
}
