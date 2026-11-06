// Past records template: the downloadable file, reading it back, the preview's problems and totals, the import,
// the guards against entering records twice, and one-step undo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth/auth.js';
import { readXlsx, writeXlsx, type Cell } from '../src/lib/xlsx.js';
import { accountBalance, accountId } from '../src/services/ledger.js';
import { SYS } from '../src/lib/constants.js';
import { SHEETS, TEMPLATE_MARK, buildTemplate, parseTemplate } from '../src/services/past-records.js';
import { withVoucher } from './helpers/voucher.js';

let app: FastifyInstance;
let cookie = '';
let handPaymentId = '';
const PASSWORD = 'PastRecords2026';

const call = async (method: string, url: string, payload?: unknown, c = cookie) => {
  const res = await app.inject({ method: method as any, url: `/api/v1${url}`, payload: withVoucher(method, url, payload) as any, headers: c ? { cookie: c } : {} });
  return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? res.json() as any : res.rawPayload, headers: res.headers };
};

type Data = Partial<Record<(typeof SHEETS)[number]['key'], Record<string, Cell>[]>>;
/** A filled-in template: row 1 headers, row 2 the untouched example, then the given rows. */
const fill = (data: Data, opts: { example?: boolean } = {}) => writeXlsx([
  { name: 'Instructions', rows: [['Title'], [`${TEMPLATE_MARK}, version 1. Do not change this line.`]] },
  ...SHEETS.map(s => ({
    name: s.name, header: true,
    rows: [
      s.cols.map(c => `${c.en}${c.required ? ' *' : ''}\n${c.bn}`),
      opts.example === false ? s.cols.map(() => null) : s.cols.map(c => c.example),
      ...(data[s.key] ?? []).map(rec => s.cols.map(c => rec[c.key] ?? null)),
    ],
  })),
]);
const upload = (buf: Buffer, extra: object = {}) => ({ fileName: 'past.xlsx', fileBase64: buf.toString('base64'), ...extra });
const bal = async (code: string) => accountBalance(prisma, await accountId(prisma, code));

const GOOD: Data = {
  start: [{ date: '01/03/2025', cash: 10000, bank: '50,000', mobile: null }],
  parties: [
    { name: 'PR Feed House', type: 'Supplier', weOwe: 8000 },
    { name: 'PR Hotel', type: 'customer', phone: '01712345678', owesUs: 3000 },
  ],
  items: [
    { name: 'Layer feed', category: 'Feed', unit: 'kg', qty: 100, cost: 50 },
    { name: 'PR Tonic', category: 'Medicine', unit: 'bottle', qty: 10, cost: 20 },
  ],
  flocks: [{ code: 'PR-T1', name: 'Test flock', species: 'Duck', date: '01/01/2025', birds: 100, birdsNow: 98 }],
  daily: [
    { date: '02/03/2025', flock: 'PR-T1', collected: 80, broken: 2, died: 1, sold: 50, price: 16, given: 5 },
    { date: '০৩/০৩/২০২৫', flock: 'PR-T1', collected: 70, sold: 60, price: 16, customer: 'PR Hotel', received: 0, wasted: 3 },
  ],
  purchases: [
    { date: '02/03/2025', supplier: 'PR Feed House', item: 'Layer feed', qty: 100, amount: 5000, paid: 2000, account: 'Cash' },
    { date: '2025-03-04', type: 'Electricity & fuel', amount: 1200 },
  ],
  payments: [
    { date: '05/03/2025', direction: 'Out', party: 'PR Feed House', amount: 9000 },
    { date: '06/03/2025', direction: 'In', party: 'PR Hotel', amount: 3500, account: 'Bank' },
    { date: '07/03/2025', direction: 'In', purpose: 'Owner money in', amount: 5000 },
  ],
  grants: [{ date: '08/03/2025', giver: 'PR District office', amount: 15000, account: 'Bank' }],
};

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
  const owner = await prisma.role.findUniqueOrThrow({ where: { key: 'owner' } });
  await prisma.user.create({ data: { name: 'Past records owner', email: 'owner@past-records.test.local', roleId: owner.id, passwordHash: await hashPassword(PASSWORD) } });
  app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@past-records.test.local', password: PASSWORD } });
  cookie = String(res.headers['set-cookie']).split(';')[0];
  // A record typed in by hand inside the template's dates, so the overlap guard has something to find.
  const typed = await call('POST', '/payments', { direction: 'IN', date: '2025-03-05', cashAccountId: await accountId(prisma, SYS.CASH), counterAccountId: await accountId(prisma, SYS.OTHER_INCOME), amount: 1, notes: 'Typed in by hand' });
  expect(typed.status).toBe(200);
  handPaymentId = typed.body.id;
});
afterAll(async () => {
  // Leave the shared test database as it was: undo anything still imported here.
  for (const b of await prisma.importBatch.findMany({ where: { kind: 'TEMPLATE', status: 'POSTED' } })) await call('POST', `/import/batches/${b.id}/undo`, { reason: 'test cleanup' });
  await call('POST', `/payments/${handPaymentId}/void`, { reason: 'test cleanup, typed by hand' });
  await prisma.user.updateMany({ where: { email: 'owner@past-records.test.local' }, data: { active: false } });
  await app?.close();
});

