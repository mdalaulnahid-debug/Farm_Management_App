// Business transactions. Each write runs in one database transaction so a document, its stock
// movements and its journal entry are saved together or not at all.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, tx } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { parse, zDate, zId, zMoney, zOptDate, zOptText, zQty, zRange, zReason } from '../lib/validate.js';
import { ADJUSTMENT_TYPES, PAYMENT_METHODS } from '../lib/constants.js';
import { endOf } from '../lib/dates.js';
import { actorOf, can } from '../auth/auth.js';
import { createInvoice, voidInvoice } from '../services/sales.js';
import { createBill, voidBill } from '../services/purchases.js';
import { createPayment, voidPayment } from '../services/payments.js';
import { adjustStock, cashCount, recordProduction, transfer, voidProduction } from '../services/operations.js';
import { postEntry, reverseEntry } from '../services/ledger.js';
import { audit } from '../services/common.js';

const listQuery = zRange.extend({
  search: z.string().optional(), status: z.string().optional(), partyId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
const dateWhere = (q: { from?: Date; to?: Date }) => (q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: endOf(q.to.toISOString().slice(0, 10)) } : {}) } } : {});
const page = (q: { page: number; pageSize: number }) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
const cashReceipt = z.object({ amount: zMoney, cashAccountId: zId, method: z.enum(PAYMENT_METHODS).optional() }).nullish();

