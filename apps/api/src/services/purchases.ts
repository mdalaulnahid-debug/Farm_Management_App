// Supplier bills and direct expenses. Stocked items go to inventory; everything else is
// debited to the line's expense (or asset) account. Payables are cleared by payments.
import type { Db } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { money, qty as q3, round2, sum } from '../lib/money.js';
import { addDays } from '../lib/dates.js';
import { SYS } from '../lib/constants.js';
import { accountId, postEntry, reverseEntry, type LineInput } from './ledger.js';
import { receiveStock, reverseStockForSource } from './inventory.js';
import { createPayment } from './payments.js';
import { audit, nextNumber, type Actor } from './common.js';

export interface BillInput {
  date: Date;
  dueDate?: Date | null;
  supplierId?: string | null;
  lines: { itemId?: string | null; accountId?: string | null; description?: string; quantity: number; unitPrice: number }[];
  reference?: string | null;
  notes?: string | null;
  /** Paid immediately (cash expense). */
  paid?: { amount: number; cashAccountId: string; method?: string } | null;
}

export async function createBill(db: Db, actor: Actor | null, input: BillInput) {
  const supplier = input.supplierId ? await db.party.findUnique({ where: { id: input.supplierId } }) : null;
  if (input.supplierId && (!supplier || !['SUPPLIER', 'BOTH', 'EMPLOYEE'].includes(supplier.kind))) throw badRequest('Choose a valid supplier.');
  if (!input.lines.length) throw badRequest('Add at least one line.');

  const lines = [] as { itemId: string | null; accountId: string; description: string; quantity: number; unitPrice: number; amount: number; stock: boolean }[];
  for (const l of input.lines) {
    const item = l.itemId ? await db.item.findUnique({ where: { id: l.itemId } }) : null;
    if (l.itemId && !item) throw badRequest('Unknown item on bill line.');
    const quantity = q3(l.quantity);
    const unitPrice = money(l.unitPrice);
    if (quantity <= 0 || unitPrice < 0) throw badRequest('Each line needs a positive quantity and a non-negative price.');
    const stock = !!item?.trackInventory && !!item.valued;
    const acc = stock ? item!.inventoryAccountId : l.accountId || item?.expenseAccountId;
    if (!acc) throw badRequest(`Choose an expense account for "${l.description || item?.name || 'line'}".`);
    const account = await db.account.findUnique({ where: { id: acc } });
    if (!account || !account.active) throw badRequest('Invalid or inactive account on bill line.');
    lines.push({ itemId: item?.id ?? null, accountId: acc, description: l.description || item?.name || account.name, quantity, unitPrice, amount: round2(quantity * unitPrice), stock });
  }
  const total = sum(lines.map(l => l.amount));
  if (total <= 0) throw badRequest('Bill total must be greater than zero.');

  const number = await nextNumber(db, input.paid ? 'EXP' : 'BILL');
  const bill = await db.bill.create({
    data: {
      number, date: input.date, dueDate: input.dueDate ?? addDays(input.date, supplier?.paymentTerms ?? 0),
      supplierId: supplier?.id ?? null, total, reference: input.reference ?? null, notes: input.notes ?? null,
      createdById: actor?.id ?? null,
      lines: { create: lines.map(({ stock: _s, ...l }) => l) },
    },
  });

  for (const l of lines) {
    if (l.stock && l.itemId) {
      await receiveStock(db, { itemId: l.itemId, date: input.date, type: 'PURCHASE', quantity: l.quantity, unitCost: l.unitPrice, sourceType: 'BILL', sourceId: bill.id, createdById: actor?.id });
    }
  }
  const je: LineInput[] = lines.map(l => ({ accountId: l.accountId, debit: l.amount, memo: l.description }));
  je.push({ accountId: await accountId(db, SYS.AP), credit: total, partyId: supplier?.id ?? null, memo: number });
  const entry = await postEntry(db, actor, { date: input.date, memo: `${input.paid ? 'Expense' : 'Bill'} ${number}${supplier ? ` — ${supplier.name}` : ''}`, sourceType: 'BILL', sourceId: bill.id, lines: je });
  await db.bill.update({ where: { id: bill.id }, data: { journalEntryId: entry.id } });
  await audit(db, actor, 'create', 'bill', bill.id, `${number}${supplier ? ` from ${supplier.name}` : ''}: ${total}`);

  if (input.paid && money(input.paid.amount) > 0) {
    const amount = Math.min(money(input.paid.amount), total);
    await createPayment(db, actor, {
      direction: 'OUT', date: input.date, partyId: supplier?.id ?? null, cashAccountId: input.paid.cashAccountId,
      counterAccountId: await accountId(db, SYS.AP), amount, method: input.paid.method, notes: `Paid with ${number}`,
      allocations: [{ billId: bill.id, amount }],
    });
  }
  return db.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { lines: true, supplier: true } });
}

export async function voidBill(db: Db, actor: Actor | null, id: string, reason: string) {
  const bill = await db.bill.findUnique({ where: { id }, include: { allocations: { include: { payment: true } } } });
  if (!bill) throw notFound('Bill');
  if (bill.status === 'VOID') throw conflict('This bill is already void.');
  const live = bill.allocations.filter(a => a.payment.status !== 'VOID');
  if (live.length) throw conflict(`Void the payments applied to this bill first (${live.map(a => a.payment.number).join(', ')}).`);
  await reverseStockForSource(db, 'BILL', id);
  if (bill.journalEntryId) await reverseEntry(db, actor, bill.journalEntryId, reason);
  await db.bill.update({ where: { id }, data: { status: 'VOID', notes: [bill.notes, `VOID: ${reason}`].filter(Boolean).join(' · ') } });
  await audit(db, actor, 'void', 'bill', id, `Voided ${bill.number}: ${reason}`);
}