describe('the template file', () => {
  it('downloads with instructions and one sheet per kind of record', async () => {
    const r = await call('GET', '/import/template');
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('spreadsheetml');
    expect(String(r.headers['content-disposition'])).toContain('FarmLedger-past-records-template.xlsx');
    const sheets = readXlsx(r.body as Buffer);
    expect(sheets.map(s => s.name)).toEqual(['Instructions', 'Start', 'Customers & suppliers', 'Items & stock', 'Flocks', 'Daily eggs & sales', 'Purchases & expenses', 'Payments', 'Grants']);
    expect(String(sheets[0].cells.get('A2'))).toContain(TEMPLATE_MARK);
    expect(String(sheets[1].cells.get('A1'))).toBe('Start date *\nশুরুর তারিখ');
    expect(sheets[1].cells.get('B2')).toBe(25000); // the example row
    const help = [...sheets[0].cells.values()].map(String).join('\n');
    for (const s of SHEETS) for (const c of s.cols) expect(help).toContain(c.help);
  });

  it('reads back empty: the example rows are skipped and the start date is asked for', () => {
    const p = parseTemplate(buildTemplate());
    expect(Object.values(p.records).every(x => x.length === 0)).toBe(true);
    expect(p.issues).toEqual([{ sheet: 'Start', row: 3, column: 'Start date', message: 'Enter the start date of the books on the Start sheet.' }]);
  });

  it('refuses another spreadsheet with NOT_TEMPLATE, so the monthly workbook still goes its own way', async () => {
    const other = writeXlsx([{ name: 'Sheet1', rows: [['hello']] }]);
    const r = await call('POST', '/import/template/preview', upload(other));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('NOT_TEMPLATE');
  });
});

