// Money received from customers / paid to suppliers, and any other cash movement
// against a counter account (owner capital, loans, other income...).
import type { Db } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { money, round2, sum, isZero } from '../lib/money.js';
import { SYS } from '../lib/constants.js';
import { accountId, postEntry, reverseEntry } from './ledger.js';
import { audit, nextNumber, type Actor } from './common.js';

export interface PaymentInput {
  direction: 'IN' | 'OUT';
  date: Date;
  partyId?: string | null;
  cashAccountId: string;
  counterAccountId?: string | null;
  amount: number;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  allocations?: { invoiceId?: string; billId?: string; amount: number }[];
  /** Business line for both lines of the entry (defaults to the main project). */
  projectId?: string | null;
}

const statusFor = (total: number, paid: number) => (isZero(paid) ? 'POSTED' : paid + 0.005 >= total ? 'PAID' : 'PARTIAL');

export async function createPayment(db: Db, actor: Actor | null, input: PaymentInput) {
  const amount = money(input.amount);
  if (amount <= 0) throw badRequest('Amount must be greater than zero.');
  const cash = await db.account.findUnique({ where: { id: input.cashAccountId } });
  if (!cash || !['CASH', 'BANK'].includes(cash.subtype)) throw badRequest('Choose a cash or bank account.');

  const allocations = (input.allocations ?? []).filter(a => money(a.amount) > 0);
  const allocated = sum(allocations.map(a => a.amount));
  if (allocated - amount > 0.005) throw badRequest('Allocated amount is more than the payment amount.');

  let counterAccountId = input.counterAccountId ?? null;
  if (!counterAccountId) {
    if (!input.partyId) throw badRequest('Choose a customer/supplier or the account this money belongs to.');
    counterAccountId = await accountId(db, input.direction === 'IN' ? SYS.AR : SYS.AP);
  }
  if (allocations.length && input.direction === 'IN' && !input.partyId) throw badRequest('Receipt allocations require a customer.');

  // Validate and apply allocations against open documents of the same party.
  for (const a of allocations) {
    const amt = money(a.amount);
    if (input.direction === 'IN') {
      const inv = a.invoiceId ? await db.salesInvoice.findUnique({ where: { id: a.invoiceId } }) : null;
      if (!inv || inv.customerId !== input.partyId || inv.status === 'VOID') throw badRequest('Invalid invoice allocation.');
      const open = round2(Number(inv.total) - Number(inv.amountPaid));
      if (amt - open > 0.005) throw badRequest(`Invoice ${inv.number} has only ${open} outstanding.`);
      const paid = round2(Number(inv.amountPaid) + amt);
      await db.salesInvoice.update({ where: { id: inv.id }, data: { amountPaid: paid, status: statusFor(Number(inv.total), paid) } });
    } else {
      const bill = a.billId ? await db.bill.findUnique({ where: { id: a.billId } }) : null;
      if (!bill || (bill.supplierId ?? null) !== (input.partyId ?? null) || bill.status === 'VOID') throw badRequest('Invalid bill allocation.');
      const open = round2(Number(bill.total) - Number(bill.amountPaid));
      if (amt - open > 0.005) throw badRequest(`Bill ${bill.number} has only ${open} outstanding.`);
      const paid = round2(Number(bill.amountPaid) + amt);
      await db.bill.update({ where: { id: bill.id }, data: { amountPaid: paid, status: statusFor(Number(bill.total), paid) } });
    }
  }

  const number = await nextNumber(db, input.direction === 'IN' ? 'RCPT' : 'PAY');
  const payment = await db.payment.create({
    data: {
      number, date: input.date, direction: input.direction, partyId: input.partyId ?? null,
      cashAccountId: cash.id, counterAccountId, amount, method: input.method ?? (cash.subtype === 'BANK' ? 'BANK' : 'CASH'),
      reference: input.reference ?? null, notes: input.notes ?? null, createdById: actor?.id ?? null,
      allocations: { create: allocations.map(a => ({ invoiceId: a.invoiceId ?? null, billId: a.billId ?? null, amount: money(a.amount) })) },
    },
  });

  const memo = `${input.direction === 'IN' ? 'Receipt' : 'Payment'} ${number}${input.notes ? ` — ${input.notes}` : ''}`;
  const lines = input.direction === 'IN'
    ? [{ accountId: cash.id, debit: amount, projectId: input.projectId }, { accountId: counterAccountId, credit: amount, partyId: input.partyId, projectId: input.projectId }]
    : [{ accountId: counterAccountId, debit: amount, partyId: input.partyId, projectId: input.projectId }, { accountId: cash.id, credit: amount, projectId: input.projectId }];
  const je = await postEntry(db, actor, { date: input.date, memo, sourceType: 'PAYMENT', sourceId: payment.id, lines });
  await db.payment.update({ where: { id: payment.id }, data: { journalEntryId: je.id } });
  await audit(db, actor, 'create', 'payment', payment.id, `${memo} (${amount})`);
  return db.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: true, party: true } });
}

export async function voidPayment(db: Db, actor: Actor | null, id: string, reason: string) {
  const p = await db.payment.findUnique({ where: { id }, include: { allocations: true } });
  if (!p) throw notFound('Payment');
  if (p.status === 'VOID') throw conflict('This payment is already void.');
  for (const a of p.allocations) {
    if (a.invoiceId) {
      const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      const paid = round2(Number(inv.amountPaid) - Number(a.amount));
      await db.salesInvoice.update({ where: { id: inv.id }, data: { amountPaid: paid, status: inv.status === 'VOID' ? 'VOID' : statusFor(Number(inv.total), paid) } });
    }
    if (a.billId) {
      const bill = await db.bill.findUniqueOrThrow({ where: { id: a.billId } });
      const paid = round2(Number(bill.amountPaid) - Number(a.amount));
      await db.bill.update({ where: { id: bill.id }, data: { amountPaid: paid, status: bill.status === 'VOID' ? 'VOID' : statusFor(Number(bill.total), paid) } });
    }
  }
  if (p.journalEntryId) await reverseEntry(db, actor, p.journalEntryId, reason);
  await db.payment.update({ where: { id }, data: { status: 'VOID', notes: [p.notes, `VOID: ${reason}`].filter(Boolean).join(' · ') } });
  await audit(db, actor, 'void', 'payment', id, `Voided ${p.number}: ${reason}`);
}

export { statusFor };
