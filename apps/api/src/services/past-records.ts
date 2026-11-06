// Past records template: one .xlsx with a sheet per kind of record, so the farm's history from before FarmLedger
// can be brought into the books in one go and the books show the farm's true position. Opening balances are
// posted against "Opening balance equity"; everything else goes through the normal services, exactly as if it
// had been typed in. The preview is the same import run inside a transaction that is always rolled back, so it
// reports every problem the real import would hit. Each import is one batch, undone in one step.
import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import { prisma } from '../db.js';
import { AppError, badRequest, conflict } from '../lib/errors.js';
import { readXlsx, colLetter, writeXlsx, type Cell, type OutSheet, type Sheet } from '../lib/xlsx.js';
import { num, round2, round3 } from '../lib/money.js';
import { toDate, today, ymd } from '../lib/dates.js';
import { normalizePhone } from '../lib/phone.js';
import { SYS } from '../lib/constants.js';
import { accountBalance, accountId, postEntry } from './ledger.js';
import { createInvoice } from './sales.js';
import { createBill } from './purchases.js';
import { createPayment } from './payments.js';
import { recordGrant } from './projects.js';
import { adjustStock, recordProduction } from './operations.js';
import { audit, nextNumber, type Actor } from './common.js';
import type { Docs } from './importer.js';
import { importCutoffError } from './vouchers.js';

// ───────────── The template ─────────────

type Kind = 'text' | 'date' | 'money' | 'signed' | 'quantity' | 'count' | 'choice';
interface Col { key: string; en: string; bn: string; kind: Kind; required?: boolean; choices?: string[]; example: string | number | null; help: string; width?: number }
interface SheetDef { key: SheetKey; name: string; bn: string; about: string; cols: Col[] }
type SheetKey = 'start' | 'parties' | 'items' | 'flocks' | 'daily' | 'purchases' | 'payments' | 'grants';

export const TEMPLATE_MARK = 'FarmLedger past records template';
const VERSION = 1;
const ACCOUNTS = ['Cash', 'Bank', 'Mobile'];
const ACCOUNT_CODE: Record<string, string> = { cash: SYS.CASH, bank: SYS.BANK, mobile: SYS.MOBILE };
const PARTY_KINDS: Record<string, string> = { customer: 'CUSTOMER', supplier: 'SUPPLIER', both: 'BOTH', donor: 'DONOR', employee: 'EMPLOYEE' };
const ITEM_KINDS: Record<string, string> = { produce: 'PRODUCE', feed: 'FEED', medicine: 'MEDICINE', supply: 'SUPPLY', livestock: 'LIVESTOCK' };
const EXPENSE_TYPES: [label: string, code: string][] = [
  ['Feed', SYS.FEED_EXPENSE], ['Snails', '6015'], ['Medicine', SYS.MEDICINE_EXPENSE], ['Labour', '6030'], ['Electricity & fuel', '6040'],
  ['Transport', '6050'], ['Repairs', '6060'], ['Rent', '6070'], ['Office', '6100'], ['Bank charges', '7020'], ['Equipment', '1620'], ['Other', '6090'],
];
/** What a payment is for: direction, and the account it is booked against (null = the person's dues). */
const PURPOSES: [label: string, direction: 'IN' | 'OUT', code: string | null][] = [
  ['Customer payment', 'IN', null], ['Supplier payment', 'OUT', null], ['Owner money in', 'IN', SYS.OWNER_CAPITAL], ['Owner drawings', 'OUT', SYS.OWNER_DRAWINGS],
  ['Loan received', 'IN', '2200'], ['Loan repaid', 'OUT', '2200'], ['Other income', 'IN', SYS.OTHER_INCOME], ['Other expense', 'OUT', '6090'],
];
const DATE_HELP = 'Day/month/year, e.g. 15/03/2026.';
const into = (en: string, bn: string): Col => ({ key: 'account', en, bn, kind: 'choice', choices: ACCOUNTS, example: 'Cash', help: 'Cash, Bank or Mobile (bKash/Nagad). Blank = Cash.' });
const notes: Col = { key: 'notes', en: 'Notes', bn: 'মন্তব্য', kind: 'text', example: null, help: 'Anything worth keeping with the record.', width: 30 };