describe('reading the rows', () => {
  it('reads dates, Bangla digits, commas and choices in any case', () => {
    const p = parseTemplate(fill(GOOD));
    expect(p.issues).toEqual([]);
    expect(p.start).toMatchObject({ row: 3, date: '2025-03-01', cash: 10000, bank: 50000, mobile: null });
    expect(p.records.daily.map(r => r.date)).toEqual(['2025-03-02', '2025-03-03']);
    expect(p.records.purchases[1].date).toBe('2025-03-04');
    expect(p.records.parties[1].type).toBe('Customer');
    expect(p.from).toBe('2025-03-01');
    expect(p.to).toBe('2025-03-08');
  });

  it('reads the first data row from row 2 when the example row was replaced', () => {
    const p = parseTemplate(fill({ start: [{ date: '01/03/2025', cash: 5 }] }, { example: false }));
    expect(p.start).toMatchObject({ row: 3, cash: 5 });
    const own = parseTemplate(writeXlsx([
      { name: 'Instructions', rows: [[''], [TEMPLATE_MARK]] },
      { name: 'Start', header: true, rows: [['Start date *', 'Cash in hand', 'Bank balance', 'Mobile banking balance'], ['01/02/2025']] },
    ]));
    expect(own.start).toMatchObject({ row: 2, date: '2025-02-01' });
  });

  it('names the sheet, row, column and reason for each problem', () => {
    const p = parseTemplate(fill({
      start: [{ date: '01/03/2025' }],
      parties: [{ name: 'A', type: 'Friend' }, { name: 'B', type: 'Customer', owesUs: 'lots' }, { type: 'Supplier' }, { name: 'a', type: 'Customer' }],
      flocks: [{ code: 'X', name: 'X', date: '31/02/2025', birds: 10.5 }],
      daily: [{ date: '28/02/2025', collected: 5 }, { date: '01/01/2099', collected: 5 }, { date: 'yesterday' }],
      purchases: [{ date: '02/03/2025', type: 'Feed', amount: -5 }],
    }));
    const at = (sheet: string, row: number) => p.issues.filter(i => i.sheet === sheet && i.row === row).map(i => `${i.column}: ${i.message}`);
    expect(at('Customers & suppliers', 3)).toEqual(['Type: "Friend" is not one of: Customer, Supplier, Both, Donor, Employee.']);
    expect(at('Customers & suppliers', 4)).toEqual(['Owes us on start date: "lots" is not a number.']);
    expect(at('Customers & suppliers', 5)).toEqual(['Name: Required.']);
    expect(at('Customers & suppliers', 6)).toEqual([]); // "a" only clashes with "A" once "A" is valid; A has a bad type
    expect(at('Flocks', 3)).toEqual(['Date started: "31/02/2025" is not a date. Use day/month/year, e.g. 15/03/2026.', 'Birds at start: Must be a whole number.']);
    expect(at('Daily eggs & sales', 3)).toEqual(['Date: Before the start date (2025-03-01). Move it to the Start figures or change the start date.']);
    expect(at('Daily eggs & sales', 4)).toEqual(['Date: This date is in the future.']);
    expect(at('Daily eggs & sales', 5)[0]).toContain('"yesterday" is not a date');
    expect(at('Purchases & expenses', 3)).toEqual(['Total amount: Cannot be below zero.']);
  });

  it('refuses a sheet with a heading renamed or deleted, so "Received now" cannot quietly read as all paid', () => {
    const daily = SHEETS.find(s => s.key === 'daily')!;
    const p = parseTemplate(writeXlsx([
      { name: 'Instructions', rows: [[''], [TEMPLATE_MARK]] },
      { name: 'Start', header: true, rows: [SHEETS[0].cols.map(c => c.en), [null], ['01/03/2025']] },
      { name: 'Daily eggs & sales', header: true, rows: [daily.cols.map(c => (c.key === 'received' ? 'Cash got' : c.en)), daily.cols.map(() => null), ['02/03/2025']] },
    ]));
    expect(p.issues).toEqual([{ sheet: 'Daily eggs & sales', row: 1, column: 'Received now', message: 'This heading is missing from row 1. Download a fresh template and copy your rows into it.' }]);
    expect(p.records.daily).toEqual([]);
  });

  it('caps the rows per file', () => {
    const p = parseTemplate(fill({ start: [{ date: '01/03/2025' }], grants: Array.from({ length: 5001 }, () => ({ date: '02/03/2025', giver: 'X', amount: 1 })) }));
    expect(p.issues.map(i => i.message)).toContainEqual(expect.stringContaining('at most 5000 can be imported at once'));
  });

  it('reads an Excel date-time in the afternoon as that day', () => {
    const p = parseTemplate(fill({ start: [{ date: 45717.75 }] })); // 2025-03-01 18:00
    expect(p.start?.date).toBe('2025-03-01');
  });

  it('refuses the same name twice on one sheet', () => {
    const p = parseTemplate(fill({ start: [{ date: '01/03/2025' }], parties: [{ name: 'Same', type: 'Customer' }, { name: 'SAME', type: 'Supplier' }] }));
    expect(p.issues).toEqual([{ sheet: 'Customers & suppliers', row: 4, column: 'Name', message: '"SAME" is already on row 3.' }]);
  });

  it('gives the same fingerprint to the same records, whatever the file name', () => {
    expect(parseTemplate(fill(GOOD)).hash).toBe(parseTemplate(fill(GOOD, { example: false })).hash);
    expect(parseTemplate(fill({ ...GOOD, grants: [] })).hash).not.toBe(parseTemplate(fill(GOOD)).hash);
  });
});

