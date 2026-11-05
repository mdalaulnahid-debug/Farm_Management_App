// "What I recorded today": the signed-in person's own entries made since midnight (Bangladesh time), so
// data-entry staff can check their work and fix a mistake the same day.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { can } from '../auth/auth.js';
import { farmDayStart, farmYmd } from '../lib/farm-time.js';

type Kind = 'production' | 'invoice' | 'receipt' | 'bill' | 'payment' | 'adjustment';
interface Entry { kind: Kind; id: string; summary: string; amount?: number; createdAt: Date; canFix: boolean }

/** Permission that lets someone other than data-entry staff void each kind (see voidGate in transactions.ts). */
const VOID_PERM: Record<Kind, string> = {
  production: 'production.manage', invoice: 'sales.void', receipt: 'banking.manage', bill: 'purchases.void', payment: 'banking.manage', adjustment: 'inventory.manage',
};

export default async function myDayRoutes(app: FastifyInstance) {
  app.get('/me/today', { preHandler: can() }, async req => {
    const me = req.user!;
    const mine = { createdById: me.id, createdAt: { gte: farmDayStart() } };
    const [logs, invoices, bills, payments, moves] = await Promise.all([
      prisma.productionLog.findMany({ where: { ...mine, status: 'POSTED' }, include: { flock: { select: { code: true } } } }),
      prisma.salesInvoice.findMany({ where: { ...mine, status: { not: 'VOID' } }, include: { customer: { select: { name: true } } } }),
      prisma.bill.findMany({ where: { ...mine, status: { not: 'VOID' } }, include: { supplier: { select: { name: true } } } }),
      prisma.payment.findMany({ where: { ...mine, status: 'POSTED' }, include: { party: { select: { name: true } } } }),
      prisma.stockMove.findMany({ where: { ...mine, sourceType: 'ADJUSTMENT', voided: false }, include: { item: { select: { name: true, unit: true } } } }),
    ]);
    const entries: Entry[] = [
      ...logs.map(l => ({
        kind: 'production' as const, id: l.id, createdAt: l.createdAt,
        summary: [`${l.flock.code}:`, l.eggsCollected && `${l.eggsCollected} eggs`, l.eggsBroken && `${l.eggsBroken} broken`, l.mortality + l.culled && `${l.mortality + l.culled} died`, Number(l.feedQty) && `feed ${Number(l.feedQty)}`].filter(Boolean).join(' '),
      })),
      ...invoices.map(i => ({ kind: 'invoice' as const, id: i.id, createdAt: i.createdAt, summary: `${i.number} · ${i.customer.name}`, amount: Number(i.total) })),
      ...bills.map(b => ({ kind: 'bill' as const, id: b.id, createdAt: b.createdAt, summary: `${b.number}${b.supplier ? ` · ${b.supplier.name}` : ''}`, amount: Number(b.total) })),
      ...payments.map(p => ({ kind: (p.direction === 'IN' ? 'receipt' : 'payment') as Kind, id: p.id, createdAt: p.createdAt, summary: `${p.number}${p.party ? ` · ${p.party.name}` : ''}`, amount: Number(p.amount) })),
      ...moves.map(m => ({ kind: 'adjustment' as const, id: m.sourceId!, createdAt: m.createdAt, summary: `${m.item.name}: ${Math.abs(Number(m.quantity))} ${m.item.unit}` })),
    ].map(e => ({ ...e, canFix: me.role.key === 'operator' || me.permissions.includes(VOID_PERM[e.kind] as never) }));
    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    // Farm-wide "none today" answers (feed, medicine, expenses), so the Today checklist can tick them.
    const none = (await prisma.reminderLog.findMany({ where: { day: farmYmd(), kind: 'none' }, select: { slot: true } })).map(r => r.slot.replace('none-', ''));
    return { entries, none };
  });
}