export const SHEETS: SheetDef[] = [
  {
    key: 'start', name: 'Start', bn: 'শুরু', about: 'One row: the day the books start, and the money held on that day.',
    cols: [
      { key: 'date', en: 'Start date', bn: 'শুরুর তারিখ', kind: 'date', required: true, example: '01/07/2026', help: `The first day of the books. Opening balances are dated this day, and every record on the other sheets must be on or after it. ${DATE_HELP}` },
      { key: 'cash', en: 'Cash in hand', bn: 'হাতে নগদ', kind: 'signed', example: 25000, help: 'Cash held at the start of the start date. A minus means the cash box was short.' },
      { key: 'bank', en: 'Bank balance', bn: 'ব্যাংক হিসাব', kind: 'signed', example: 150000, help: 'Balance in the bank account on the start date.' },
      { key: 'mobile', en: 'Mobile banking balance', bn: 'মোবাইল ব্যাংকিং (বিকাশ/নগদ)', kind: 'signed', example: 3000, help: 'bKash / Nagad balance on the start date.' },
    ],
  },
  {
    key: 'parties', name: 'Customers & suppliers', bn: 'ক্রেতা ও সরবরাহকারী', about: 'Everyone the farm buys from or sells to, with what they owed on the start date.',
    cols: [
      { key: 'name', en: 'Name', bn: 'নাম', kind: 'text', required: true, example: 'Rahim Traders', help: 'As you want it shown. A name already in FarmLedger is used as it is.', width: 26 },
      { key: 'type', en: 'Type', bn: 'ধরন', kind: 'choice', required: true, choices: Object.keys(PARTY_KINDS).map(cap), example: 'Supplier', help: 'Customer, Supplier, Both, Donor or Employee.' },
      { key: 'phone', en: 'Phone', bn: 'ফোন', kind: 'text', example: '01700000000', help: 'Optional.' },
      { key: 'owesUs', en: 'Owes us on start date', bn: 'শুরুর দিনে আমাদের পাওনা', kind: 'money', example: null, help: 'Money this customer still owed the farm on the start date.' },
      { key: 'weOwe', en: 'We owe on start date', bn: 'শুরুর দিনে আমাদের দেনা', kind: 'money', example: 12000, help: 'Money the farm still owed this supplier on the start date.' },
      notes,
    ],
  },
  {
    key: 'items', name: 'Items & stock', bn: 'পণ্য ও মজুদ', about: 'Things the farm buys, sells or keeps in stock, with the stock on hand on the start date.',
    cols: [
      { key: 'name', en: 'Item name', bn: 'পণ্যের নাম', kind: 'text', required: true, example: 'Layer feed', help: 'An item already in FarmLedger (same name) gets only its opening stock.', width: 24 },
      { key: 'category', en: 'Category', bn: 'শ্রেণি', kind: 'choice', required: true, choices: Object.keys(ITEM_KINDS).map(cap), example: 'Feed', help: 'Produce (eggs), Feed, Medicine, Supply or Livestock. Birds themselves go on the Flocks sheet.' },
      { key: 'unit', en: 'Unit', bn: 'একক', kind: 'text', required: true, example: 'kg', help: 'pcs, kg, bag, litre ...' },
      { key: 'qty', en: 'Stock on start date', bn: 'শুরুর দিনের মজুদ', kind: 'quantity', example: 500, help: 'Quantity on hand on the start date.' },
      { key: 'cost', en: 'Cost per unit', bn: 'প্রতি এককের দাম', kind: 'money', example: 55, help: 'What one unit cost. Gives the stock its value (not needed for eggs).' },
      { key: 'price', en: 'Selling price', bn: 'বিক্রয়মূল্য', kind: 'money', example: null, help: 'Usual selling price, if the farm sells it.' },
    ],
  },
  {
    key: 'flocks', name: 'Flocks', bn: 'ঝাঁক', about: 'Each group of birds kept together.',
    cols: [
      { key: 'code', en: 'Flock code', bn: 'ঝাঁক কোড', kind: 'text', required: true, example: 'FLK-02', help: 'A short code. A code already in FarmLedger is used as it is.' },
      { key: 'name', en: 'Flock name', bn: 'ঝাঁকের নাম', kind: 'text', required: true, example: 'Second laying flock', help: 'Any name.', width: 24 },
      { key: 'species', en: 'Species', bn: 'প্রজাতি', kind: 'choice', choices: ['Duck', 'Chicken', 'Quail', 'Other'], example: 'Duck', help: 'Blank = Duck.' },
      { key: 'date', en: 'Date started', bn: 'শুরুর তারিখ', kind: 'date', required: true, example: '01/07/2026', help: DATE_HELP },
      { key: 'birds', en: 'Birds at start', bn: 'শুরুতে হাঁস/মুরগি', kind: 'count', required: true, example: 300, help: 'Number of birds when the flock started.' },
      { key: 'birdsNow', en: 'Birds on start date', bn: 'শুরুর দিনে সংখ্যা', kind: 'count', example: 290, help: 'Birds alive on the start date. Blank = same as at start.' },
      { key: 'shed', en: 'Shed or place', bn: 'শেড / স্থান', kind: 'text', example: 'Main farm', help: 'Optional. Matched to a place already in FarmLedger.' },
    ],
  },
  {
    key: 'daily', name: 'Daily eggs & sales', bn: 'দৈনিক ডিম ও বিক্রি', about: 'One row per day (and per flock): eggs collected, sold, given away and wasted.',
    cols: [
      { key: 'date', en: 'Date', bn: 'তারিখ', kind: 'date', required: true, example: '02/07/2026', help: DATE_HELP },
      { key: 'flock', en: 'Flock code', bn: 'ঝাঁক কোড', kind: 'text', example: 'FLK-02', help: 'Blank is fine when the farm has one flock.' },
      { key: 'collected', en: 'Eggs collected', bn: 'ডিম সংগ্রহ', kind: 'count', example: 250, help: 'All eggs collected that day, broken ones included.' },
      { key: 'broken', en: 'Eggs broken', bn: 'ভাঙা ডিম', kind: 'count', example: 3, help: 'Broken at collection.' },
      { key: 'died', en: 'Birds died', bn: 'মৃত্যু', kind: 'count', example: null, help: 'Birds that died that day.' },
      { key: 'sold', en: 'Quantity sold', bn: 'বিক্রির পরিমাণ', kind: 'quantity', example: 200, help: 'How many were sold that day.' },
      { key: 'item', en: 'Item sold', bn: 'বিক্রির পণ্য', kind: 'text', example: null, help: 'Blank = eggs. Otherwise an item name from the Items sheet or FarmLedger.' },
      { key: 'price', en: 'Price per unit', bn: 'একক দাম', kind: 'money', example: 16, help: "Blank = the item's selling price." },
      { key: 'discount', en: 'Discount', bn: 'ছাড়', kind: 'money', example: null, help: 'Taka off the whole sale.' },
      { key: 'customer', en: 'Customer', bn: 'ক্রেতা', kind: 'text', example: null, help: 'Blank = walk-in (cash) customers. A new name is added as a customer.' },
      { key: 'received', en: 'Received now', bn: 'এখন আদায়', kind: 'money', example: null, help: 'Money received on the day. Blank = all of it. 0 = all on credit (needs a customer).' },
      into('Received into', 'জমা হয়েছে'),
      { key: 'given', en: 'Eggs given away', bn: 'ডিম অনুদান', kind: 'count', example: 10, help: 'Eggs given free.' },
      { key: 'wasted', en: 'Eggs wasted', bn: 'নষ্ট ডিম', kind: 'count', example: null, help: 'Eggs spoiled or lost in store.' },
      notes,
    ],
  },
  {
    key: 'purchases', name: 'Purchases & expenses', bn: 'ক্রয় ও খরচ', about: 'Everything the farm bought or paid for: feed, medicine, wages, electricity, repairs ...',
    cols: [
      { key: 'date', en: 'Date', bn: 'তারিখ', kind: 'date', required: true, example: '03/07/2026', help: DATE_HELP },
      { key: 'supplier', en: 'Supplier', bn: 'সরবরাহকারী', kind: 'text', example: 'Rahim Traders', help: 'Needed when not all was paid. A new name is added as a supplier.', width: 22 },
      { key: 'item', en: 'Item bought', bn: 'কেনা পণ্য', kind: 'text', example: 'Layer feed', help: 'For stock items (from the Items sheet or FarmLedger). Leave blank for a plain expense.' },
      { key: 'type', en: 'Expense type', bn: 'খরচের ধরন', kind: 'choice', choices: EXPENSE_TYPES.map(([l]) => l), example: null, help: `When no item: ${EXPENSE_TYPES.map(([l]) => l).join(', ')}.` },
      { key: 'qty', en: 'Quantity', bn: 'পরিমাণ', kind: 'quantity', example: 100, help: 'For items. Blank = 1.' },
      { key: 'amount', en: 'Total amount', bn: 'মোট টাকা', kind: 'money', required: true, example: 5500, help: 'The whole bill.' },
      { key: 'paid', en: 'Paid now', bn: 'এখন পরিশোধ', kind: 'money', example: 2000, help: 'Paid on the day. Blank = all of it. The rest is owed to the supplier.' },
      into('Paid from', 'যেখান থেকে'),
      { key: 'reference', en: 'Receipt number', bn: 'রসিদ নম্বর', kind: 'text', example: null, help: 'Optional.' },
      notes,
    ],
  },
  {
    key: 'payments', name: 'Payments', bn: 'আদায় ও পরিশোধ', about: 'Money received or paid later: dues collected from customers, suppliers paid, owner money, loans.',
    cols: [
      { key: 'date', en: 'Date', bn: 'তারিখ', kind: 'date', required: true, example: '10/07/2026', help: DATE_HELP },
      { key: 'direction', en: 'In or out', bn: 'আয় না ব্যয়', kind: 'choice', required: true, choices: ['In', 'Out'], example: 'Out', help: 'In = money came in. Out = money went out.' },
      { key: 'party', en: 'Person or business', bn: 'ব্যক্তি / প্রতিষ্ঠান', kind: 'text', example: 'Rahim Traders', help: 'Needed for customer and supplier payments.', width: 22 },
      { key: 'purpose', en: 'What for', bn: 'কীসের জন্য', kind: 'choice', choices: PURPOSES.map(([l]) => l), example: 'Supplier payment', help: `${PURPOSES.map(([l]) => l).join(', ')}. Blank = Customer payment (In) or Supplier payment (Out). Dues are settled oldest first.`, width: 20 },
      { key: 'amount', en: 'Amount', bn: 'টাকা', kind: 'money', required: true, example: 3500, help: 'Taka.' },
      into('Cash or bank', 'নগদ / ব্যাংক'),
      { key: 'reference', en: 'Reference', bn: 'রেফারেন্স', kind: 'text', example: null, help: 'Cheque or transaction number. Optional.' },
      notes,
    ],
  },
  {
    key: 'grants', name: 'Grants', bn: 'অনুদান', about: 'Grants and donations received. They count as income, not sales.',
    cols: [
      { key: 'date', en: 'Date', bn: 'তারিখ', kind: 'date', required: true, example: '15/07/2026', help: DATE_HELP },
      { key: 'giver', en: 'Given by', bn: 'অনুদানদাতা', kind: 'text', required: true, example: 'District office', help: 'Person or office that gave it.', width: 24 },
      { key: 'phone', en: 'Phone', bn: 'ফোন', kind: 'text', example: null, help: 'Optional.' },
      { key: 'amount', en: 'Amount', bn: 'টাকা', kind: 'money', required: true, example: 15000, help: 'Taka.' },
      into('Received into', 'জমা হয়েছে'),
      { key: 'reference', en: 'Reference', bn: 'রেফারেন্স', kind: 'text', example: null, help: 'Letter or memo number. Optional.' },
      notes,
    ],
  },
];