describe('preview', () => {
  it('shows totals per sheet and the position after import, and saves nothing', async () => {
    const before = { invoices: await prisma.salesInvoice.count(), parties: await prisma.party.count(), batches: await prisma.importBatch.count(), cash: await bal(SYS.CASH) };
    const r = await call('POST', '/import/template/preview', upload(fill(GOOD)));
    expect(r.status).toBe(200);
    expect(r.body.issues).toEqual([]);
    expect(r.body.period).toEqual({ from: '2025-03-01', to: '2025-03-08' });
    expect(r.body.rows).toMatchObject({ start: 1, parties: 2, items: 2, flocks: 1, daily: 2, purchases: 2, payments: 3, grants: 1 });
    expect(r.body.totals).toEqual({
      start: { cash: 10000, bank: 50000, mobile: 0 },
      parties: { rows: 2, added: 2, owesUs: 3000, weOwe: 8000 },
      items: { rows: 2, added: 1, stockValue: 5200 },
      flocks: { rows: 1, added: 1, birds: 98 },
      daily: { rows: 2, eggsCollected: 150, sold: 110, sales: 1760, received: 800, given: 5, wasted: 3 },
      purchases: { rows: 2, amount: 6200, paid: 3200 },
      payments: { rows: 3, moneyIn: 8500, moneyOut: 9000 },
      grants: { rows: 1, amount: 15000 },
    });
    expect(r.body.position.cash).toBe(before.cash + 3600);
    expect(r.body.duplicateOf).toBeNull();
    expect(r.body.overlap?.existing.payments).toBeGreaterThanOrEqual(1); // the payment typed in by hand
    expect({ invoices: await prisma.salesInvoice.count(), parties: await prisma.party.count(), batches: await prisma.importBatch.count(), cash: await bal(SYS.CASH) }).toEqual(before);
  });

  it('lists the problems the import itself would hit, row by row', async () => {
    const r = await call('POST', '/import/template/preview', upload(fill({
      ...GOOD,
      daily: [{ date: '02/03/2025', flock: 'PR-T1', collected: 10, sold: 500, price: 16 }, { date: '03/03/2025', flock: 'PR-T1', sold: 5, price: 16, received: 0 }],
      purchases: [{ date: '02/03/2025', amount: 100 }],
      payments: [{ date: '05/03/2025', direction: 'Out', party: 'Nobody Ltd', amount: 10 }, { date: '05/03/2025', direction: 'In', purpose: 'Owner drawings', amount: 10 }],
    })));
    expect(r.status).toBe(200);
    const rows = r.body.issues.map((i: any) => `${i.sheet} ${i.row}: ${i.message}`);
    expect(rows).toContainEqual(expect.stringMatching(/^Daily eggs & sales 3: .*stock|^Daily eggs & sales 3: .*available/i));
    expect(rows).toContain('Daily eggs & sales 4: Enter the customer for a sale not fully paid on the day.');
    expect(rows).toContain('Purchases & expenses 3: Enter the item bought or the expense type.');
    expect(rows).toContain('Payments 3: Nobody Ltd is not on the Customers & suppliers sheet or in FarmLedger.');
    expect(rows).toContain('Payments 4: "Owner drawings" is money out, but the row says In.');
  });
});

