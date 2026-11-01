// "Books health": the ledger's invariants, checked against the live data. Each check says whether two
// independent views of the same money (or stock) agree. A failure means a bug or a direct edit of the
// database file, never a normal user action. Read-only.
import type { Db } from '../db.js';
import { SYS } from '../lib/constants.js';
import { isZero, num, round2 } from '../lib/money.js';

export interface HealthCheck {
  key: string;
  ok: boolean;
  /** What the ledger says and what the documents / stock records say; null when not a comparison. */
  ledger: number | null;
  records: number | null;
  difference: number;
  /** Up to 10 record numbers or names to look at. */
  examples: string[];
}

/** Inventory values go through average costs kept to 4 decimals, so allow 1 taka of rounding. */
const INVENTORY_TOLERANCE = 1;
const DOCUMENT_SOURCES = ['INVOICE', 'BILL', 'PAYMENT'];

/** Net debit − credit of POSTED lines on these accounts (void pairs are both VOID and cancel out anyway). */
async function postedNet(db: Db, accountIds: string[], extra: object = {}) {
  const agg = await db.journalLine.aggregate({ where: { accountId: { in: accountIds }, entry: { status: 'POSTED', ...extra } }, _sum: { debit: true, credit: true } });
  return round2(num(agg._sum.debit) - num(agg._sum.credit));
}

export async function booksHealth(db: Db) {
  const checks: HealthCheck[] = [];
  const add = (key: string, ledger: number | null, records: number | null, difference: number, examples: string[] = [], tolerance = 0.005) =>
    checks.push({ key, ok: Math.abs(difference) < tolerance && examples.length === 0, ledger, records, difference: round2(difference), examples: examples.slice(0, 10) });

  // 1. Every journal entry balances on its own.
  const perEntry = await db.journalLine.groupBy({ by: ['entryId'], _sum: { debit: true, credit: true } });
  const unbalanced = perEntry.filter(e => !isZero(num(e._sum.debit) - num(e._sum.credit)));
  const unbalancedNumbers = unbalanced.length
    ? (await db.journalEntry.findMany({ where: { id: { in: unbalanced.slice(0, 10).map(e => e.entryId) } }, select: { number: true } })).map(e => e.number)
    : [];
  add('entries_balanced', null, null, unbalanced.reduce((s, e) => s + num(e._sum.debit) - num(e._sum.credit), 0), unbalancedNumbers);

  // 2. The whole ledger balances (trial balance).
  const all = await db.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  add('trial_balance', round2(num(all._sum.debit)), round2(num(all._sum.credit)), num(all._sum.debit) - num(all._sum.credit));

  // 3. Every voided entry has its reversal (a void never just hides an entry).
  const voided = await db.journalEntry.findMany({ where: { status: 'VOID', sourceType: { not: 'REVERSAL' } }, select: { id: true, number: true } });
  const reversed = new Set((await db.journalEntry.findMany({ where: { sourceType: 'REVERSAL', reversalOf: { not: null } }, select: { reversalOf: true } })).map(r => r.reversalOf));
  add('voids_reversed', null, null, 0, voided.filter(v => !reversed.has(v.id)).map(v => v.number));

  const ar = (await db.account.findUnique({ where: { code: SYS.AR }, select: { id: true } }))?.id;
  const ap = (await db.account.findUnique({ where: { code: SYS.AP }, select: { id: true } }))?.id;

  // 4. Receivables: the AR account equals open invoices, less customer money not yet applied,
  //    plus anything journalled to AR directly (opening balances, manual entries).
  if (ar) {
    const invoices = await db.salesInvoice.findMany({ where: { status: { not: 'VOID' } }, select: { total: true, amountPaid: true } });
    const open = invoices.reduce((s, i) => s + num(i.total) - num(i.amountPaid), 0);
    const pays = await db.payment.findMany({ where: { status: 'POSTED', counterAccountId: ar }, include: { allocations: true } });
    const unapplied = pays.reduce((s, p) => s + (p.direction === 'IN' ? -1 : 1) * (num(p.amount) - p.allocations.reduce((a, x) => a + num(x.amount), 0)), 0);
    const direct = await postedNet(db, [ar], { sourceType: { notIn: DOCUMENT_SOURCES } });
    const ledger = await postedNet(db, [ar]);
    const records = round2(open + unapplied + direct);
    add('receivables', ledger, records, ledger - records);
  }

  // 5. Payables, the same from the supplier side (credit balance).
  if (ap) {
    const bills = await db.bill.findMany({ where: { status: { not: 'VOID' } }, select: { total: true, amountPaid: true } });
    const open = bills.reduce((s, b) => s + num(b.total) - num(b.amountPaid), 0);
    const pays = await db.payment.findMany({ where: { status: 'POSTED', counterAccountId: ap }, include: { allocations: true } });
    const unapplied = pays.reduce((s, p) => s + (p.direction === 'OUT' ? -1 : 1) * (num(p.amount) - p.allocations.reduce((a, x) => a + num(x.amount), 0)), 0);
    const direct = -(await postedNet(db, [ap], { sourceType: { notIn: DOCUMENT_SOURCES } }));
    const ledger = -(await postedNet(db, [ap]));
    const records = round2(open + unapplied + direct);
    add('payables', ledger, records, ledger - records);
  }

  // 6. Each product's quantity on hand equals the sum of its stock movements.
  const items = await db.item.findMany({ where: { trackInventory: true }, select: { id: true, name: true, sku: true, qtyOnHand: true, avgCost: true, valued: true } });
  const moved = new Map((await db.stockMove.groupBy({ by: ['itemId'], where: { voided: false }, _sum: { quantity: true } })).map(m => [m.itemId, num(m._sum.quantity)]));
  const qtyOff = items.filter(i => Math.abs(num(i.qtyOnHand) - (moved.get(i.id) ?? 0)) > 0.0005);
  add('stock_quantities', null, null, 0, qtyOff.map(i => `${i.sku} ${i.name}: on hand ${num(i.qtyOnHand)}, movements ${round2(moved.get(i.id) ?? 0)}`));

  // 7. Stock value at average cost equals the inventory accounts in the ledger (risk R2).
  const inventoryAccounts = (await db.account.findMany({ where: { subtype: 'INVENTORY' }, select: { id: true } })).map(a => a.id);
  const stockValue = round2(items.filter(i => i.valued).reduce((s, i) => s + num(i.qtyOnHand) * num(i.avgCost), 0));
  const inventoryLedger = await postedNet(db, inventoryAccounts);
  add('inventory_value', inventoryLedger, stockValue, inventoryLedger - stockValue, [], INVENTORY_TOLERANCE);

  return { ok: checks.every(c => c.ok), checkedAt: new Date().toISOString(), checks };
}