function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }
const header = (c: Col) => `${c.en}${c.required ? ' *' : ''}\n${c.bn}`;

/** The template file: an Instructions sheet, then one sheet per kind of record with a header and an example row. */
export function buildTemplate() {
  const help: Cell[][] = [
    [`${TEMPLATE_MARK} (version ${VERSION})`],
    [`${TEMPLATE_MARK}, version ${VERSION}. Do not change this line.`],
    ['How to use', 'ব্যবহারের নিয়ম', '', 'Fill one sheet per kind of record, starting on row 3. Row 2 on every sheet is an example and is skipped; you may delete it. Columns marked * are required. Leave a sheet empty if it does not apply. Then upload the file in Users & settings → Import past data. You see a preview with every problem and the totals first; nothing is saved until you press Import, and the whole import can be undone in one step.'],
    ['Dates', 'তারিখ', '', 'Type dates as day/month/year, for example 15/03/2026. Bangla digits are fine.'],
    ['Amounts', 'টাকা', '', 'Numbers only, in taka. Commas are fine (1,200). No minus signs except opening cash or bank on the Start sheet.'],
    ['Names', 'নাম', '', 'Write a customer, supplier, item or flock the same way every time. Names already in FarmLedger are matched; new ones are added.'],
    ['Do not import twice', 'দুবার নয়', '', 'The same file cannot be imported twice. If the books already have records in the same dates, the preview warns you first.'],
  ];
  for (const s of SHEETS) {
    help.push([], [`Sheet: ${s.name}`, s.bn, '', s.about], ['Column', 'বাংলা', 'Required', 'What to enter']);
    for (const c of s.cols) help.push([c.en, c.bn, c.required ? 'Yes' : '', c.help]);
    help.push(['Example row', '', '', s.cols.map(c => c.example === null ? null : `${c.en}: ${c.example}`).filter(Boolean).join(' · ')]);
  }
  const sheets: OutSheet[] = [
    { name: 'Instructions', rows: help, widths: [26, 26, 10, 90] },
    ...SHEETS.map(s => ({
      name: s.name, header: true,
      rows: [s.cols.map(header), s.cols.map(c => c.example)],
      widths: s.cols.map(c => c.width ?? 16),
      textCols: s.cols.flatMap((c, i) => (c.kind === 'date' || c.key === 'phone' ? [i] : [])),
      lists: s.cols.flatMap((c, i) => (c.choices ? [{ col: i, values: c.choices }] : [])),
    })),
  ];
  return writeXlsx(sheets);
}

// ───────────── Reading ─────────────

export interface Issue { sheet: string; row: number | null; column: string | null; message: string }
type Rec = { row: number } & Record<string, any>;
export interface ParsedTemplate {
  start: Rec | null;
  records: Record<SheetKey, Rec[]>;
  issues: Issue[];
  /** Fingerprint of the records, so the same records cannot be imported twice even if the file is saved again. */
  hash: string;
  from: string | null;
  to: string | null;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const clean = (v: unknown) => String(v ?? '').normalize('NFC').replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d))).replace(/\s+/g, ' ').trim();
const key = (s: string) => s.toLowerCase();

function readDate(raw: Cell): string | null {
  let y: number, m: number, d: number;
  if (typeof raw === 'number') {
    if (raw < 20000 || raw > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else {
    const s = clean(raw);
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const dmy = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
    if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3])];
    else return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return ymd(dt);
}

