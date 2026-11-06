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

export const WALK_IN = 'Walk-in customers';
export const WALK_IN_KEY = 'WALK_IN';
/** The walk-in party, by its system key only (tagged at start-up, see ensureWalkInKey). A brand-new book with no
 *  walk-in party gets one; an untagged one is never guessed at. */
export async function walkInParty(db: Db) {
  const keyed = await db.party.findUnique({ where: { systemKey: WALK_IN_KEY } });
  if (keyed) return keyed;
  if (await db.party.count({ where: { name: WALK_IN } })) throw badRequest('"Walk-in customers" is not set up yet. Restart the server, or ask the admin to check the start-up warning.');
  return db.party.create({ data: { kind: 'CUSTOMER', name: WALK_IN, systemKey: WALK_IN_KEY, notes: 'Counter / cash sales without a named customer.' } });
}
const isWalkIn = (p: { systemKey: string | null }) => p.systemKey === WALK_IN_KEY;

/** Start-up and seed, idempotent: mark the walk-in party with its system key. One already marked: nothing to do.
 *  Else exactly one party named "Walk-in customers": mark it. None or several: warn and leave it to the admin. */
export async function ensureWalkInKey(db: Db, log: { warn: (m: string) => void }) {
  if (await db.party.count({ where: { systemKey: WALK_IN_KEY } }) === 1) return 'ok';
  const named = await db.party.findMany({ where: { name: WALK_IN, kind: { in: ['CUSTOMER', 'BOTH'] } }, select: { id: true } });
  if (named.length === 1) { await db.party.update({ where: { id: named[0].id }, data: { systemKey: WALK_IN_KEY } }); return 'tagged'; }
  if (named.length > 1) log.warn(`${named.length} customers are named "Walk-in customers"; none was marked as the walk-in account. Merge or rename them, then restart.`);
  return named.length ? 'ambiguous' : 'none';
}
/** A Bangladeshi mobile number in its canonical form: 11 digits starting 01. */
export const isMobile = (p: string | null) => !!p && /^01\d{9}$/.test(p);

/**
 * The owner's rule: a buyer is known by their mobile number, which stays their identity even when the name is
 * typed differently. A typed phone that matches a customer is that customer (the typed name is ignored); a new
 * phone needs a name too and adds the customer. Without a phone the sale is a walk-in sale (cash only), and a
 * typed name is only noted on the invoice.
 */
export async function resolveCustomer(db: Db, actor: Actor | null, c: { name?: string | null; phone?: string | null }) {
  const name = c.name?.trim() || null;
  const typed = c.phone?.trim() || null;
  const phone = normalizePhone(typed);
  if (typed && !isMobile(phone)) throw badRequest('The mobile number must have 11 digits and start with 01, like 01711-223344.');
  if (phone) {
    const customers = await db.party.findMany({ where: { kind: { in: ['CUSTOMER', 'BOTH'] }, phone: { not: null } } });
    const hits = customers.filter(p => normalizePhone(p.phone) === phone);
    if (hits.length > 1) throw badRequest(`Two customers have the mobile number ${phone} (${hits.map(h => h.name).join(', ')}). Ask the owner to fix this in Customers first.`);
    const hit = hits[0];
    if (hit) return { party: hit, created: false, buyerName: null as string | null };
    if (!name) throw badRequest('A new buyer needs a name with the mobile number.');
    const party = await db.party.create({ data: { kind: 'CUSTOMER', name, phone } });
    await audit(db, actor, 'create', 'party', party.id, `Customer ${party.name} (${phone}) added from a sales চালান`);
    return { party, created: true, buyerName: null };
  }
  return { party: await walkInParty(db), created: false, buyerName: name };
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
  const resolved = input.customerId ? null : await resolveCustomer(db, actor, input.customer ?? {});
  const customer = input.customerId ? await db.party.findUnique({ where: { id: input.customerId } }) : resolved!.party;
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
  // Walk-in buyers pay in full: money owed must be owed by a known customer (name and mobile number).
  if (isWalkIn(customer) && total - money(input.received?.amount ?? 0) > 0.005) {
    throw badRequest('Walk-in buyers pay in full. To sell on credit, give the buyer\'s name and mobile number.');
  }
  const notes = [input.notes?.trim(), resolved?.buyerName ? `Buyer: ${resolved.buyerName}` : null].filter(Boolean).join(' · ') || null;

  const number = await nextNumber(db, 'INV');
  const invoice = await db.salesInvoice.create({
    data: {
      number, date: input.date, dueDate: input.dueDate ?? addDays(input.date, customer.paymentTerms),
      customerId: customer.id, subtotal, discount, total, reference: input.reference ?? null, notes,
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
