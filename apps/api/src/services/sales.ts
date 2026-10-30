// Sales invoices: revenue, receivables, stock issue and (optionally) cash received at the counter.
import type { Db } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { money, qty as q3, round2, sum } from '../lib/money.js';
import { addDays } from '../lib/dates.js';
import { SYS } from '../lib/constants.js';
import { accountId, postEntry, reverseEntry, type LineInput } from './ledger.js';
import { issueStock, reverseStockForSource } from './inventory.js';
import { createPayment } from './payments.js';
import { audit, nextNumber, type Actor } from './common.js';
import { normalizePhone } from '../lib/phone.js';

/**
 * Find the buyer by phone (any format), else by exact name; create them in the customer list if new.
 * With neither, the sale goes to the "Walk-in customers" account.
 */
export async function resolveCustomer(db: Db, actor: Actor | null, c: { name?: string | null; phone?: string | null }) {
  const phone = normalizePhone(c.phone);
  const name = c.name?.trim() || null;
  const customers = { kind: { in: ['CUSTOMER', 'BOTH'] } };
  if (phone) {
    const withPhone = await db.party.findMany({ where: { ...customers, phone: { not: null } } });
    const hit = withPhone.find(p => normalizePhone(p.phone) === phone);
    if (hit) return { party: hit, created: false };
  } else if (name) {
    const hit = (await db.party.findMany({ where: { ...customers } })).find(p => p.name.toLowerCase() === name.toLowerCase());
    if (hit) return { party: hit, created: false };
  } else {
    const walkIn = (await db.party.findFirst({ where: { name: 'Walk-in customers' } }))
      ?? (await db.party.create({ data: { kind: 'CUSTOMER', name: 'Walk-in customers', notes: 'Counter / cash sales without a named customer.' } }));
    return { party: walkIn, created: false };
  }
  const party = await db.party.create({ data: { kind: 'CUSTOMER', name: name ?? phone!, phone } });
  await audit(db, actor, 'create', 'party', party.id, `Customer ${party.name}${phone ? ` (${phone})` : ''} added from a sales চালান`);
  return { party, created: true };
}

export interface InvoiceInput {
  date: Date;
  dueDate?: Date | null;
  /** Either an existing customer id, or the buyer's name/phone (matched or added automatically). */
  customerId?: string | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  lines: { itemId?: string | null; description?: string; quantity: number; unitPrice: number; accountId?: string | null }[];
  discount?: number;
  reference?: string | null;
  notes?: string | null;
  /** Cash received with the sale. */
  received?: { amount: number; cashAccountId: string; method?: string } | null;
}

export async function createInvoice(db: Db, actor: Actor | null, input: InvoiceInput) {
  const customer = input.customerId
    ? await db.party.findUnique({ where: { id: input.customerId } })
    : (await resolveCustomer(db, actor, input.customer ?? {})).party;
  if (!customer || !['CUSTOMER', 'BOTH'].includes(customer.kind)) throw badRequest('Choose a valid customer.');
  if (!input.lines.length) throw badRequest('Add at least one line.');

  const defaultIncome = await accountId(db, SYS.SALES_OTHER);
  const lines = [] as { itemId: string | null; description: string; quantity: number; unitPrice: number; amount: number; accountId: string }[];
  for (const l of input.lines) {
    const item = l.itemId ? await db.item.findUnique({ where: { id: l.itemId } }) : null;
    if (l.itemId && !item) throw badRequest('Unknown item on invoice line.');
    const quantity = q3(l.quantity);
    const unitPrice = money(l.unitPrice);
    if (quantity <= 0) throw badRequest('Line quantity must be greater than zero.');
    if (unitPrice < 0) throw badRequest('Unit price cannot be negative.');
    lines.push({
      itemId: item?.id ?? null, description: l.description || item?.name || 'Sale', quantity, unitPrice,
      amount: round2(quantity * unitPrice), accountId: l.accountId || item?.incomeAccountId || defaultIncome,
    });
  }
  const subtotal = sum(lines.map(l => l.amount));
  const discount = money(input.discount);
  if (discount < 0 || discount > subtotal) throw badRequest('Discount must be between zero and the subtotal.');
  const total = round2(subtotal - discount);

  const number = await nextNumber(db, 'INV');
  const invoice = await db.salesInvoice.create({
    data: {
      number, date: input.date, dueDate: input.dueDate ?? addDays(input.date, customer.paymentTerms),
      customerId: customer.id, subtotal, discount, total, reference: input.reference ?? null, notes: input.notes ?? null,
      createdById: actor?.id ?? null, lines: { create: lines },
    },
  });

  // Revenue + receivable.
  const je: LineInput[] = [{ accountId: await accountId(db, SYS.AR), debit: total, partyId: customer.id, memo: number }];
  if (discount > 0) je.push({ accountId: await accountId(db, SYS.SALES_DISCOUNT), debit: discount });
  for (const l of lines) je.push({ accountId: l.accountId, credit: l.amount, memo: l.description });

  // Stock issue and cost of goods sold for valued items.
  for (const l of lines) {
    if (!l.itemId) continue;
    const res = await issueStock(db, { itemId: l.itemId, date: input.date, type: 'SALE', quantity: l.quantity, sourceType: 'INVOICE', sourceId: invoice.id, createdById: actor?.id });
    if (res.value > 0 && res.item) {
      je.push({ accountId: res.item.expenseAccountId || (await accountId(db, SYS.COGS)), debit: res.value, memo: `Cost of ${l.description}` });
      je.push({ accountId: res.item.inventoryAccountId || (await accountId(db, SYS.INV_SUPPLIES)), credit: res.value });
    }
  }
  const entry = await postEntry(db, actor, { date: input.date, memo: `Sales invoice ${number} — ${customer.name}`, sourceType: 'INVOICE', sourceId: invoice.id, lines: je });
  await db.salesInvoice.update({ where: { id: invoice.id }, data: { journalEntryId: entry.id } });
  await audit(db, actor, 'create', 'invoice', invoice.id, `Invoice ${number} for ${customer.name}: ${total}`);

  if (input.received && money(input.received.amount) > 0) {
    const amount = Math.min(money(input.received.amount), total);
    if (amount > 0) await createPayment(db, actor, {
      direction: 'IN', date: input.date, partyId: customer.id, cashAccountId: input.received.cashAccountId,
      amount, method: input.received.method, notes: `Received with ${number}`, allocations: [{ invoiceId: invoice.id, amount }],
    });
  }
  return db.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true, customer: true } });
}

export async function voidInvoice(db: Db, actor: Actor | null, id: string, reason: string) {
  const inv = await db.salesInvoice.findUnique({ where: { id }, include: { allocations: { include: { payment: true } } } });
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'VOID') throw conflict('This invoice is already void.');
  const livePayments = inv.allocations.filter(a => a.payment.status !== 'VOID');
  if (livePayments.length) throw conflict(`Void the receipts applied to this invoice first (${livePayments.map(a => a.payment.number).join(', ')}).`);
  await reverseStockForSource(db, 'INVOICE', id);
  if (inv.journalEntryId) await reverseEntry(db, actor, inv.journalEntryId, reason);
  await db.salesInvoice.update({ where: { id }, data: { status: 'VOID', notes: [inv.notes, `VOID: ${reason}`].filter(Boolean).join(' · ') } });
  await audit(db, actor, 'void', 'invoice', id, `Voided ${inv.number}: ${reason}`);
}