function readCell(c: Col, raw: Cell): { value: string | number | null; error?: string } {
  if (raw === null || clean(raw) === '') return { value: null };
  switch (c.kind) {
    case 'text': return { value: clean(raw).slice(0, 200) };
    case 'date': {
      const d = readDate(raw);
      return d ? { value: d } : { value: null, error: `"${clean(raw)}" is not a date. Use day/month/year, e.g. 15/03/2026.` };
    }
    case 'choice': {
      const hit = c.choices!.find(x => key(x) === key(clean(raw)));
      return hit ? { value: hit } : { value: null, error: `"${clean(raw)}" is not one of: ${c.choices!.join(', ')}.` };
    }
    default: {
      const n = typeof raw === 'number' ? raw : Number(clean(raw).replace(/[,৳]|tk\.?|taka/gi, '').trim());
      if (!Number.isFinite(n)) return { value: null, error: `"${clean(raw)}" is not a number.` };
      if (n < 0 && c.kind !== 'signed') return { value: null, error: 'Cannot be below zero.' };
      if (c.kind === 'count' && !Number.isInteger(n)) return { value: null, error: 'Must be a whole number.' };
      return { value: c.kind === 'quantity' ? round3(n) : c.kind === 'count' ? n : round2(n) };
    }
  }
}

function lastRow(sheet: Sheet) {
  let max = 0;
  for (const k of sheet.cells.keys()) max = Math.max(max, Number(k.replace(/^[A-Z]+/, '')));
  return max;
}

/** Rows per file. The preview holds the books' write lock while it runs, so keep it short. */
const MAX_ROWS = 5_000;

/** Read an uploaded template. Throws NOT_TEMPLATE for any other spreadsheet, so the caller can try the monthly workbook. */
export function parseTemplate(buf: Buffer): ParsedTemplate {
  const sheets = readXlsx(buf);
  const byName = new Map(sheets.map(s => [key(clean(s.name)), s]));
  const marker = clean(byName.get('instructions')?.cells.get('A2'));
  if (!marker.startsWith(TEMPLATE_MARK)) throw new AppError(400, 'This is not the FarmLedger past records template.', 'NOT_TEMPLATE');
  const issues: Issue[] = [];
  const records = Object.fromEntries(SHEETS.map(s => [s.key, [] as Rec[]])) as Record<SheetKey, Rec[]>;

  for (const def of SHEETS) {
    const sheet = byName.get(key(def.name));
    if (!sheet) continue; // a sheet that was deleted simply has no records
    const at = (ref: string) => sheet.cells.get(ref) ?? null;
    const cols = new Map<string, string>(); // column key → letter
    for (let c = 0; c < 60; c++) {
      const h = key(clean(String(at(`${colLetter(c)}1`) ?? '').split('\n')[0]).replace(/\*/g, '').trim());
      const hit = h && def.cols.find(x => key(x.en) === h);
      if (hit && !cols.has(hit.key)) cols.set(hit.key, colLetter(c));
    }
    // Every heading must be there: a renamed "Received now" or "Paid now" would silently read as "all paid".
    const missing = def.cols.filter(c => !cols.has(c.key));
    if (missing.length) {
      issues.push({ sheet: def.name, row: 1, column: missing.map(c => c.en).join(', '), message: 'This heading is missing from row 1. Download a fresh template and copy your rows into it.' });
      continue;
    }
    const last = lastRow(sheet);
    for (let r = 2; r <= last; r++) {
      const raw = (c: Col) => (cols.has(c.key) ? at(`${cols.get(c.key)}${r}`) : null);
      if (def.cols.every(c => clean(raw(c)) === '')) continue;
      if (r === 2 && def.cols.every(c => clean(raw(c)) === clean(c.example))) continue; // the untouched example row
      const rec: Rec = { row: r };
      let ok = true;
      for (const c of def.cols) {
        const { value, error } = readCell(c, raw(c));
        if (error) { issues.push({ sheet: def.name, row: r, column: c.en, message: error }); ok = false; }
        else if (value === null && c.required) { issues.push({ sheet: def.name, row: r, column: c.en, message: 'Required.' }); ok = false; }
        rec[c.key] = value;
      }
      if (ok) records[def.key].push(rec);
    }
  }

  const count = Object.values(records).reduce((a, x) => a + x.length, 0);
  if (count > MAX_ROWS) issues.push({ sheet: 'Instructions', row: null, column: null, message: `The file has ${count} rows; at most ${MAX_ROWS} can be imported at once. Split it into files by year and import them one after another.` });

  // The Start sheet: exactly one row.
  const [start, ...extra] = records.start;
  if (!start && !issues.some(i => i.sheet === 'Start')) issues.push({ sheet: 'Start', row: 3, column: 'Start date', message: 'Enter the start date of the books on the Start sheet.' });
  for (const x of extra) issues.push({ sheet: 'Start', row: x.row, column: null, message: 'The Start sheet takes one row only.' });

  // Names that must be unique within their sheet.
  const unique = (k: SheetKey, field: string, what: string) => {
    const seen = new Map<string, number>();
    records[k] = records[k].filter(rec => {
      const name = key(rec[field]);
      if (seen.has(name)) { issues.push({ sheet: SHEETS.find(s => s.key === k)!.name, row: rec.row, column: what, message: `"${rec[field]}" is already on row ${seen.get(name)}.` }); return false; }
      seen.set(name, rec.row);
      return true;
    });
  };
  unique('parties', 'name', 'Name');
  unique('items', 'name', 'Item name');
  unique('flocks', 'code', 'Flock code');

  // Every dated record falls on or after the start date, and not in the future.
  const dated: SheetKey[] = ['daily', 'purchases', 'payments', 'grants'];
  const now = today();
  let to: string | null = start?.date ?? null;
  for (const k of dated) {
    const sheetName = SHEETS.find(s => s.key === k)!.name;
    records[k] = records[k].filter(rec => {
      if (start && rec.date < start.date) { issues.push({ sheet: sheetName, row: rec.row, column: 'Date', message: `Before the start date (${start.date}). Move it to the Start figures or change the start date.` }); return false; }
      if (rec.date > now) { issues.push({ sheet: sheetName, row: rec.row, column: 'Date', message: 'This date is in the future.' }); return false; }
      if (!to || rec.date > to) to = rec.date;
      return true;
    });
  }
  if (start && start.date > now) issues.push({ sheet: 'Start', row: start.row, column: 'Start date', message: 'The start date is in the future.' });

  const strip = (r: Rec) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'row'));
  const hash = createHash('sha256').update(JSON.stringify(SHEETS.map(s => records[s.key].map(strip)))).digest('hex');
  return { start: start ?? null, records, issues, hash, from: start?.date ?? null, to };
}

// ───────────── Posting ─────────────

interface Totals {
  start: { cash: number; bank: number; mobile: number };
  parties: { rows: number; added: number; owesUs: number; weOwe: number };
  items: { rows: number; added: number; stockValue: number };
  flocks: { rows: number; added: number; birds: number };
  daily: { rows: number; eggsCollected: number; sold: number; sales: number; received: number; given: number; wasted: number };
  purchases: { rows: number; amount: number; paid: number };
  payments: { rows: number; moneyIn: number; moneyOut: number };
  grants: { rows: number; amount: number };
}
export interface TemplateDocs extends Docs { parties: string[]; items: string[]; flocks: string[] }

