// Backlog import of the farm's monthly workbook (the "আয় ও ব্যয়" daily sheet).
// Every row is posted through the normal services (production, invoices, bills, payments,
// stock adjustments), so imported history is indistinguishable from live entries and fully
// reconciles. Each import is recorded as a batch that can be undone in one step.
import type { Db } from '../db.js';
import { prisma } from '../db.js';
import { badRequest, conflict } from '../lib/errors.js';
import { readXlsx, colLetter, type Sheet } from '../lib/xlsx.js';
import { round2, num } from '../lib/money.js';
import { toDate, ymd } from '../lib/dates.js';
import { SYS } from '../lib/constants.js';
import { accountId, postEntry, reverseEntry } from './ledger.js';
import { reverseStockForSource } from './inventory.js';
import { createInvoice, voidInvoice } from './sales.js';
import { createBill, voidBill } from './purchases.js';
import { createPayment, voidPayment } from './payments.js';
import { adjustStock, recordProduction, voidProduction } from './operations.js';
import { audit, nextNumber, type Actor } from './common.js';

export interface WorkbookRow {
  date: string; sourceDate: string; produced: number; cashEggs: number; creditEggs: number; discount: number;
  feed: number; snails: number; other: number; medicine: number; donated: number; waste: number; note?: string;
}
export interface WorkbookParams {
  openingCash: number; price: number; openingReceivable: number; contribution: number;
  feedStock: number | null; otherMonthly: number; oldCollection: number; expectedClosingCash: number | null;
}
export interface ParsedWorkbook { sheetName: string; params: WorkbookParams; rows: WorkbookRow[]; warnings: string[] }

// ───────────── Parsing ─────────────

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const latin = (s: string) => s.replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d)));
// NFC: Bangla য়/ড়/ঢ় may be stored precomposed or as base + nukta; compare in one form.
const norm = (v: unknown) => latin(String(v ?? '').normalize('NFC')).replace(/\s+/g, ' ').trim();
const n = (v: unknown) => {
  if (typeof v === 'number') return v;
  const s = norm(v).replace(/,/g, '');
  return s && Number.isFinite(Number(s)) ? Number(s) : 0;
};

/** Labels in column C of the monthly-figures block, matched by substring. */
const PARAM_LABELS: [keyof WorkbookParams, string][] = [
  ['openingCash', 'গত মাসের ব্যালেন্স'], ['price', 'বিক্রয়মূল্য'], ['openingReceivable', 'গত মাসের বকেয়া'], ['contribution', 'নগদ অনুদান'],
  ['feedStock', 'মজুদ খাবার'], ['otherMonthly', 'অন্যান্য মাসিক খরচ'], ['oldCollection', 'পূর্বের বকেয়া আদায়'], ['expectedClosingCash', 'মাস শেষে হাতে নগদ'],
];

/** Daily-table headers: [field, label substring, default column]. First match wins, left to right. */
const N = (s: string) => s.normalize('NFC');
const COLUMNS: [keyof WorkbookRow, (h: string) => boolean, string][] = [
  ['sourceDate', h => h === N('তারিখ'), 'B'],
  ['produced', h => h === N('ডিমের সংখ্যা'), 'C'],
  ['feed', h => h.includes(N('ফিড')), 'F'],
  ['snails', h => h.includes(N('শামুক')), 'G'],
  ['other', h => h.includes(N('অন্যান্য খরচ')), 'H'],
  ['medicine', h => h.includes(N('ঔষধ')), 'I'],
  ['cashEggs', h => h === N('নগদ'), 'M'],
  ['creditEggs', h => h === N('বাকি') || h === N('বাকী'), 'N'],
  ['discount', h => h.includes(N('ডিসকাউন্ট')), 'P'],
  ['donated', h => h === N('অনুদান'), 'Y'],
  ['waste', h => h.includes(N('নষ্ট')), 'Z'],
];

