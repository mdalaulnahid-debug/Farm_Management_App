// Initial data: organization, roles, owner account, farm chart of accounts, items and
// (optionally) the October 2026 workbook history posted through the real services.
import { prisma, tx } from './db.js';
import { DEFAULT_ROLES, SYS } from './lib/constants.js';
import { hashPassword } from './auth/auth.js';
import { toDate } from './lib/dates.js';
import { accountId, clearAccountCache, postEntry } from './services/ledger.js';
import { createInvoice } from './services/sales.js';
import { createBill } from './services/purchases.js';
import { createPayment } from './services/payments.js';
import { adjustStock, recordProduction } from './services/operations.js';

type A = [code: string, name: string, nameBn: string, type: string, subtype: string, cashFlow?: string, system?: boolean];
export const CHART: A[] = [
  [SYS.CASH, 'Cash in hand', 'হাতে নগদ', 'ASSET', 'CASH', 'OPERATING', true],
  [SYS.BANK, 'Bank account', 'ব্যাংক হিসাব', 'ASSET', 'BANK', 'OPERATING', true],
  [SYS.MOBILE, 'Mobile banking (bKash/Nagad)', 'মোবাইল ব্যাংকিং (বিকাশ/নগদ)', 'ASSET', 'BANK', 'OPERATING', true],
  [SYS.AR, 'Accounts receivable', 'ক্রেতার কাছে পাওনা', 'ASSET', 'RECEIVABLE', 'OPERATING', true],
  [SYS.INV_FEED, 'Feed inventory', 'খাদ্য মজুদ', 'ASSET', 'INVENTORY', 'OPERATING', true],
  [SYS.INV_MEDICINE, 'Medicine & vaccine inventory', 'ওষুধ ও টিকা মজুদ', 'ASSET', 'INVENTORY', 'OPERATING', true],
  [SYS.INV_PRODUCE, 'Produce inventory', 'উৎপাদিত পণ্য মজুদ', 'ASSET', 'INVENTORY', 'OPERATING', true],
  [SYS.INV_SUPPLIES, 'Supplies inventory', 'সরবরাহ সামগ্রী মজুদ', 'ASSET', 'INVENTORY', 'OPERATING', true],
  ['1300', 'Advances & prepayments', 'অগ্রিম ও অগ্রিম পরিশোধ', 'ASSET', 'CURRENT_ASSET', 'OPERATING'],
  [SYS.LIVESTOCK, 'Livestock (birds)', 'পশুপাখি (হাঁস)', 'ASSET', 'BIOLOGICAL_ASSET', 'INVESTING', true],
  ['1610', 'Land & buildings', 'জমি ও ভবন', 'ASSET', 'FIXED_ASSET', 'INVESTING'],
  ['1620', 'Sheds, ponds & equipment', 'শেড, পুকুর ও যন্ত্রপাতি', 'ASSET', 'FIXED_ASSET', 'INVESTING'],
  ['1690', 'Accumulated depreciation', 'সঞ্চিত অবচয়', 'ASSET', 'FIXED_ASSET', 'INVESTING'],
  [SYS.AP, 'Accounts payable', 'সরবরাহকারীর দেনা', 'LIABILITY', 'PAYABLE', 'OPERATING', true],
  ['2100', 'Wages payable', 'প্রদেয় মজুরি', 'LIABILITY', 'CURRENT_LIABILITY', 'OPERATING'],
  ['2200', 'Short-term loans', 'স্বল্পমেয়াদি ঋণ', 'LIABILITY', 'CURRENT_LIABILITY', 'FINANCING'],
  ['2500', 'Long-term loans', 'দীর্ঘমেয়াদি ঋণ', 'LIABILITY', 'LONG_TERM_LIABILITY', 'FINANCING'],
  [SYS.OWNER_CAPITAL, "Owner's capital", 'মালিকের মূলধন', 'EQUITY', 'EQUITY', 'FINANCING', true],
  [SYS.OWNER_DRAWINGS, "Owner's drawings", 'মালিকের উত্তোলন', 'EQUITY', 'EQUITY', 'FINANCING', true],
  [SYS.OPENING_EQUITY, 'Opening balance equity', 'প্রারম্ভিক স্থিতি মূলধন', 'EQUITY', 'EQUITY', 'FINANCING', true],
  [SYS.RETAINED_EARNINGS, 'Retained earnings', 'সংরক্ষিত আয়', 'EQUITY', 'EQUITY', 'FINANCING', true],
  [SYS.SALES_EGGS, 'Egg sales', 'ডিম বিক্রয়', 'INCOME', 'SALES', 'OPERATING', true],
  [SYS.SALES_LIVESTOCK, 'Duck & livestock sales', 'হাঁস বিক্রয়', 'INCOME', 'SALES', 'OPERATING', true],
  ['4030', 'Manure & by-product sales', 'সার ও উপজাত বিক্রয়', 'INCOME', 'SALES', 'OPERATING'],
  [SYS.SALES_OTHER, 'Other sales', 'অন্যান্য বিক্রয়', 'INCOME', 'SALES', 'OPERATING', true],
  [SYS.SALES_DISCOUNT, 'Sales discounts', 'বিক্রয় ছাড়', 'INCOME', 'SALES', 'OPERATING', true],
  [SYS.OTHER_INCOME, 'Other income', 'অন্যান্য আয়', 'INCOME', 'OTHER_INCOME', 'OPERATING', true],
  ['4510', 'Grants & subsidies', 'অনুদান ও ভর্তুকি', 'INCOME', 'OTHER_INCOME', 'OPERATING'],
  [SYS.COGS, 'Cost of goods sold', 'বিক্রীত পণ্যের ব্যয়', 'EXPENSE', 'COGS', 'OPERATING', true],
  [SYS.FEED_EXPENSE, 'Feed expense', 'খাদ্য খরচ', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', true],
  ['6015', 'Snails & supplementary feed', 'শামুক ও সম্পূরক খাদ্য', 'EXPENSE', 'OPERATING_EXPENSE'],
  [SYS.MEDICINE_EXPENSE, 'Medicine & veterinary', 'ওষুধ ও পশু চিকিৎসা', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', true],
  ['6030', 'Labour & wages', 'শ্রমিক ও মজুরি', 'EXPENSE', 'OPERATING_EXPENSE'],
  ['6040', 'Electricity, fuel & water', 'বিদ্যুৎ, জ্বালানি ও পানি', 'EXPENSE', 'OPERATING_EXPENSE'],
  ['6050', 'Transport & packaging', 'পরিবহন ও প্যাকেজিং', 'EXPENSE', 'OPERATING_EXPENSE'],
  ['6060', 'Repairs & maintenance', 'মেরামত ও রক্ষণাবেক্ষণ', 'EXPENSE', 'OPERATING_EXPENSE'],
  ['6070', 'Rent & lease', 'ভাড়া ও ইজারা', 'EXPENSE', 'OPERATING_EXPENSE'],
  ['6080', 'Depreciation', 'অবচয়', 'EXPENSE', 'OPERATING_EXPENSE'],
  ['6090', 'Other farm expenses', 'অন্যান্য খামার খরচ', 'EXPENSE', 'OPERATING_EXPENSE'],
  ['6100', 'Office, phone & admin', 'অফিস, ফোন ও প্রশাসনিক', 'EXPENSE', 'OPERATING_EXPENSE'],
  [SYS.INVENTORY_LOSS, 'Inventory loss, gifts & spoilage', 'মজুদ ক্ষতি, উপহার ও নষ্ট', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', true],
  [SYS.CASH_SHORTAGE, 'Cash over / short', 'নগদ ঘাটতি / উদ্বৃত্ত', 'EXPENSE', 'OTHER_EXPENSE', 'OPERATING', true],
  ['7010', 'Interest expense', 'সুদ খরচ', 'EXPENSE', 'OTHER_EXPENSE', 'FINANCING'],
  ['7020', 'Bank & mobile charges', 'ব্যাংক ও মোবাইল চার্জ', 'EXPENSE', 'OTHER_EXPENSE'],
];

export async function seed(opts: { history?: boolean; adminEmail?: string; adminPassword?: string; adminName?: string } = {}) {
  if (await prisma.organization.findUnique({ where: { id: 'org' } })) return { created: false };
  clearAccountCache();

  await prisma.organization.create({ data: { id: 'org', name: 'Duck & Egg Farm', currency: 'BDT', fiscalYearStart: 7, invoiceFooter: 'Thank you for your business.' } });
  for (const r of DEFAULT_ROLES) await prisma.role.create({ data: { key: r.key, name: r.name, description: r.description, permissions: JSON.stringify(r.permissions), system: true } });
  const owner = await prisma.role.findUniqueOrThrow({ where: { key: 'owner' } });
  const admin = await prisma.user.create({
    data: {
      name: opts.adminName || 'Farm Owner', email: (opts.adminEmail || 'owner@farm.local').toLowerCase(),
      passwordHash: await hashPassword(opts.adminPassword || 'ChangeMe!2026'), roleId: owner.id, mustChangePassword: true,
    },
  });
  for (const [code, name, nameBn, type, subtype, cashFlow = 'OPERATING', system = false] of CHART) {
    await prisma.account.create({ data: { code, name, nameBn, type, subtype, cashFlow, system } });
  }
  const acc = async (code: string) => accountId(prisma, code);

  const eggs = await prisma.item.create({ data: { sku: 'EGG-DUCK', name: 'Duck eggs', nameBn: 'হাঁসের ডিম', category: 'PRODUCE', unit: 'pcs', salePrice: 16, trackInventory: true, valued: false, incomeAccountId: await acc(SYS.SALES_EGGS), inventoryAccountId: await acc(SYS.INV_PRODUCE) } });
  await prisma.item.create({ data: { sku: 'FEED-LAYER', name: 'Layer feed', nameBn: 'লেয়ার খাদ্য', category: 'FEED', unit: 'kg', purchasePrice: 55, trackInventory: true, valued: true, reorderLevel: 100, inventoryAccountId: await acc(SYS.INV_FEED), expenseAccountId: await acc(SYS.FEED_EXPENSE) } });
  await prisma.item.create({ data: { sku: 'SNAIL', name: 'Snails (fresh feed)', nameBn: 'শামুক', category: 'FEED', unit: 'kg', trackInventory: false, valued: false, expenseAccountId: await acc('6015') } });
  await prisma.item.create({ data: { sku: 'MED', name: 'Medicine & vaccine', nameBn: 'ওষুধ ও টিকা', category: 'MEDICINE', unit: 'unit', trackInventory: false, valued: false, expenseAccountId: await acc(SYS.MEDICINE_EXPENSE) } });
  await prisma.item.create({ data: { sku: 'DUCK-LIVE', name: 'Live ducks', nameBn: 'জীবন্ত হাঁস', category: 'LIVESTOCK', unit: 'head', salePrice: 450, trackInventory: false, valued: false, incomeAccountId: await acc(SYS.SALES_LIVESTOCK) } });
  const site = await prisma.site.create({ data: { name: 'Main farm', kind: 'FARM' } });
  const flock = await prisma.flock.create({ data: { code: 'FLK-01', name: 'Main laying flock', species: 'DUCK', siteId: site.id, startDate: toDate('2026-10-01'), openingCount: 0, currentCount: 0, notes: 'Set the actual number of birds in Production → Flocks so laying rate can be calculated.' } });
  const walkIn = await prisma.party.create({ data: { kind: 'CUSTOMER', name: 'Walk-in customers', notes: 'Counter / cash sales without a named customer.' } });

  if (opts.history) await importOctober({ adminId: admin.id, eggsId: eggs.id, flockId: flock.id, walkInId: walkIn.id });
  return { created: true, adminEmail: admin.email };
}

/** October 2026 workbook rows, posted through the same services as live data. */
async function importOctober(ids: { adminId: string; eggsId: string; flockId: string; walkInId: string }) {
  const actor = { id: ids.adminId };
  const rows = [
    { date: '2026-10-27', produced: 4993, cashEggs: 4229, creditEggs: 402, discount: 54, feed: 31505, snails: 23030, other: 350, medicine: 5234, donated: 362, note: '' },
    { date: '2026-10-28', produced: 151, cashEggs: 148, creditEggs: 0, discount: 0, feed: 0, snails: 900, other: 0, medicine: 0, donated: 0, note: 'Workbook date entered as 28/10/27; normalized to 28 Oct 2026.' },
    { date: '2026-10-29', produced: 152, cashEggs: 119, creditEggs: 0, discount: 0, feed: 0, snails: 900, other: 0, medicine: 0, donated: 36, note: '' },
    { date: '2026-10-30', produced: 144, cashEggs: 104, creditEggs: 40, discount: 0, feed: 0, snails: 900, other: 0, medicine: 0, donated: 0, note: '' },
    { date: '2026-10-31', produced: 0, cashEggs: 0, creditEggs: 0, discount: 0, feed: 0, snails: 900, other: 0, medicine: 0, donated: 0, note: '' },
  ];
  const credit = await prisma.party.create({ data: { kind: 'CUSTOMER', name: 'Credit customers (October workbook)', notes: 'Aggregated credit sales from the October workbook. Split into real customers when known.' } });
  const openingAR = await prisma.party.create({ data: { kind: 'CUSTOMER', name: 'Opening receivables (October)', notes: 'Receivable balance carried in from before 26 Oct 2026.' } });
  const cash = await accountId(prisma, SYS.CASH);
  const exp = async (code: string) => accountId(prisma, code);
  const src = 'Imported from October 2026 workbook.';

  await tx(async db => {
    // Opening position on 26 Oct 2026 (cash was overdrawn by BDT 5,410 per the workbook).
    await postEntry(db, actor, { date: toDate('2026-10-26'), memo: 'Opening cash per October workbook', sourceType: 'OPENING', lines: [{ accountId: await exp(SYS.OPENING_EQUITY), debit: 5410 }, { accountId: cash, credit: 5410 }] });
    await createInvoice(db, actor, { date: toDate('2026-10-26'), customerId: openingAR.id, notes: 'Opening receivable', lines: [{ description: 'Opening receivable balance', quantity: 1, unitPrice: 3480, accountId: await exp(SYS.OPENING_EQUITY) }] });

    for (const r of rows) {
      const date = toDate(r.date);
      const notes = [src, r.note].filter(Boolean).join(' ');
      if (r.produced > 0) await recordProduction(db, actor, { date, flockId: ids.flockId, eggItemId: ids.eggsId, eggsCollected: r.produced, notes });
      if (r.cashEggs > 0) {
        const total = r.cashEggs * 16 - r.discount;
        await createInvoice(db, actor, { date, customerId: ids.walkInId, discount: r.discount, notes, lines: [{ itemId: ids.eggsId, quantity: r.cashEggs, unitPrice: 16 }], received: { amount: total, cashAccountId: cash } });
      }
      if (r.creditEggs > 0) await createInvoice(db, actor, { date, customerId: credit.id, notes, lines: [{ itemId: ids.eggsId, quantity: r.creditEggs, unitPrice: 16 }] });
      if (r.donated > 0) await adjustStock(db, actor, { date, itemId: ids.eggsId, type: 'GIFT', quantity: r.donated, notes });
      const lines = [
        r.feed && { accountId: await exp(SYS.FEED_EXPENSE), description: 'Feed purchase (expensed: feed consumption not recorded in workbook)', quantity: 1, unitPrice: r.feed },
        r.snails && { accountId: await exp('6015'), description: 'Snails / supplementary feed', quantity: 1, unitPrice: r.snails },
        r.other && { accountId: await exp('6050'), description: 'Transport / packaging / other', quantity: 1, unitPrice: r.other },
        r.medicine && { accountId: await exp(SYS.MEDICINE_EXPENSE), description: 'Medicine / veterinary', quantity: 1, unitPrice: r.medicine },
      ].filter(Boolean) as { accountId: string; description: string; quantity: number; unitPrice: number }[];
      if (lines.length) {
        const total = lines.reduce((a, l) => a + l.unitPrice, 0);
        await createBill(db, actor, { date, notes, lines, paid: { amount: total, cashAccountId: cash } });
      }
    }
    const oct31 = toDate('2026-10-31');
    await createBill(db, actor, { date: oct31, notes: `${src} Monthly other costs.`, lines: [{ accountId: await exp('6090'), description: 'Other monthly costs', quantity: 1, unitPrice: 7000 }], paid: { amount: 7000, cashAccountId: cash } });
    const opening = await db.salesInvoice.findFirstOrThrow({ where: { customerId: openingAR.id } });
    await createPayment(db, actor, { direction: 'IN', date: oct31, partyId: openingAR.id, cashAccountId: cash, amount: 3480, notes: 'Collection of opening receivables (October workbook)', allocations: [{ invoiceId: opening.id, amount: 3480 }] });
    await createPayment(db, actor, { direction: 'IN', date: oct31, cashAccountId: cash, counterAccountId: await exp(SYS.OWNER_CAPITAL), amount: 15000, notes: 'Farm contribution (October workbook)' });
  });
}