const sheetName = (k: SheetKey) => SHEETS.find(s => s.key === k)!.name;
const SKU_CLEAN = /[^A-Z0-9]+/g;

/**
 * Post everything in the template. With `dryRun`, a failing row is noted and the run carries on, so the
 * preview lists every problem at once; the caller rolls the transaction back. Without it, the first problem stops.
 */
export async function runTemplate(db: Db, actor: Actor | null, p: ParsedTemplate, opts: { dryRun: boolean }) {
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const docs: TemplateDocs = { invoices: [], bills: [], payments: [], production: [], adjustments: [], journals: [], parties: [], items: [], flocks: [] };
  const totals: Totals = {
    start: { cash: 0, bank: 0, mobile: 0 }, parties: { rows: 0, added: 0, owesUs: 0, weOwe: 0 }, items: { rows: 0, added: 0, stockValue: 0 },
    flocks: { rows: 0, added: 0, birds: 0 }, daily: { rows: 0, eggsCollected: 0, sold: 0, sales: 0, received: 0, given: 0, wasted: 0 },
    purchases: { rows: 0, amount: 0, paid: 0 }, payments: { rows: 0, moneyIn: 0, moneyOut: 0 }, grants: { rows: 0, amount: 0 },
  };
  if (!p.start) return { issues, warnings, docs, totals };
  const start = toDate(p.start.date);
  const fail = (message: string) => { throw badRequest(message); };
  /** Run one row's posting; a problem becomes an issue for that sheet and row. */
  const step = async (k: SheetKey, row: number, work: () => Promise<void>) => {
    try { await work(); } catch (e) {
      if (!(e instanceof AppError)) throw e;
      if (!opts.dryRun) throw badRequest(`${sheetName(k)}, row ${row}: ${e.message}`);
      issues.push({ sheet: sheetName(k), row, column: null, message: e.message });
    }
  };
  const warn = (k: SheetKey, row: number, message: string) => warnings.push({ sheet: sheetName(k), row, column: null, message });
  const cashAccount = (label: string | null) => accountId(db, ACCOUNT_CODE[key(label ?? 'Cash')]);

  const parties = new Map((await db.party.findMany()).map(x => [key(x.name), x]));
  const items = new Map((await db.item.findMany()).map(x => [key(x.name), x]));
  const flocks = new Map((await db.flock.findMany()).map(x => [key(x.code), x]));
  const equity = await accountId(db, SYS.OPENING_EQUITY);
  const tag = 'Past records import.';
  const undone = await db.importBatch.findMany({ where: { kind: 'TEMPLATE', status: 'VOID' }, select: { documents: true } });
  const docsOfUndone = { flocks: new Set(undone.flatMap(b => (JSON.parse(b.documents) as TemplateDocs).flocks ?? [])) };
  /** A customer, supplier or item set inactive (for example by undoing an import) is used again: make it active. */
  const revive = async <T extends { id: string; active: boolean }>(what: 'party' | 'item', x: T): Promise<T> => {
    if (x.active) return x;
    if (what === 'party') await db.party.update({ where: { id: x.id }, data: { active: true } });
    else await db.item.update({ where: { id: x.id }, data: { active: true } });
    (what === 'party' ? docs.parties : docs.items).push(x.id);
    const revived = { ...x, active: true };
    (what === 'party' ? parties : items).set(key((x as any).name), revived as any);
    return revived;
  };

  // Opening money, against opening balance equity.
  await step('start', p.start.row, async () => {
    const lines = [];
    let net = 0;
    for (const [field, code] of [['cash', SYS.CASH], ['bank', SYS.BANK], ['mobile', SYS.MOBILE]] as const) {
      const v = num(p.start![field]);
      totals.start[field] = v;
      if (!v) continue;
      net = round2(net + v);
      lines.push(v > 0 ? { accountId: await accountId(db, code), debit: v } : { accountId: await accountId(db, code), credit: -v });
    }
    if (!lines.length) return;
    if (net) lines.push(net > 0 ? { accountId: equity, credit: net } : { accountId: equity, debit: -net });
    const je = await postEntry(db, actor, { date: start, memo: 'Opening cash and bank balances (past records)', sourceType: 'OPENING', lines });
    docs.journals.push(je.id);
  });

  for (const r of p.records.flocks) {
    await step('flocks', r.row, async () => {
      totals.flocks.rows++;
      const now = r.birdsNow ?? r.birds;
      if (now > r.birds) fail('Birds on the start date cannot be more than birds at start.');
      const site = r.shed ? await db.site.findFirst({ where: { name: r.shed } }) : null;
      const data = {
        name: r.name, species: (r.species ?? 'Duck').toUpperCase(), siteId: site?.id ?? null, startDate: toDate(r.date),
        openingCount: r.birds, currentCount: now, notes: [tag, r.shed && !site ? `Shed: ${r.shed}.` : null].filter(Boolean).join(' '),
      };
      const old = flocks.get(key(r.code));
      // A flock closed by undoing an earlier import of these records is opened again; any other is left alone.
      const reopen = old?.status === 'CLOSED' && docsOfUndone.flocks.has(old.id) && !(await db.productionLog.count({ where: { flockId: old.id, status: 'POSTED' } }));
      if (old && !reopen) { warn('flocks', r.row, `Flock ${r.code} is already in FarmLedger and is left as it is.`); return; }
      const flock = old ? await db.flock.update({ where: { id: old.id }, data: { ...data, status: 'ACTIVE' } }) : await db.flock.create({ data: { code: r.code, ...data } });
      await audit(db, actor, old ? 'update' : 'create', 'flock', flock.id, `Flock ${flock.code} with ${flock.openingCount} birds (past records)`);
      flocks.set(key(flock.code), flock);
      docs.flocks.push(flock.id);
      totals.flocks.added++;
      totals.flocks.birds += now;
    });
  }

  for (const r of p.records.items) {
    await step('items', r.row, async () => {
      totals.items.rows++;
      let item = items.get(key(r.name));
      if (item) item = await revive('item', item);
      const category = ITEM_KINDS[key(r.category)];
      if (item && item.category !== category) warn('items', r.row, `${item.name} is already in FarmLedger as ${item.category.toLowerCase()}; that is kept.`);
      if (!item) {
        const acc = (code: string) => accountId(db, code);
        const defaults: Record<string, object> = {
          PRODUCE: { trackInventory: true, valued: false, incomeAccountId: await acc(/egg|ডিম/i.test(r.name) ? SYS.SALES_EGGS : SYS.SALES_OTHER), inventoryAccountId: await acc(SYS.INV_PRODUCE) },
          FEED: { trackInventory: true, valued: true, inventoryAccountId: await acc(SYS.INV_FEED), expenseAccountId: await acc(SYS.FEED_EXPENSE) },
          MEDICINE: { trackInventory: true, valued: true, inventoryAccountId: await acc(SYS.INV_MEDICINE), expenseAccountId: await acc(SYS.MEDICINE_EXPENSE) },
          SUPPLY: { trackInventory: true, valued: true, inventoryAccountId: await acc(SYS.INV_SUPPLIES), expenseAccountId: await acc('6090') },
          LIVESTOCK: { trackInventory: false, valued: false, incomeAccountId: await acc(SYS.SALES_LIVESTOCK) },
        };
        const base = (r.name.toUpperCase().replace(SKU_CLEAN, '-').replace(/^-|-$/g, '') || 'ITEM').slice(0, 20);
        let sku = base;
        for (let n = 2; await db.item.findUnique({ where: { sku } }); n++) sku = `${base}-${n}`;
        item = await db.item.create({ data: { sku, name: r.name, category, unit: r.unit, salePrice: r.price ?? 0, purchasePrice: r.cost ?? 0, ...defaults[category] } });
        await audit(db, actor, 'create', 'item', item.id, `Item ${item.sku} ${item.name} (past records)`);
        items.set(key(item.name), item);
        docs.items.push(item.id);
        totals.items.added++;
      }
      if (!r.qty) return;
      if (!item.trackInventory) fail(`${item.name} does not keep stock. Put live birds on the Flocks sheet.`);
      const adj = await adjustStock(db, actor, { date: start, itemId: item.id, type: 'OPENING', quantity: r.qty, unitCost: r.cost ?? 0, notes: tag });
      docs.adjustments.push(adj.sourceId!);
      totals.items.stockValue = round2(totals.items.stockValue + adj.value);
    });
  }

  /** A name on a dated row that is not in the books yet is added, and noted. */
  const partyFor = async (k: SheetKey, row: number, name: string, kind: 'CUSTOMER' | 'SUPPLIER') => {
    const found = parties.get(key(name));
    if (found) {
      const hit = await revive('party', found);
      const fits = kind === 'CUSTOMER' ? ['CUSTOMER', 'BOTH'] : ['SUPPLIER', 'BOTH', 'EMPLOYEE'];
      if (!fits.includes(hit.kind)) fail(`${hit.name} is a ${hit.kind.toLowerCase()}, not a ${kind.toLowerCase()}. Set the type to Both on the Customers & suppliers sheet.`);
      return hit;
    }
    const party = await db.party.create({ data: { kind, name, notes: tag } });
    await audit(db, actor, 'create', 'party', party.id, `${kind.toLowerCase()} ${party.name} (past records)`);
    parties.set(key(name), party);
    docs.parties.push(party.id);
    warn(k, row, `${name} is not on the Customers & suppliers sheet, so it is added as a ${kind.toLowerCase()}.`);
    return party;
  };

  for (const r of p.records.parties) {
    await step('parties', r.row, async () => {
      totals.parties.rows++;
      const kind = PARTY_KINDS[key(r.type)];
      let party = parties.get(key(r.name));
      if (party) party = await revive('party', party);
      if (party && party.kind !== kind) warn('parties', r.row, `${party.name} is already in FarmLedger as ${party.kind.toLowerCase()}; that is kept.`);
      if (!party) {
        party = await db.party.create({ data: { kind, name: r.name, phone: normalizePhone(r.phone), notes: r.notes ?? tag } });
        await audit(db, actor, 'create', 'party', party.id, `${kind.toLowerCase()} ${party.name} (past records)`);
        parties.set(key(party.name), party);
        docs.parties.push(party.id);
        totals.parties.added++;
      }
      if (r.owesUs) {
        if (!['CUSTOMER', 'BOTH'].includes(party.kind)) fail(`Only a customer can owe the farm money. Set the type to Customer or Both.`);
        const inv = await createInvoice(db, actor, { date: start, customerId: party.id, notes: `Opening balance. ${tag}`, lines: [{ description: 'Opening balance owed to the farm', quantity: 1, unitPrice: r.owesUs, accountId: equity }] });
        docs.invoices.push(inv.id);
        totals.parties.owesUs = round2(totals.parties.owesUs + r.owesUs);
      }
      if (r.weOwe) {
        if (!['SUPPLIER', 'BOTH', 'EMPLOYEE'].includes(party.kind)) fail(`The farm can only owe a supplier or employee. Set the type to Supplier or Both.`);
        const bill = await createBill(db, actor, { date: start, supplierId: party.id, notes: `Opening balance. ${tag}`, lines: [{ description: 'Opening balance owed by the farm', quantity: 1, unitPrice: r.weOwe, accountId: equity }] });
        docs.bills.push(bill.id);
        totals.parties.weOwe = round2(totals.parties.weOwe + r.weOwe);
      }
    });
  }

  // Dated records, day by day. Within a day: eggs collected, purchases, sales, gifts and waste, grants, payments.
  type Event = { date: string; order: number; k: SheetKey; row: number; work: () => Promise<void> };
  const events: Event[] = [];
  const egg = await db.item.findFirst({ where: { category: 'PRODUCE', active: true, trackInventory: true }, orderBy: { createdAt: 'asc' } });
  const needEgg = () => egg ?? fail('There is no egg item. Add one on the Items sheet (category Produce).');

  for (const r of p.records.daily) {
    totals.daily.rows++;
    const date = toDate(r.date);
    const note = [tag, r.notes].filter(Boolean).join(' ');
    if (r.collected || r.broken || r.died) events.push({ date: r.date, order: 0, k: 'daily', row: r.row, work: async () => {
      const active = [...flocks.values()].filter(f => f.status === 'ACTIVE');
      const flock = r.flock ? flocks.get(key(r.flock)) ?? fail(`Flock ${r.flock} is not on the Flocks sheet or in FarmLedger.`)
        : active.length === 1 ? active[0] : fail(active.length ? 'The farm has more than one flock: enter the flock code.' : 'Add the flock on the Flocks sheet first.');
      const log = await recordProduction(db, actor, { date, flockId: flock.id, eggItemId: needEgg().id, eggsCollected: r.collected ?? 0, eggsBroken: r.broken ?? 0, mortality: r.died ?? 0, notes: note });
      if (r.died) flocks.set(key(flock.code), { ...flock, currentCount: flock.currentCount - r.died });
      docs.production.push(log.id);
      totals.daily.eggsCollected += r.collected ?? 0;
    } });
    if (r.sold) events.push({ date: r.date, order: 2, k: 'daily', row: r.row, work: async () => {
      const item = r.item ? await revive('item', items.get(key(r.item)) ?? fail(`${r.item} is not on the Items sheet or in FarmLedger.`)) : needEgg();
      const price = r.price ?? num(item.salePrice);
      if (!price) fail(`Enter the price per unit (${item.name} has no selling price).`);
      const total = round2(r.sold * price - (r.discount ?? 0));
      const received = r.received ?? total;
      if (received - total > 0.005) fail(`Received (${received}) is more than the sale (${total}).`);
      if (!r.customer && total - received > 0.005) fail('Enter the customer for a sale not fully paid on the day.');
      const customer = r.customer ? await partyFor('daily', r.row, r.customer, 'CUSTOMER') : undefined;
      const inv = await createInvoice(db, actor, {
        date, customerId: customer?.id, customer: customer ? undefined : {}, discount: r.discount ?? 0, notes: note,
        lines: [{ itemId: item.id, quantity: r.sold, unitPrice: price }],
        received: received > 0 ? { amount: received, cashAccountId: await cashAccount(r.account) } : null,
      });
      docs.invoices.push(inv.id);
      totals.daily.sold += r.sold;
      totals.daily.sales = round2(totals.daily.sales + total);
      totals.daily.received = round2(totals.daily.received + received);
    } });
    for (const [field, type] of [['given', 'GIFT'], ['wasted', 'WASTE']] as const) {
      if (r[field]) events.push({ date: r.date, order: 3, k: 'daily', row: r.row, work: async () => {
        const adj = await adjustStock(db, actor, { date, itemId: needEgg().id, type, quantity: r[field], notes: note });
        docs.adjustments.push(adj.sourceId!);
        totals.daily[field] += r[field];
      } });
    }
  }

  for (const r of p.records.purchases) {
    events.push({ date: r.date, order: 1, k: 'purchases', row: r.row, work: async () => {
      totals.purchases.rows++;
      const item = r.item ? await revive('item', items.get(key(r.item)) ?? fail(`${r.item} is not on the Items sheet or in FarmLedger.`)) : null;
      const type = r.type ? EXPENSE_TYPES.find(([l]) => l === r.type)! : null;
      if (!item && !type) fail('Enter the item bought or the expense type.');
      const qty = r.qty ?? 1;
      if (!qty) fail('Quantity cannot be 0.');
      const unitPrice = round2(r.amount / qty);
      const amount = round2(unitPrice * qty);
      if (Math.abs(amount - r.amount) > 0.005) warn('purchases', r.row, `${r.amount} does not divide evenly by ${qty}; posted as ${qty} × ${unitPrice} = ${amount}.`);
      const paid = r.paid ?? amount;
      if (paid - amount > 0.005) fail(`Paid (${paid}) is more than the total (${amount}).`);
      const supplier = r.supplier ? await partyFor('purchases', r.row, r.supplier, 'SUPPLIER') : null;
      const bill = await createBill(db, actor, {
        date: toDate(r.date), supplierId: supplier?.id ?? null, reference: r.reference, notes: [tag, r.notes].filter(Boolean).join(' '),
        lines: [{ itemId: item?.id ?? null, accountId: type ? await accountId(db, type[1]) : null, description: item?.name ?? type![0], quantity: qty, unitPrice }],
        paid: paid > 0 ? { amount: paid, cashAccountId: await cashAccount(r.account) } : null,
      });
      docs.bills.push(bill.id);
      totals.purchases.amount = round2(totals.purchases.amount + amount);
      totals.purchases.paid = round2(totals.purchases.paid + paid);
    } });
  }

  for (const r of p.records.grants) {
    events.push({ date: r.date, order: 4, k: 'grants', row: r.row, work: async () => {
      totals.grants.rows++;
      const pay = await recordGrant(db, actor, { date: toDate(r.date), donor: { name: r.giver, phone: r.phone }, amount: r.amount, cashAccountId: await cashAccount(r.account), reference: r.reference, notes: r.notes });
      docs.payments.push(pay.id);
      if (pay.party && !parties.has(key(pay.party.name))) { parties.set(key(pay.party.name), pay.party); docs.parties.push(pay.party.id); }
      totals.grants.amount = round2(totals.grants.amount + r.amount);
    } });
  }

  for (const r of p.records.payments) {
    events.push({ date: r.date, order: 5, k: 'payments', row: r.row, work: async () => {
      totals.payments.rows++;
      const direction = r.direction === 'In' ? 'IN' : 'OUT';
      const [label, dir, code] = PURPOSES.find(([l]) => l === (r.purpose ?? (direction === 'IN' ? 'Customer payment' : 'Supplier payment')))!;
      if (dir !== direction) fail(`"${label}" is money ${dir === 'IN' ? 'in' : 'out'}, but the row says ${r.direction}.`);
      const date = toDate(r.date);
      const cashAccountId = await cashAccount(r.account);
      const notes = [tag, r.notes].filter(Boolean).join(' ');
      let pay;
      if (!code) {
        if (!r.party) fail(`Enter who paid or was paid for a ${label.toLowerCase()}.`);
        const party = await revive('party', parties.get(key(r.party)) ?? fail(`${r.party} is not on the Customers & suppliers sheet or in FarmLedger.`));
        // Settle the oldest open dues first.
        const open = direction === 'IN'
          ? await db.salesInvoice.findMany({ where: { customerId: party.id, status: { in: ['POSTED', 'PARTIAL'] }, date: { lte: date } }, orderBy: [{ date: 'asc' }, { number: 'asc' }] })
          : await db.bill.findMany({ where: { supplierId: party.id, status: { in: ['POSTED', 'PARTIAL'] }, date: { lte: date } }, orderBy: [{ date: 'asc' }, { number: 'asc' }] });
        let left = r.amount;
        const allocations = [];
        for (const d of open) {
          const due = round2(num(d.total) - num(d.amountPaid));
          const amt = round2(Math.min(left, due));
          if (amt <= 0) continue;
          allocations.push(direction === 'IN' ? { invoiceId: d.id, amount: amt } : { billId: d.id, amount: amt });
          left = round2(left - amt);
          if (left <= 0) break;
        }
        if (left > 0.005) warn('payments', r.row, `${left} more than ${party.name}'s dues on that day; kept as an advance.`);
        pay = await createPayment(db, actor, { direction, date, partyId: party.id, cashAccountId, amount: r.amount, allocations, reference: r.reference, notes });
      } else {
        const party = r.party ? parties.get(key(r.party)) : undefined;
        pay = await createPayment(db, actor, {
          direction, date, partyId: party?.id ?? null, cashAccountId, counterAccountId: await accountId(db, code), amount: r.amount, reference: r.reference,
          notes: [label, r.party && !party ? `(${r.party})` : null, notes].filter(Boolean).join(' '),
        });
      }
      docs.payments.push(pay.id);
      if (direction === 'IN') totals.payments.moneyIn = round2(totals.payments.moneyIn + r.amount);
      else totals.payments.moneyOut = round2(totals.payments.moneyOut + r.amount);
    } });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.row - b.row);
  for (const e of events) await step(e.k, e.row, e.work);
  return { issues, warnings, docs, totals };
}

