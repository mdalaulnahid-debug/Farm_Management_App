// Checking vouchers: the owner or accountant looks at each spending's voucher photo beside the entry and marks it
// "Matches" or "Doesn't match". Who and when is recorded and audited; a checked voucher's photos are locked.
// Separation of duties: nobody checks a voucher they entered themselves (except the owner), and once checked,
// only the owner may change the verdict.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, zOptText } from '../lib/validate.js';
import { actorOf, can } from '../auth/auth.js';
import { audit } from '../services/common.js';
import { isMoneyAccount } from '../lib/constants.js';

const STATUSES = ['UNCHECKED', 'MISMATCH', 'MATCHES'] as const;

/** The entry behind each voucher, for the side-by-side check. Void records are left out (nothing to check).
 *  Removed photos are listed too, so a checker sees everything that was ever attached. */
async function withEntries(vouchers: { id: string; ownerType: string; ownerId: string }[]) {
  const ids = (t: string) => vouchers.filter(v => v.ownerType === t).map(v => v.ownerId);
  const [bills, pays, journals, photos] = await Promise.all([
    prisma.bill.findMany({ where: { id: { in: ids('BILL') } }, include: { supplier: { select: { name: true } }, lines: { select: { description: true, quantity: true, amount: true } } } }),
    prisma.payment.findMany({ where: { id: { in: ids('PAYMENT') } }, include: { party: { select: { name: true } } } }),
    prisma.journalEntry.findMany({ where: { id: { in: ids('JOURNAL') } }, include: { lines: { include: { account: { select: { name: true, type: true, subtype: true } } } } } }),
    prisma.attachment.findMany({ where: { ownerId: { in: vouchers.map(v => v.ownerId) } }, select: { id: true, ownerId: true, isVoucher: true, removedAt: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  return vouchers.flatMap(v => {
    const b = v.ownerType === 'BILL' ? bills.find(x => x.id === v.ownerId) : undefined;
    const p = v.ownerType === 'PAYMENT' ? pays.find(x => x.id === v.ownerId) : undefined;
    const j = v.ownerType === 'JOURNAL' ? journals.find(x => x.id === v.ownerId) : undefined;
    const rec = b ?? p ?? j;
    if (!rec || rec.status === 'VOID') return [];
    const mine = photos.filter(x => x.ownerId === v.ownerId);
    const entry = b
      ? { kind: 'bill', id: b.id, number: b.number, date: b.date, total: Number(b.total), party: b.supplier?.name ?? null, lines: b.lines.map(l => ({ description: l.description, quantity: Number(l.quantity), amount: Number(l.amount) })), notes: b.notes }
      : p
        ? { kind: 'payment', id: p.id, number: p.number, date: p.date, total: Number(p.amount), party: p.party?.name ?? null, method: p.method, reference: p.reference, notes: p.notes }
        : {
          kind: 'journal', id: j!.id, number: j!.number, date: j!.date, party: null, notes: j!.memo,
          total: Math.round(j!.lines.filter(l => isMoneyAccount(l.account)).reduce((a, l) => a + Number(l.credit) - Number(l.debit), 0) * 100) / 100,
          lines: j!.lines.filter(l => Number(l.debit) > 0).map(l => ({ description: l.account.name, quantity: 1, amount: Number(l.debit) })),
        };
    return [{
      ...v, entry,
      photos: mine.filter(x => !x.removedAt).map(x => x.id),
      removedPhotos: mine.filter(x => x.removedAt).map(x => ({ id: x.id, removedAt: x.removedAt, original: x.isVoucher })),
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

  /** Any photo of a voucher, removed ones included, for the checker. */
  app.get('/vouchers/:id/photos/:aid', { preHandler: can('accounting.manage') }, async (req, reply: FastifyReply) => {
    const { id, aid } = req.params as { id: string; aid: string };
    const v = await prisma.voucher.findUnique({ where: { id } });
    const a = v && await prisma.attachment.findFirst({ where: { id: aid, ownerType: v.ownerType, ownerId: v.ownerId } });
    if (!a) throw notFound('Photo');
    return reply.header('content-type', a.mime).header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').send(Buffer.from(a.data));
  });

  app.post('/vouchers/:id/check', { preHandler: can('accounting.manage') }, async req => {
    const { result, note } = parse(z.object({ result: z.enum(['MATCHES', 'MISMATCH']), note: zOptText(300) }), req.body);
    const v = await prisma.voucher.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) throw notFound('Voucher');
    const owner = req.user!.role.key === 'owner';
    if (v.createdById === req.user!.id && !owner) throw forbidden('Someone else must check a voucher you entered yourself (or the owner).');
    if (v.status !== 'UNCHECKED' && !owner) throw forbidden('This voucher has already been checked. Only the owner can change that.');
    if (result === 'MISMATCH' && !note) throw badRequest('Say what does not match, so it can be put right.');
    const actor = actorOf(req);
    await prisma.voucher.update({ where: { id: v.id }, data: { status: result, checkedById: actor?.id ?? null, checkedAt: new Date(), note: note ?? null } });
    await audit(prisma, actor, 'update', 'voucher', v.ownerId, `${v.status === 'UNCHECKED' ? 'Voucher checked' : `Voucher re-checked by the owner (was ${v.status})`}: ${result === 'MATCHES' ? 'matches the entry' : `does NOT match (${note})`}`, { voucherId: v.id, result, previous: v.status });
    return { ok: true };
  });
}