describe('import and undo', () => {
  let batchId = '';
  const cash0 = { cash: 0, bank: 0, equity: 0 };

  it('refuses dates that overlap the books until the owner confirms', async () => {
    const r = await call('POST', '/import/template', upload(fill(GOOD)));
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Tick the box');
  });

  it('refuses a file with problems', async () => {
    const r = await call('POST', '/import/template', upload(fill({ ...GOOD, purchases: [{ date: '02/03/2025', amount: 100 }] }), { confirmOverlap: true }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Purchases & expenses, row 3: Enter the item bought or the expense type.');
    expect(await prisma.party.count({ where: { name: 'PR Feed House' } })).toBe(0);
  });

  it('posts everything, balanced against opening balance equity', async () => {
    Object.assign(cash0, { cash: await bal(SYS.CASH), bank: await bal(SYS.BANK), equity: await bal(SYS.OPENING_EQUITY) });
    const eggs0 = Number((await prisma.item.findFirstOrThrow({ where: { sku: 'EGG-DUCK' } })).qtyOnHand);
    const r = await call('POST', '/import/template', upload(fill(GOOD), { confirmOverlap: true }));
    expect(r.status).toBe(200);
    batchId = r.body.batch.id;
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch).toMatchObject({ kind: 'TEMPLATE', fileName: 'past.xlsx', status: 'POSTED' });
    expect(batch.fileHash).toHaveLength(64);

    expect((await call('GET', '/reports/trial-balance?asOf=2026-12-31')).body.balanced).toBe(true);
    expect(await bal(SYS.CASH) - cash0.cash).toBe(3600);
    expect(await bal(SYS.BANK) - cash0.bank).toBe(68500);
    // cash 10000 + bank 50000 + owed to us 3000 − we owe 8000 + stock 5000 + 200
    expect(cash0.equity - (await bal(SYS.OPENING_EQUITY))).toBe(60200);
    const hotel = await prisma.party.findFirstOrThrow({ where: { name: 'PR Hotel' } });
    const feed = await prisma.party.findFirstOrThrow({ where: { name: 'PR Feed House' } });
    expect(hotel.phone).toBe('01712345678');
    const open = async (where: object, model: 'salesInvoice' | 'bill') => (await (prisma[model] as any).findMany({ where: { ...where, status: { not: 'VOID' } } })).reduce((a: number, d: any) => a + Number(d.total) - Number(d.amountPaid), 0);
    expect(await open({ customerId: hotel.id }, 'salesInvoice')).toBe(460);
    expect(await open({ supplierId: feed.id }, 'bill')).toBe(2000);
    expect(Number((await prisma.item.findFirstOrThrow({ where: { sku: 'EGG-DUCK' } })).qtyOnHand) - eggs0).toBe(148 - 110 - 5 - 3);
    const flock = await prisma.flock.findUniqueOrThrow({ where: { code: 'PR-T1' } });
    expect(flock.currentCount).toBe(97);
    const grant = await prisma.payment.findFirstOrThrow({ where: { party: { name: 'PR District office' } } });
    expect(grant.counterAccountId).toBe(await accountId(prisma, SYS.GRANT_INCOME));
  });

  it('refuses the same records a second time, even from a file saved again', async () => {
    const pre = await call('POST', '/import/template/preview', upload(fill(GOOD, { example: false })));
    expect(pre.body.duplicateOf).toMatch(/^IMP-/);
    const r = await call('POST', '/import/template', upload(fill(GOOD, { example: false }), { confirmOverlap: true }));
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('already imported');
  });

  it('refuses a different file with the same start date while the first import stands', async () => {
    const r = await call('POST', '/import/template', upload(fill({ ...GOOD, grants: [] }), { confirmOverlap: true }));
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('same start date');
  });

  it('warns that the dates now overlap the imported records', async () => {
    const r = await call('POST', '/import/template/preview', upload(fill({ start: [{ date: '01/03/2025' }], grants: [{ date: '08/03/2025', giver: 'Someone else', amount: 1 }] })));
    expect(r.body.overlap.total).toBeGreaterThan(0);
    expect(r.body.overlap.imports).toContain((await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).number);
  });

  it('will not undo while a payment entered later settles an imported record', async () => {
    const hotel = await prisma.party.findFirstOrThrow({ where: { name: 'PR Hotel' } });
    const inv = await prisma.salesInvoice.findFirstOrThrow({ where: { customerId: hotel.id, status: { not: 'PAID' } } });
    const pay = await call('POST', '/payments', { direction: 'IN', date: '2025-03-20', partyId: hotel.id, cashAccountId: await accountId(prisma, SYS.CASH), amount: 100, allocations: [{ invoiceId: inv.id, amount: 100 }] });
    expect(pay.status).toBe(200);
    const r = await call('POST', `/import/batches/${batchId}/undo`, { reason: 'testing undo' });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain(pay.body.number);
    expect((await call('POST', `/payments/${pay.body.id}/void`, { reason: 'entered by mistake' })).body.message ?? 'ok').toBe('ok');
  });

  it('blocks replacing a workbook month that a past records import covers', async () => {
    const extra = await call('POST', '/import/template', upload(fill({ start: [{ date: '01/10/2026' }], grants: [{ date: '05/10/2026', giver: 'PR October donor', amount: 1 }] }), { confirmOverlap: true }));
    expect(extra.body.message ?? 'ok').toBe('ok');
    const dir = new URL('../../../upload/', import.meta.url);
    const { readdirSync, readFileSync } = await import('node:fs');
    const name = readdirSync(dir).find(f => f.endsWith('.xlsx'))!;
    const wb = { fileName: name, fileBase64: readFileSync(new URL(name, dir)).toString('base64') };
    const pre = await call('POST', '/import/workbook/preview', wb);
    expect(pre.body.blockers).toContainEqual(expect.stringContaining(extra.body.batch.number));
    expect((await call('POST', '/import/workbook', { ...wb, replaceExisting: true })).status).toBe(409);
    expect((await call('POST', `/import/batches/${extra.body.batch.id}/undo`, { reason: 'testing the block' })).status).toBe(200);
  });

  it('undoes in one step, and the records can then be imported again', async () => {
    expect((await call('POST', `/import/batches/${batchId}/undo`, { reason: 'testing undo' })).body.message ?? 'ok').toBe('ok');
    expect((await call('GET', '/reports/trial-balance?asOf=2026-12-31')).body.balanced).toBe(true);
    expect(await bal(SYS.CASH)).toBe(cash0.cash);
    expect(await bal(SYS.BANK)).toBe(cash0.bank);
    expect(await bal(SYS.OPENING_EQUITY)).toBe(cash0.equity);
    expect((await prisma.party.findFirstOrThrow({ where: { name: 'PR Hotel' } })).active).toBe(false);
    expect((await prisma.item.findFirstOrThrow({ where: { name: 'PR Tonic' } })).active).toBe(false);
    expect((await prisma.item.findFirstOrThrow({ where: { name: 'Layer feed' } })).active).toBe(true); // was there before
    expect((await prisma.flock.findUniqueOrThrow({ where: { code: 'PR-T1' } })).status).toBe('CLOSED');

    const again = await call('POST', '/import/template', upload(fill(GOOD), { confirmOverlap: true }));
    expect(again.status).toBe(200);
    expect((await prisma.party.findFirstOrThrow({ where: { name: 'PR Hotel' } })).active).toBe(true);
    expect((await prisma.flock.findUniqueOrThrow({ where: { code: 'PR-T1' } })).status).toBe('ACTIVE');
    expect(await bal(SYS.CASH) - cash0.cash).toBe(3600);
    expect((await call('POST', `/import/batches/${again.body.batch.id}/undo`, { reason: 'testing undo again' })).status).toBe(200);
    expect(await bal(SYS.CASH)).toBe(cash0.cash);
  });

  it('lists template imports with the monthly workbook ones', async () => {
    const r = await call('GET', '/import/batches');
    const mine = r.body.data.filter((b: any) => b.kind === 'TEMPLATE');
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0].summary).toMatchObject({ kind: 'TEMPLATE', days: 2, netSales: 1760, totalExpenses: 6200 });
  });
});