/** The books after the import: money held, dues both ways, opening balance equity and eggs in store. */
async function positionOf(db: Db) {
  const bal = async (code: string) => accountBalance(db, await accountId(db, code)); // debit − credit
  const egg = await db.item.findFirst({ where: { category: 'PRODUCE', active: true, trackInventory: true }, orderBy: { createdAt: 'asc' } });
  return {
    cash: await bal(SYS.CASH), bank: await bal(SYS.BANK), mobile: await bal(SYS.MOBILE), receivable: await bal(SYS.AR), payable: -(await bal(SYS.AP)),
    openingEquity: -(await bal(SYS.OPENING_EQUITY)), eggsInStore: egg ? num(egg.qtyOnHand) : 0,
  };
}

// ───────────── Preview, guards and import ─────────────

/** Records already in the books in the template's dates, opening balances already posted, and an earlier import of the same records. */
async function guardsOf(db: Db, p: ParsedTemplate) {
  // The same records, or another live import with the same start date (its opening balances would be counted twice).
  const duplicate = await db.importBatch.findFirst({ where: { status: 'POSTED', kind: 'TEMPLATE', OR: [{ fileHash: p.hash }, ...(p.from ? [{ periodFrom: toDate(p.from) }] : [])] } });
  if (!p.from || !p.to) return { duplicateOf: duplicate?.number ?? null, overlap: null };
  const range = { gte: toDate(p.from), lte: toDate(p.to) };
  const [invoices, bills, payments, production, adjustments, journals, openings, batches] = await Promise.all([
    db.salesInvoice.count({ where: { date: range, status: { not: 'VOID' } } }),
    db.bill.count({ where: { date: range, status: { not: 'VOID' } } }),
    db.payment.count({ where: { date: range, status: { not: 'VOID' } } }),
    db.productionLog.count({ where: { date: range, status: { not: 'VOID' } } }),
    db.stockMove.groupBy({ by: ['sourceId'], where: { date: range, sourceType: 'ADJUSTMENT', voided: false } }),
    db.journalEntry.count({ where: { date: range, status: 'POSTED', sourceType: { in: ['MANUAL', 'TRANSFER'] } } }),
    db.journalEntry.count({ where: { status: 'POSTED', sourceType: 'OPENING' } }),
    db.importBatch.findMany({ where: { status: 'POSTED', periodFrom: { lte: range.lte }, periodTo: { gte: range.gte } }, select: { number: true } }),
  ]);
  const existing = { invoices, bills, payments, production, adjustments: adjustments.length, journals };
  const total = Object.values(existing).reduce((a, b) => a + b, 0);
  return {
    duplicateOf: duplicate?.number ?? null,
    overlap: total || openings ? { from: p.from, to: p.to, existing, total, openingBalances: openings, imports: batches.map(b => b.number) } : null,
  };
}

