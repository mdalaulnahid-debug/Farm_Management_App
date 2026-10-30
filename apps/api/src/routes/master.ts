// Organization settings and master data: chart of accounts, customers/suppliers, items, sites, flocks.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { parse, zDate, zOptDate, zOptText } from '../lib/validate.js';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, CASH_FLOW, ITEM_CATEGORIES, PARTY_KINDS } from '../lib/constants.js';
import { audit } from '../services/common.js';
import { actorOf, can } from '../auth/auth.js';
import { accountBalance, clearAccountCache } from '../services/ledger.js';
import { round2, num } from '../lib/money.js';
import { normalizePhone } from '../lib/phone.js';

export default async function masterRoutes(app: FastifyInstance) {
  // ───── Organization ─────
  app.get('/settings', { preHandler: can() }, async () => prisma.organization.findUnique({ where: { id: 'org' } }));

  app.put('/settings', { preHandler: can('settings.manage') }, async req => {
    const body = parse(z.object({
      name: z.string().trim().min(2).max(120), legalName: zOptText(160), address: zOptText(300), phone: zOptText(40),
      email: zOptText(120), taxId: zOptText(60), fiscalYearStart: z.coerce.number().int().min(1).max(12), invoiceFooter: zOptText(500),
    }), req.body);
    const org = await prisma.organization.update({ where: { id: 'org' }, data: body });
    await audit(prisma, actorOf(req), 'update', 'settings', 'org', 'Updated organization settings', body);
    return org;
  });

  app.put('/settings/lock-date', { preHandler: can('settings.manage') }, async req => {
    const body = parse(z.object({ lockDate: zOptDate }), req.body);
    const org = await prisma.organization.update({ where: { id: 'org' }, data: { lockDate: body.lockDate ?? null } });
    await audit(prisma, actorOf(req), 'update', 'settings', 'org', body.lockDate ? `Closed books up to ${body.lockDate.toISOString().slice(0, 10)}` : 'Reopened all periods');
    return org;
  });

  // ───── Chart of accounts ─────
  app.get('/accounts', { preHandler: can() }, async req => {
    const q = req.query as { withBalance?: string; subtype?: string };
    const accounts = await prisma.account.findMany({ where: q.subtype ? { subtype: { in: q.subtype.split(',') } } : {}, orderBy: { code: 'asc' } });
    if (!q.withBalance) return { data: accounts };
    const sums = await prisma.journalLine.groupBy({ by: ['accountId'], where: { entry: { status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    const m = new Map(sums.map(s => [s.accountId, round2(num(s._sum.debit) - num(s._sum.credit))]));
    return { data: accounts.map(a => ({ ...a, balance: ['ASSET', 'EXPENSE'].includes(a.type) ? (m.get(a.id) ?? 0) : -(m.get(a.id) ?? 0) })) };
  });

  const accountBody = z.object({
    code: z.string().trim().regex(/^\d{3,6}$/, 'Code must be 3–6 digits'), name: z.string().trim().min(2).max(100), nameBn: zOptText(100),
    type: z.enum(ACCOUNT_TYPES), subtype: z.enum(ACCOUNT_SUBTYPES), cashFlow: z.enum(CASH_FLOW).default('OPERATING'),
    parentId: zOptText(40), description: zOptText(300), active: z.boolean().default(true),
  });

  app.post('/accounts', { preHandler: can('accounting.manage') }, async req => {
    const body = parse(accountBody, req.body);
    if (await prisma.account.findUnique({ where: { code: body.code } })) throw conflict(`Account code ${body.code} is already used.`);
    const acc = await prisma.account.create({ data: body });
    await audit(prisma, actorOf(req), 'create', 'account', acc.id, `Account ${acc.code} ${acc.name}`);
    return acc;
  });

  app.put('/accounts/:id', { preHandler: can('accounting.manage') }, async req => {
    const { id } = req.params as { id: string };
    const body = parse(accountBody, req.body);
    const acc = await prisma.account.findUnique({ where: { id } });
    if (!acc) throw notFound('Account');
    if (acc.system && (body.code !== acc.code || body.type !== acc.type || body.subtype !== acc.subtype || !body.active)) {
      throw conflict('System accounts can be renamed but their code, type and status are fixed.');
    }
    if (acc.type !== body.type && (await prisma.journalLine.count({ where: { accountId: id } }))) throw conflict('Cannot change the type of an account that has postings.');
    const updated = await prisma.account.update({ where: { id }, data: body });
    clearAccountCache();
    await audit(prisma, actorOf(req), 'update', 'account', id, `Account ${updated.code} ${updated.name}`);
    return updated;
  });

  // ───── Customers, suppliers, employees ─────
  app.get('/parties', { preHandler: can() }, async req => {
    const q = req.query as { kind?: string; search?: string; withBalance?: string };
    const kinds = q.kind === 'CUSTOMER' ? ['CUSTOMER', 'BOTH'] : q.kind === 'SUPPLIER' ? ['SUPPLIER', 'BOTH'] : q.kind ? [q.kind] : undefined;
    const parties = await prisma.party.findMany({
      where: { ...(kinds ? { kind: { in: kinds } } : {}), ...(q.search ? { OR: [{ name: { contains: q.search } }, { phone: { contains: q.search } }] } : {}) },
      orderBy: { name: 'asc' },
    });
    if (!q.withBalance) return { data: parties };
    const [ar, ap] = await Promise.all([
      prisma.salesInvoice.groupBy({ by: ['customerId'], where: { status: { in: ['POSTED', 'PARTIAL'] } }, _sum: { total: true, amountPaid: true } }),
      prisma.bill.groupBy({ by: ['supplierId'], where: { status: { in: ['POSTED', 'PARTIAL'] } }, _sum: { total: true, amountPaid: true } }),
    ]);
    const arMap = new Map(ar.map(r => [r.customerId, round2(num(r._sum.total) - num(r._sum.amountPaid))]));
    const apMap = new Map(ap.map(r => [r.supplierId, round2(num(r._sum.total) - num(r._sum.amountPaid))]));
    return { data: parties.map(p => ({ ...p, receivable: arMap.get(p.id) ?? 0, payable: apMap.get(p.id) ?? 0 })) };
  });

  // Live lookup while typing a buyer's phone on a চালান.
  app.get('/parties/lookup', { preHandler: can('sales.view') }, async req => {
    const phone = normalizePhone((req.query as { phone?: string }).phone);
    if (!phone || phone.length < 6) return { match: null };
    const parties = await prisma.party.findMany({ where: { kind: { in: ['CUSTOMER', 'BOTH'] }, phone: { not: null } } });
    const match = parties.find(p => normalizePhone(p.phone) === phone);
    return { match: match ? { id: match.id, name: match.name, phone: match.phone } : null, phone };
  });

  app.get('/parties/:id', { preHandler: can() }, async req => {
    const { id } = req.params as { id: string };
    const party = await prisma.party.findUnique({ where: { id } });
    if (!party) throw notFound('Contact');
    const [invoices, bills, payments] = await Promise.all([
      prisma.salesInvoice.findMany({ where: { customerId: id }, orderBy: { date: 'desc' }, take: 100 }),
      prisma.bill.findMany({ where: { supplierId: id }, orderBy: { date: 'desc' }, take: 100 }),
      prisma.payment.findMany({ where: { partyId: id }, orderBy: { date: 'desc' }, take: 100 }),
    ]);
    return { party, invoices, bills, payments };
  });

  const partyBody = z.object({
    kind: z.enum(PARTY_KINDS), name: z.string().trim().min(2).max(120), phone: zOptText(40), email: zOptText(120), address: zOptText(300),
    taxId: zOptText(60), creditLimit: z.coerce.number().min(0).nullish(), paymentTerms: z.coerce.number().int().min(0).max(365).default(0),
    notes: zOptText(500), active: z.boolean().default(true),
  });
  app.post('/parties', { preHandler: can('parties.manage') }, async req => {
    const body = parse(partyBody, req.body);
    const p = await prisma.party.create({ data: { ...body, phone: normalizePhone(body.phone) } });
    await audit(prisma, actorOf(req), 'create', 'party', p.id, `${p.kind.toLowerCase()} ${p.name}`);
    return p;
  });
  app.put('/parties/:id', { preHandler: can('parties.manage') }, async req => {
    const { id } = req.params as { id: string };
    const body = parse(partyBody, req.body);
    const p = await prisma.party.update({ where: { id }, data: { ...body, phone: normalizePhone(body.phone) } });
    await audit(prisma, actorOf(req), 'update', 'party', id, `Updated ${p.name}`);
    return p;
  });

  // ───── Items ─────
  app.get('/items', { preHandler: can() }, async req => {
    const q = req.query as { category?: string };
    return { data: await prisma.item.findMany({ where: q.category ? { category: { in: q.category.split(',') } } : {}, orderBy: [{ category: 'asc' }, { name: 'asc' }] }) };
  });

  const itemBody = z.object({
    sku: z.string().trim().min(2).max(30), barcode: zOptText(64), name: z.string().trim().min(2).max(100), nameBn: zOptText(100), category: z.enum(ITEM_CATEGORIES),
    unit: z.string().trim().min(1).max(20), salePrice: z.coerce.number().min(0).default(0), purchasePrice: z.coerce.number().min(0).default(0),
    trackInventory: z.boolean().default(true), valued: z.boolean().default(true), reorderLevel: z.coerce.number().min(0).default(0),
    incomeAccountId: zOptText(40), expenseAccountId: zOptText(40), inventoryAccountId: zOptText(40), active: z.boolean().default(true),
  });
  app.post('/items', { preHandler: can('inventory.manage') }, async req => {
    const body = parse(itemBody, req.body);
    if (await prisma.item.findUnique({ where: { sku: body.sku } })) throw conflict(`SKU ${body.sku} is already used.`);
    if (body.barcode && (await prisma.item.findFirst({ where: { barcode: body.barcode } }))) throw conflict(`Barcode ${body.barcode} is already used.`);
    const item = await prisma.item.create({ data: body });
    await audit(prisma, actorOf(req), 'create', 'item', item.id, `Item ${item.sku} ${item.name}`);
    return item;
  });
  app.put('/items/:id', { preHandler: can('inventory.manage') }, async req => {
    const { id } = req.params as { id: string };
    const body = parse(itemBody, req.body);
    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing) throw notFound('Item');
    if (body.barcode && (await prisma.item.findFirst({ where: { barcode: body.barcode, id: { not: id } } }))) throw conflict(`Barcode ${body.barcode} is already used.`);
    if ((existing.valued !== body.valued || existing.trackInventory !== body.trackInventory) && (await prisma.stockMove.count({ where: { itemId: id } }))) {
      throw conflict('Stock tracking and valuation cannot change after stock movements exist.');
    }
    const item = await prisma.item.update({ where: { id }, data: body });
    await audit(prisma, actorOf(req), 'update', 'item', id, `Updated ${item.name}`);
    return item;
  });
  app.get('/items/:id/moves', { preHandler: can('inventory.view') }, async req => {
    const { id } = req.params as { id: string };
    return { data: await prisma.stockMove.findMany({ where: { itemId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 300 }) };
  });

  // ───── Sites & flocks ─────
  app.get('/sites', { preHandler: can() }, async () => ({ data: await prisma.site.findMany({ orderBy: { name: 'asc' } }) }));
  app.post('/sites', { preHandler: can('production.manage') }, async req => {
    const body = parse(z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(['FARM', 'SHED', 'POND', 'STORE']).default('SHED'), notes: zOptText(300) }), req.body);
    return prisma.site.create({ data: body });
  });

  app.get('/flocks', { preHandler: can('production.view') }, async () => ({ data: await prisma.flock.findMany({ orderBy: [{ status: 'asc' }, { startDate: 'desc' }], include: { site: true } }) }));
  const flockBody = z.object({
    code: z.string().trim().min(2).max(20), name: z.string().trim().min(2).max(80), species: z.string().trim().default('DUCK'), breed: zOptText(60),
    siteId: zOptText(40), startDate: zDate, openingCount: z.coerce.number().int().min(0), notes: zOptText(300),
  });
  app.post('/flocks', { preHandler: can('production.manage') }, async req => {
    const body = parse(flockBody, req.body);
    if (await prisma.flock.findUnique({ where: { code: body.code } })) throw conflict(`Flock code ${body.code} is already used.`);
    const flock = await prisma.flock.create({ data: { ...body, currentCount: body.openingCount } });
    await audit(prisma, actorOf(req), 'create', 'flock', flock.id, `Flock ${flock.code} with ${flock.openingCount} birds`);
    return flock;
  });
  app.put('/flocks/:id', { preHandler: can('production.manage') }, async req => {
    const { id } = req.params as { id: string };
    const body = parse(flockBody.omit({ openingCount: true }).extend({ status: z.enum(['ACTIVE', 'CLOSED']), currentCount: z.coerce.number().int().min(0) }), req.body);
    const flock = await prisma.flock.update({ where: { id }, data: body });
    await audit(prisma, actorOf(req), 'update', 'flock', id, `Updated flock ${flock.code}`);
    return flock;
  });

  app.get('/cash-accounts', { preHandler: can() }, async () => {
    const accounts = await prisma.account.findMany({ where: { subtype: { in: ['CASH', 'BANK'] }, active: true }, orderBy: { code: 'asc' } });
    return { data: await Promise.all(accounts.map(async a => ({ ...a, balance: await accountBalance(prisma, a.id) }))) };
  });
}