function parseDate(raw: unknown): { y: number; m: number; d: number } | null {
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + raw * 86_400_000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  const parts = norm(raw).split(/[\/\-.]/).map(Number);
  if (parts.length !== 3 || parts.some(x => !Number.isFinite(x))) return null;
  const [d, m, y0] = parts;
  const y = y0 < 100 ? 2000 + y0 : y0;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function rowsOf(sheet: Sheet) {
  let max = 0;
  for (const k of sheet.cells.keys()) max = Math.max(max, Number(k.replace(/^[A-Z]+/, '')));
  return max;
}

export function parseWorkbook(buf: Buffer): ParsedWorkbook {
  const sheets = readXlsx(buf);
  const warnings: string[] = [];
  for (const sheet of sheets) {
    const get = (ref: string) => sheet.cells.get(ref) ?? null;
    const lastRow = rowsOf(sheet);
    // Find the daily table header row: a row containing "তারিখ" followed by "ডিমের সংখ্যা".
    let headerRow = -1;
    for (let r = 1; r <= Math.min(lastRow, 60) && headerRow < 0; r++) {
      const cells = Array.from({ length: 30 }, (_, c) => norm(get(`${colLetter(c)}${r}`)));
      if (cells.includes(N('তারিখ')) && cells.includes(N('ডিমের সংখ্যা'))) headerRow = r;
    }
    if (headerRow < 0) continue;

    const cols = {} as Record<keyof WorkbookRow, string>;
    const headers = Array.from({ length: 40 }, (_, c) => [colLetter(c), norm(get(`${colLetter(c)}${headerRow}`))] as const);
    for (const [field, match, fallback] of COLUMNS) {
      const hit = headers.find(([, h]) => h && match(h));
      cols[field] = hit?.[0] ?? fallback;
      if (!hit) warnings.push(`Column for "${field}" not found by its heading; using column ${fallback}.`);
    }

    const params: WorkbookParams = { openingCash: 0, price: 0, openingReceivable: 0, contribution: 0, feedStock: null, otherMonthly: 0, oldCollection: 0, expectedClosingCash: null };
    for (let r = 1; r < headerRow; r++) {
      for (let c = 0; c < 6; c++) {
        const label = norm(get(`${colLetter(c)}${r}`));
        const hit = label && PARAM_LABELS.find(([, l]) => label.includes(l.normalize('NFC')));
        if (hit) (params as any)[hit[0]] = n(get(`${colLetter(c + 1)}${r}`));
      }
    }
    if (!params.price) throw badRequest('Egg selling price (ডিমের বিক্রয়মূল্য) is missing from the monthly figures block.');

    const rows: WorkbookRow[] = [];
    const raw: { r: number; date: ReturnType<typeof parseDate>; source: string }[] = [];
    for (let r = headerRow + 1; r <= lastRow; r++) {
      const src = get(`${cols.sourceDate}${r}`);
      if (src === null || norm(src) === '') continue; // totals row or blank
      const date = parseDate(src);
      if (!date) { warnings.push(`Row ${r}: could not read the date "${src}"; row skipped.`); continue; }
      raw.push({ r, date, source: String(src) });
    }
    if (!raw.length) throw badRequest('No daily rows with dates were found under the header row.');
    // Majority year/month decides the period; outliers are typos (e.g. 28/10/27).
    const mode = (xs: number[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<number, number>())].sort((a, b) => b[1] - a[1])[0][0];
    const year = mode(raw.map(x => x.date!.y));
    const month = mode(raw.map(x => x.date!.m));
    for (const { r, date, source } of raw) {
      let note: string | undefined;
      if (date!.y !== year || date!.m !== month) {
        note = `Workbook date "${source}" normalized to ${String(date!.d).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}.`;
        warnings.push(`Row ${r}: ${note}`);
      }
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(date!.d).padStart(2, '0')}`;
      const v = (f: keyof WorkbookRow) => Math.max(0, n(get(`${cols[f]}${r}`)));
      rows.push({
        date: ds, sourceDate: source, produced: v('produced'), cashEggs: v('cashEggs'), creditEggs: v('creditEggs'), discount: v('discount'),
        feed: v('feed'), snails: v('snails'), other: v('other'), medicine: v('medicine'), donated: v('donated'), waste: v('waste'), note,
      });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const dupes = rows.filter((x, i) => i && rows[i - 1].date === x.date).map(x => x.date);
    if (dupes.length) warnings.push(`Dates appearing more than once (their rows are posted separately): ${[...new Set(dupes)].join(', ')}.`);
    if (params.feedStock) warnings.push(`Feed stock of ${params.feedStock} is in the workbook without a unit or value; it is not posted. Enter it under Inventory → Adjust stock → Opening stock once confirmed.`);
    if (rows.some(x => x.feed > 0)) warnings.push('Feed purchases are posted as feed expense because the workbook does not record feed consumed.');
    return { sheetName: sheet.name, params, rows, warnings };
  }
  throw badRequest('Could not find the daily sheet. The file must contain a table with "তারিখ" and "ডিমের সংখ্যা" headings, like the October workbook.');
}

// ───────────── Preview ─────────────

export function periodOf(p: ParsedWorkbook) {
  const first = p.rows[0].date;
  const from = toDate(`${first.slice(0, 8)}01`);
  const [y, m] = first.split('-').map(Number);
  const to = new Date(Date.UTC(y, m, 0)); // last day of the month
  return { from, to };
}

function totals(p: ParsedWorkbook) {
  const s = (f: keyof WorkbookRow) => p.rows.reduce((a, r) => a + num(r[f] as number), 0);
  const price = p.params.price;
  const cashSales = round2(s('cashEggs') * price - s('discount'));
  const creditSales = round2(s('creditEggs') * price);
  const dailyExpenses = round2(s('feed') + s('snails') + s('other') + s('medicine'));
  const closingCash = round2(p.params.openingCash + cashSales + p.params.oldCollection + p.params.contribution - dailyExpenses - p.params.otherMonthly);
  return {
    days: p.rows.length, produced: s('produced'), soldCash: s('cashEggs'), soldCredit: s('creditEggs'), donated: s('donated'), waste: s('waste'),
    discount: s('discount'), cashSales, creditSales, netSales: round2(cashSales + creditSales),
    feed: s('feed'), snails: s('snails'), other: s('other'), medicine: s('medicine'), dailyExpenses, otherMonthly: p.params.otherMonthly,
    totalExpenses: round2(dailyExpenses + p.params.otherMonthly),
    closingCash, expectedClosingCash: p.params.expectedClosingCash,
    cashMatches: p.params.expectedClosingCash === null ? null : Math.abs(closingCash - p.params.expectedClosingCash) < 0.5,
    closingReceivable: round2(p.params.openingReceivable + creditSales - p.params.oldCollection),
  };
}

const eggItem = (db: Db) => db.item.findFirst({ where: { category: 'PRODUCE', active: true, trackInventory: true }, orderBy: { createdAt: 'asc' } });

export async function previewWorkbook(p: ParsedWorkbook) {
  const { from, to } = periodOf(p);
  const range = { gte: from, lte: to };
  const [invoices, bills, payments, production, adjustments, journals] = await Promise.all([
    prisma.salesInvoice.count({ where: { date: range, status: { not: 'VOID' } } }),
    prisma.bill.count({ where: { date: range, status: { not: 'VOID' } } }),
    prisma.payment.count({ where: { date: range, status: { not: 'VOID' } } }),
    prisma.productionLog.count({ where: { date: range, status: { not: 'VOID' } } }),
    prisma.stockMove.groupBy({ by: ['sourceId'], where: { date: range, sourceType: 'ADJUSTMENT', voided: false } }),
    prisma.journalEntry.count({ where: { date: range, status: 'POSTED', sourceType: { in: ['MANUAL', 'OPENING', 'TRANSFER'] } } }),
  ]);
  const existing = { invoices, bills, payments, production, adjustments: adjustments.length, journals };
  const hasExisting = Object.values(existing).some(Boolean);
  const blockers = await outsidePaymentBlockers(from, to);

  // Simulate egg stock day by day, starting from stock before the period (assuming the period is replaced).
  const errors: string[] = [];
  const egg = await eggItem(prisma);
  if (!egg) errors.push('No egg item exists (Inventory → Items, category Produce).');
  if (!(await prisma.flock.findFirst({ where: { status: 'ACTIVE' } }))) errors.push('Create an active flock first (Production → Flocks).');
  const org = await prisma.organization.findUnique({ where: { id: 'org' } });
  if (org?.lockDate && from <= org.lockDate) errors.push(`The books are closed up to ${ymd(org.lockDate)}. Reopen the period before importing.`);
  if (egg) {
    const before = await prisma.stockMove.aggregate({ where: { itemId: egg.id, voided: false, date: { lt: from } }, _sum: { quantity: true } });
    let stock = num(before._sum.quantity);
    for (const r of p.rows) {
      stock += r.produced - r.cashEggs - r.creditEggs - r.donated - r.waste;
      if (stock < -0.0005) { errors.push(`${r.date}: eggs sold/given/wasted exceed eggs available by ${-stock}. Correct the row and upload again.`); stock = 0; }
    }
  }
  return {
    sheetName: p.sheetName, period: { from: ymd(from), to: ymd(to) }, params: p.params, rows: p.rows, warnings: p.warnings,
    totals: totals(p), existing, hasExisting, blockers, errors,
  };
}

/** Receipts/payments dated after the period that settle documents inside it: replacing would orphan them. */
async function outsidePaymentBlockers(from: Date, to: Date) {
  const allocs = await prisma.paymentAllocation.findMany({
    where: { payment: { status: 'POSTED', date: { gt: to } }, OR: [{ invoice: { date: { gte: from, lte: to }, status: { not: 'VOID' } } }, { bill: { date: { gte: from, lte: to }, status: { not: 'VOID' } } }] },
    include: { payment: true, invoice: true, bill: true },
  });
  return allocs.map(a => `${a.payment.number} (${ymd(a.payment.date)}) settles ${a.invoice?.number ?? a.bill?.number}`);
}

// ───────────── Replace & undo ─────────────

async function voidAdjustment(db: Db, actor: Actor | null, sourceId: string, reason: string) {
  await reverseStockForSource(db, 'ADJUSTMENT', sourceId);
  const jes = await db.journalEntry.findMany({ where: { sourceType: 'ADJUSTMENT', sourceId, status: 'POSTED' } });
  for (const je of jes) await reverseEntry(db, actor, je.id, reason);
}

/** Void every posted record dated inside [from, to] so a backlog import can replace it cleanly. */
export async function voidPeriod(db: Db, actor: Actor | null, from: Date, to: Date, reason: string) {
  const range = { gte: from, lte: to };
  for (const p of await db.payment.findMany({ where: { date: range, status: 'POSTED' } })) await voidPayment(db, actor, p.id, reason);
  for (const i of await db.salesInvoice.findMany({ where: { date: range, status: { not: 'VOID' } } })) await voidInvoice(db, actor, i.id, reason);
  for (const b of await db.bill.findMany({ where: { date: range, status: { not: 'VOID' } } })) await voidBill(db, actor, b.id, reason);
  for (const l of await db.productionLog.findMany({ where: { date: range, status: 'POSTED' } })) await voidProduction(db, actor, l.id, reason);
  const adj = await db.stockMove.groupBy({ by: ['sourceId'], where: { date: range, sourceType: 'ADJUSTMENT', voided: false } });
  for (const a of adj) if (a.sourceId) await voidAdjustment(db, actor, a.sourceId, reason);
  for (const je of await db.journalEntry.findMany({ where: { date: range, status: 'POSTED', sourceType: { in: ['MANUAL', 'OPENING', 'TRANSFER', 'ADJUSTMENT'] } } })) await reverseEntry(db, actor, je.id, reason);
  await db.importBatch.updateMany({ where: { periodFrom: { lte: to }, periodTo: { gte: from }, status: 'POSTED' }, data: { status: 'VOID' } });
}

interface Docs { invoices: string[]; bills: string[]; payments: string[]; production: string[]; adjustments: string[]; journals: string[] }

export async function undoBatch(db: Db, actor: Actor | null, id: string, reason: string) {
  const batch = await db.importBatch.findUnique({ where: { id } });
  if (!batch) throw badRequest('Import not found.');
  if (batch.status === 'VOID') throw conflict('This import has already been undone.');
  const d = JSON.parse(batch.documents) as Docs;
  const livePaymentsOf = async (where: object) => (await db.paymentAllocation.findMany({ where: { ...where, payment: { status: 'POSTED' } }, select: { paymentId: true } })).map(a => a.paymentId);
  const payments = new Set([...d.payments, ...(await livePaymentsOf({ invoiceId: { in: d.invoices } })), ...(await livePaymentsOf({ billId: { in: d.bills } }))]);
  for (const p of payments) { const x = await db.payment.findUnique({ where: { id: p } }); if (x?.status === 'POSTED') await voidPayment(db, actor, p, reason); }
  for (const i of d.invoices) { const x = await db.salesInvoice.findUnique({ where: { id: i } }); if (x && x.status !== 'VOID') await voidInvoice(db, actor, i, reason); }
  for (const b of d.bills) { const x = await db.bill.findUnique({ where: { id: b } }); if (x && x.status !== 'VOID') await voidBill(db, actor, b, reason); }
  for (const l of d.production) { const x = await db.productionLog.findUnique({ where: { id: l } }); if (x?.status === 'POSTED') await voidProduction(db, actor, l, reason); }
  for (const a of d.adjustments) await voidAdjustment(db, actor, a, reason);
  for (const j of d.journals) { const x = await db.journalEntry.findUnique({ where: { id: j } }); if (x?.status === 'POSTED') await reverseEntry(db, actor, j, reason); }
  await db.importBatch.update({ where: { id }, data: { status: 'VOID' } });
  await audit(db, actor, 'void', 'import', id, `Undid import ${batch.number}: ${reason}`);
}

// ───────────── Import ─────────────

async function party(db: Db, name: string, notes: string) {
  return (await db.party.findFirst({ where: { name, kind: 'CUSTOMER' } })) ?? db.party.create({ data: { kind: 'CUSTOMER', name, notes } });
}

export async function importWorkbook(db: Db, actor: Actor | null, p: ParsedWorkbook, opts: { replaceExisting: boolean; flockId?: string | null; fileName?: string | null }) {
  const { from, to } = periodOf(p);
  if (opts.replaceExisting) {
    const blockers = await outsidePaymentBlockers(from, to);
    if (blockers.length) throw conflict(`Void these later payments first: ${blockers.join('; ')}`);
    await voidPeriod(db, actor, from, to, `Replaced by workbook import`);
  }
  const flock = opts.flockId ? await db.flock.findUnique({ where: { id: opts.flockId } }) : await db.flock.findFirst({ where: { status: 'ACTIVE' }, orderBy: { startDate: 'asc' } });
  if (!flock) throw badRequest('Create an active flock first (Production → Flocks).');
  const egg = await eggItem(db);
  if (!egg) throw badRequest('Create an egg item (category Produce) first.');

  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(from);
  const tag = `Imported from ${monthName} workbook.`;
  const walkIn = (await db.party.findFirst({ where: { name: 'Walk-in customers' } })) ?? (await db.party.create({ data: { kind: 'CUSTOMER', name: 'Walk-in customers', notes: 'Counter / cash sales without a named customer.' } }));
  const creditParty = p.rows.some(r => r.creditEggs > 0) ? await party(db, `Credit customers (${monthName} workbook)`, 'Aggregated credit sales from the workbook. Record collections against this customer, or split into named customers.') : null;
  const cash = await accountId(db, SYS.CASH);
  const acc = (code: string) => accountId(db, code);
  const docs: Docs = { invoices: [], bills: [], payments: [], production: [], adjustments: [], journals: [] };
  const price = p.params.price;

  // Opening position on the first day of the month.
  if (p.params.openingCash) {
    const amt = Math.abs(p.params.openingCash);
    const je = await postEntry(db, actor, {
      date: from, memo: `Opening cash per ${monthName} workbook`, sourceType: 'OPENING',
      lines: p.params.openingCash > 0
        ? [{ accountId: cash, debit: amt }, { accountId: await acc(SYS.OPENING_EQUITY), credit: amt }]
        : [{ accountId: await acc(SYS.OPENING_EQUITY), debit: amt }, { accountId: cash, credit: amt }],
    });
    docs.journals.push(je.id);
  }
  let openingInvoiceId: string | null = null;
  if (p.params.openingReceivable > 0) {
    const openingParty = await party(db, `Opening receivables (${monthName})`, 'Receivable balance carried in from the previous month.');
    const inv = await createInvoice(db, actor, { date: from, customerId: openingParty.id, notes: `Opening receivable. ${tag}`, lines: [{ description: 'Opening receivable balance', quantity: 1, unitPrice: p.params.openingReceivable, accountId: await acc(SYS.OPENING_EQUITY) }] });
    docs.invoices.push(inv.id);
    openingInvoiceId = inv.id;
  }

  for (const r of p.rows) {
    const date = toDate(r.date);
    const notes = [tag, r.note].filter(Boolean).join(' ');
    if (r.produced > 0) {
      const log = await recordProduction(db, actor, { date, flockId: flock.id, eggItemId: egg.id, eggsCollected: r.produced, notes }).catch(e => {
        throw badRequest(`${r.date}: ${e.message}`);
      });
      docs.production.push(log.id);
    }
    const wrap = <T>(work: Promise<T>) => work.catch(e => { throw badRequest(`${r.date}: ${e.message}`); });
    if (r.cashEggs > 0) {
      const total = round2(r.cashEggs * price - r.discount);
      const inv = await wrap(createInvoice(db, actor, { date, customerId: walkIn.id, discount: r.discount, notes, lines: [{ itemId: egg.id, quantity: r.cashEggs, unitPrice: price }], received: { amount: total, cashAccountId: cash } }));
      docs.invoices.push(inv.id);
    }
    if (r.creditEggs > 0 && creditParty) {
      const inv = await wrap(createInvoice(db, actor, { date, customerId: creditParty.id, notes, lines: [{ itemId: egg.id, quantity: r.creditEggs, unitPrice: price }] }));
      docs.invoices.push(inv.id);
    }
    if (r.donated > 0) docs.adjustments.push((await wrap(adjustStock(db, actor, { date, itemId: egg.id, type: 'GIFT', quantity: r.donated, notes }))).sourceId!);
    if (r.waste > 0) docs.adjustments.push((await wrap(adjustStock(db, actor, { date, itemId: egg.id, type: 'WASTE', quantity: r.waste, notes }))).sourceId!);
    const lines = [
      r.feed && { accountId: await acc(SYS.FEED_EXPENSE), description: 'Feed purchase (expensed: consumption not recorded in workbook)', quantity: 1, unitPrice: r.feed },
      r.snails && { accountId: await acc('6015'), description: 'Snails / supplementary feed', quantity: 1, unitPrice: r.snails },
      r.other && { accountId: await acc('6050'), description: 'Transport / packaging / other', quantity: 1, unitPrice: r.other },
      r.medicine && { accountId: await acc(SYS.MEDICINE_EXPENSE), description: 'Medicine / veterinary', quantity: 1, unitPrice: r.medicine },
    ].filter(Boolean) as { accountId: string; description: string; quantity: number; unitPrice: number }[];
    if (lines.length) {
      const total = round2(lines.reduce((a, l) => a + l.unitPrice, 0));
      docs.bills.push((await wrap(createBill(db, actor, { date, notes, lines, paid: { amount: total, cashAccountId: cash } }))).id);
    }
  }

  // Month-level figures, dated on the last day of the month.
  if (p.params.otherMonthly > 0) {
    docs.bills.push((await createBill(db, actor, { date: to, notes: `${tag} Monthly other costs.`, lines: [{ accountId: await acc('6090'), description: 'Other monthly costs', quantity: 1, unitPrice: p.params.otherMonthly }], paid: { amount: p.params.otherMonthly, cashAccountId: cash } })).id);
  }
  if (p.params.oldCollection > 0) {
    const inv = openingInvoiceId ? await db.salesInvoice.findUniqueOrThrow({ where: { id: openingInvoiceId } }) : null;
    const applied = inv ? Math.min(p.params.oldCollection, num(inv.total)) : 0;
    const pay = inv
      ? await createPayment(db, actor, { direction: 'IN', date: to, partyId: inv.customerId, cashAccountId: cash, amount: p.params.oldCollection, notes: `Collection of previous dues (${monthName} workbook)`, allocations: [{ invoiceId: inv.id, amount: applied }] })
      : await createPayment(db, actor, { direction: 'IN', date: to, cashAccountId: cash, counterAccountId: await acc(SYS.OPENING_EQUITY), amount: p.params.oldCollection, notes: `Collection of previous dues (${monthName} workbook; no opening receivable given)` });
    docs.payments.push(pay.id);
  }
  if (p.params.contribution > 0) {
    docs.payments.push((await createPayment(db, actor, { direction: 'IN', date: to, cashAccountId: cash, counterAccountId: await acc(SYS.OWNER_CAPITAL), amount: p.params.contribution, notes: `Cash grant / contribution (${monthName} workbook)` })).id);
  }

  const summary = totals(p);
  const number = await nextNumber(db, 'IMP');
  const batch = await db.importBatch.create({
    data: { number, kind: 'WORKBOOK', fileName: opts.fileName ?? null, periodFrom: from, periodTo: to, summary: JSON.stringify({ ...summary, warnings: p.warnings, replaced: opts.replaceExisting }), documents: JSON.stringify(docs), createdById: actor?.id ?? null },
  });
  await audit(db, actor, 'create', 'import', batch.id, `Imported ${monthName} workbook (${p.rows.length} days) as ${number}`);
  return { batch, summary };
}