class Rollback extends Error { constructor(public result: Awaited<ReturnType<typeof runTemplate>> & { position: Awaited<ReturnType<typeof positionOf>> }) { super('rollback'); } }
const LIMIT = 300;

export async function previewTemplate(actor: Actor | null, p: ParsedTemplate) {
  const guards = await guardsOf(prisma, p);
  const org = await prisma.organization.findUnique({ where: { id: 'org' } });
  const issues = [...p.issues];
  if (p.from && org?.lockDate && toDate(p.from) <= org.lockDate) issues.unshift({ sheet: 'Start', row: p.start!.row, column: 'Start date', message: `The books are closed up to ${ymd(org.lockDate)}. Reopen that period first.` });
  const cutoff = await importCutoffError(prisma, p.to ? toDate(p.to) : null);
  if (cutoff) issues.unshift({ sheet: 'Start', row: p.start?.row ?? 1, column: 'Dates', message: cutoff });
  // The real import, rolled back: it finds every problem the import would hit.
  const run = await prisma.$transaction(async db => {
    const r = await runTemplate(db, actor, p, { dryRun: true });
    throw new Rollback({ ...r, position: await positionOf(db) });
  }, { maxWait: 10_000, timeout: 180_000 }).catch(e => { if (e instanceof Rollback) return e.result; throw e; });
  issues.push(...run.issues);
  const order = (i: Issue) => SHEETS.findIndex(s => s.name === i.sheet);
  issues.sort((a, b) => order(a) - order(b) || (a.row ?? 0) - (b.row ?? 0));
  return {
    kind: 'TEMPLATE' as const, period: { from: p.from, to: p.to }, rows: Object.fromEntries(SHEETS.map(s => [s.key, p.records[s.key].length])),
    issues: issues.slice(0, LIMIT), issueCount: issues.length, warnings: run.warnings.slice(0, LIMIT), totals: run.totals, position: run.position, ...guards,
  };
}