export default async function transactionRoutes(app: FastifyInstance) {
  // ───── Sales invoices ─────
  app.get('/invoices', { preHandler: can('sales.view') }, async req => {
    const q = parse(listQuery, req.query);
    const where = {
      ...dateWhere(q), ...(q.status ? { status: { in: q.status.split(',') } } : {}), ...(q.partyId ? { customerId: q.partyId } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search } }, { customer: { name: { contains: q.search } } }, { reference: { contains: q.search } }] } : {}),
    };
    const [data, total, sums] = await Promise.all([
      prisma.salesInvoice.findMany({ where, include: { customer: { select: { id: true, name: true } } }, orderBy: [{ date: 'desc' }, { number: 'desc' }], ...page(q) }),
      prisma.salesInvoice.count({ where }),
      prisma.salesInvoice.aggregate({ where: { ...where, status: { not: 'VOID' } }, _sum: { total: true, amountPaid: true } }),
    ]);
    return { data, total, totals: { total: Number(sums._sum.total ?? 0), paid: Number(sums._sum.amountPaid ?? 0) } };
  });
  app.get('/invoices/:id', { preHandler: can('sales.view') }, async req => {
    const inv = await prisma.salesInvoice.findUnique({ where: { id: (req.params as any).id }, include: { lines: true, customer: true, allocations: { include: { payment: true } } } });
    if (!inv) throw notFound('Invoice');
    return inv;
  });
  app.post('/invoices', { preHandler: can('sales.create') }, async req => {
    const body = parse(z.object({
      date: zDate, dueDate: zOptDate, customerId: zId, discount: zMoney.default(0), reference: zOptText(60), notes: zOptText(500),
      lines: z.array(z.object({ itemId: zOptText(40), description: z.string().max(200).optional(), quantity: zQty, unitPrice: zMoney, accountId: zOptText(40) })).min(1).max(100),
      received: cashReceipt,
    }), req.body);
    return tx(db => createInvoice(db, actorOf(req), body));
  });
  app.post('/invoices/:id/void', { preHandler: can('sales.void') }, async req => {
    const { reason } = parse(zReason, req.body);
    await tx(db => voidInvoice(db, actorOf(req), (req.params as any).id, reason));
    return { ok: true };
  });

  // ───── Bills & expenses ─────
  app.get('/bills', { preHandler: can('purchases.view') }, async req => {
    const q = parse(listQuery, req.query);
    const where = {
      ...dateWhere(q), ...(q.status ? { status: { in: q.status.split(',') } } : {}), ...(q.partyId ? { supplierId: q.partyId } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search } }, { supplier: { name: { contains: q.search } } }, { reference: { contains: q.search } }, { notes: { contains: q.search } }] } : {}),
    };
    const [data, total, sums] = await Promise.all([
      prisma.bill.findMany({ where, include: { supplier: { select: { id: true, name: true } }, lines: { select: { description: true, accountId: true } } }, orderBy: [{ date: 'desc' }, { number: 'desc' }], ...page(q) }),
      prisma.bill.count({ where }),
      prisma.bill.aggregate({ where: { ...where, status: { not: 'VOID' } }, _sum: { total: true, amountPaid: true } }),
    ]);
    return { data, total, totals: { total: Number(sums._sum.total ?? 0), paid: Number(sums._sum.amountPaid ?? 0) } };
  });
  app.get('/bills/:id', { preHandler: can('purchases.view') }, async req => {
    const bill = await prisma.bill.findUnique({ where: { id: (req.params as any).id }, include: { lines: true, supplier: true, allocations: { include: { payment: true } } } });
    if (!bill) throw notFound('Bill');
    return bill;
  });
  app.post('/bills', { preHandler: can('purchases.create') }, async req => {
    const body = parse(z.object({
      date: zDate, dueDate: zOptDate, supplierId: zOptText(40), reference: zOptText(60), notes: zOptText(500),
      lines: z.array(z.object({ itemId: zOptText(40), accountId: zOptText(40), description: z.string().max(200).optional(), quantity: zQty, unitPrice: zMoney })).min(1).max(100),
      paid: cashReceipt,
    }), req.body);
    return tx(db => createBill(db, actorOf(req), body));
  });
  app.post('/bills/:id/void', { preHandler: can('purchases.void') }, async req => {
    const { reason } = parse(zReason, req.body);
    await tx(db => voidBill(db, actorOf(req), (req.params as any).id, reason));
    return { ok: true };
  });

  // ───── Receipts & payments ─────
  app.get('/payments', { preHandler: can('banking.view') }, async req => {
    const q = parse(listQuery.extend({ direction: z.enum(['IN', 'OUT']).optional() }), req.query);
    const where = {
      ...dateWhere(q), ...(q.direction ? { direction: q.direction } : {}), ...(q.partyId ? { partyId: q.partyId } : {}), ...(q.status ? { status: { in: q.status.split(',') } } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search } }, { party: { name: { contains: q.search } } }, { notes: { contains: q.search } }, { reference: { contains: q.search } }] } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.payment.findMany({ where, include: { party: { select: { id: true, name: true } }, allocations: true }, orderBy: [{ date: 'desc' }, { number: 'desc' }], ...page(q) }),
      prisma.payment.count({ where }),
    ]);
    return { data, total };
  });
  app.post('/payments', { preHandler: can('banking.view') }, async req => {
    const body = parse(z.object({
      direction: z.enum(['IN', 'OUT']), date: zDate, partyId: zOptText(40), cashAccountId: zId, counterAccountId: zOptText(40), amount: zMoney,
      method: z.enum(PAYMENT_METHODS).optional(), reference: zOptText(60), notes: zOptText(500),
      allocations: z.array(z.object({ invoiceId: z.string().optional(), billId: z.string().optional(), amount: zMoney })).default([]),
    }), req.body);
    // Receipts need sales rights, payments purchase rights, other money movements banking rights.
    const perm = body.counterAccountId ? 'banking.manage' : body.direction === 'IN' ? 'sales.create' : 'purchases.create';
    await can(perm)(req, undefined as any);
    return tx(db => createPayment(db, actorOf(req), body));
  });
  app.post('/payments/:id/void', { preHandler: can('banking.manage') }, async req => {
    const { reason } = parse(zReason, req.body);
    await tx(db => voidPayment(db, actorOf(req), (req.params as any).id, reason));
    return { ok: true };
  });

  app.post('/transfers', { preHandler: can('banking.manage') }, async req => {
    const body = parse(z.object({ date: zDate, fromAccountId: zId, toAccountId: zId, amount: zMoney, memo: z.string().max(200).optional() }), req.body);
    return tx(db => transfer(db, actorOf(req), body));
  });

  app.get('/cash-counts', { preHandler: can('banking.view') }, async () => ({ data: await prisma.cashCount.findMany({ orderBy: { date: 'desc' }, take: 100 }) }));
  app.post('/cash-counts', { preHandler: can('banking.manage') }, async req => {
    const body = parse(z.object({ date: zDate, accountId: zId, counted: zMoney, notes: zOptText(300), postVariance: z.boolean().default(false) }), req.body);
    return tx(db => cashCount(db, actorOf(req), body));
  });

  // ───── Manual journals ─────
  app.get('/journals', { preHandler: can('accounting.view') }, async req => {
    const q = parse(listQuery.extend({ sourceType: z.string().optional() }), req.query);
    const where = {
      ...dateWhere(q), ...(q.sourceType ? { sourceType: { in: q.sourceType.split(',') } } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search } }, { memo: { contains: q.search } }] } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.journalEntry.findMany({ where, include: { lines: { include: { account: { select: { code: true, name: true } }, party: { select: { name: true } } } } }, orderBy: [{ date: 'desc' }, { number: 'desc' }], ...page(q) }),
      prisma.journalEntry.count({ where }),
    ]);
    return { data, total };
  });
  app.post('/journals', { preHandler: can('accounting.manage') }, async req => {
    const body = parse(z.object({
      date: zDate, memo: z.string().trim().min(3).max(300), opening: z.boolean().default(false),
      lines: z.array(z.object({ accountId: zId, debit: zMoney.default(0), credit: zMoney.default(0), partyId: zOptText(40), memo: zOptText(200) })).min(2).max(100),
    }), req.body);
    return tx(async db => {
      const je = await postEntry(db, actorOf(req), { date: body.date, memo: body.memo, sourceType: body.opening ? 'OPENING' : 'MANUAL', lines: body.lines });
      await audit(db, actorOf(req), 'create', 'journal', je.id, `Journal ${je.number}: ${body.memo}`);
      return je;
    });
  });
  app.post('/journals/:id/void', { preHandler: can('accounting.manage') }, async req => {
    const { reason } = parse(zReason, req.body);
    const id = (req.params as any).id;
    const je = await prisma.journalEntry.findUnique({ where: { id } });
    if (!je) throw notFound('Journal');
    if (!['MANUAL', 'OPENING', 'TRANSFER'].includes(je.sourceType)) {
      throw conflict('Void the source document (invoice, bill, payment or production record) instead.');
    }
    await tx(async db => {
      await reverseEntry(db, actorOf(req), id, reason);
      await audit(db, actorOf(req), 'void', 'journal', id, `Voided ${je.number}: ${reason}`);
    });
    return { ok: true };
  });

  // ───── Inventory adjustments ─────
  app.post('/stock-adjustments', { preHandler: can('inventory.manage') }, async req => {
    const body = parse(z.object({ date: zDate, itemId: zId, type: z.enum(ADJUSTMENT_TYPES), quantity: zQty, unitCost: zMoney.optional(), notes: zOptText(300) }), req.body);
    return tx(db => adjustStock(db, actorOf(req), body));
  });
  app.get('/stock-moves', { preHandler: can('inventory.view') }, async req => {
    const q = parse(listQuery.extend({ itemId: z.string().optional(), type: z.string().optional() }), req.query);
    const where = { ...dateWhere(q), ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.type ? { type: { in: q.type.split(',') } } : {}) };
    const [data, total] = await Promise.all([
      prisma.stockMove.findMany({ where, include: { item: { select: { name: true, unit: true, sku: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], ...page(q) }),
      prisma.stockMove.count({ where }),
    ]);
    return { data, total };
  });

  // ───── Production ─────
  app.get('/production', { preHandler: can('production.view') }, async req => {
    const q = parse(listQuery.extend({ flockId: z.string().optional() }), req.query);
    const where = { ...dateWhere(q), ...(q.flockId ? { flockId: q.flockId } : {}), ...(q.status ? { status: { in: q.status.split(',') } } : {}) };
    const [data, total] = await Promise.all([
      prisma.productionLog.findMany({ where, include: { flock: { select: { code: true, name: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], ...page(q) }),
      prisma.productionLog.count({ where }),
    ]);
    return { data, total };
  });
  app.post('/production', { preHandler: can('production.manage') }, async req => {
    const body = parse(z.object({
      date: zDate, flockId: zId, eggItemId: zOptText(40), eggsCollected: z.coerce.number().int().min(0), eggsBroken: z.coerce.number().int().min(0).default(0),
      mortality: z.coerce.number().int().min(0).default(0), culled: z.coerce.number().int().min(0).default(0), feedItemId: zOptText(40),
      feedQty: z.coerce.number().min(0).default(0), waterLitres: z.coerce.number().min(0).nullish(), notes: zOptText(300),
    }), req.body);
    return tx(db => recordProduction(db, actorOf(req), body));
  });
  app.post('/production/:id/void', { preHandler: can('production.manage') }, async req => {
    const { reason } = parse(zReason, req.body);
    await tx(db => voidProduction(db, actorOf(req), (req.params as any).id, reason));
    return { ok: true };
  });
}