export async function importTemplate(db: Db, actor: Actor | null, p: ParsedTemplate, opts: { fileName?: string | null; confirmOverlap: boolean }) {
  if (p.issues.length) throw badRequest('Fix the problems shown in the preview, then upload the file again.');
  const cutoff = await importCutoffError(db, p.to ? toDate(p.to) : null);
  if (cutoff) throw badRequest(cutoff);
  const guards = await guardsOf(db, p);
  if (guards.duplicateOf) throw conflict(`These records, or another file with the same start date, were already imported as ${guards.duplicateOf}. Undo that import first if this file replaces it.`);
  if (guards.overlap && !opts.confirmOverlap) throw badRequest('The books already have records in these dates. Tick the box to confirm you are not entering them twice.');
  const r = await runTemplate(db, actor, p, { dryRun: false });
  const position = await positionOf(db);
  const number = await nextNumber(db, 'IMP');
  const summary = { kind: 'TEMPLATE', days: r.totals.daily.rows, netSales: r.totals.daily.sales, totalExpenses: r.totals.purchases.amount, closingCash: position.cash, totals: r.totals, position, warnings: r.warnings.slice(0, LIMIT) };
  const batch = await db.importBatch.create({
    data: { number, kind: 'TEMPLATE', fileName: opts.fileName ?? null, fileHash: p.hash, periodFrom: toDate(p.from!), periodTo: toDate(p.to!), summary: JSON.stringify(summary), documents: JSON.stringify(r.docs), createdById: actor?.id ?? null },
  });
  const count = Object.values(p.records).reduce((a, x) => a + x.length, 0);
  await audit(db, actor, 'create', 'import', batch.id, `Imported past records ${p.from} to ${p.to} (${count} rows) as ${number}`);
  return { batch, summary };
}
