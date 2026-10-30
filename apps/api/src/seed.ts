// Initial data: organization, roles, owner account, farm chart of accounts, items and
// (optionally) the October 2026 workbook history posted through the real services.
import { prisma, tx } from './db.js';
import { DEFAULT_ROLES, SYS } from './lib/constants.js';
import { hashPassword } from './auth/auth.js';
import { toDate } from './lib/dates.js';
import { accountId, clearAccountCache } from './services/ledger.js';
import { importWorkbook, parseWorkbook } from './services/importer.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  await prisma.item.create({ data: { sku: 'EGG-DUCK', name: 'Duck eggs', nameBn: 'হাঁসের ডিম', category: 'PRODUCE', unit: 'pcs', salePrice: 16, trackInventory: true, valued: false, incomeAccountId: await acc(SYS.SALES_EGGS), inventoryAccountId: await acc(SYS.INV_PRODUCE) } });
  await prisma.item.create({ data: { sku: 'FEED-LAYER', name: 'Layer feed', nameBn: 'লেয়ার খাদ্য', category: 'FEED', unit: 'kg', purchasePrice: 55, trackInventory: true, valued: true, reorderLevel: 100, inventoryAccountId: await acc(SYS.INV_FEED), expenseAccountId: await acc(SYS.FEED_EXPENSE) } });
  await prisma.item.create({ data: { sku: 'SNAIL', name: 'Snails (fresh feed)', nameBn: 'শামুক', category: 'FEED', unit: 'kg', trackInventory: false, valued: false, expenseAccountId: await acc('6015') } });
  await prisma.item.create({ data: { sku: 'MED', name: 'Medicine & vaccine', nameBn: 'ওষুধ ও টিকা', category: 'MEDICINE', unit: 'unit', trackInventory: false, valued: false, expenseAccountId: await acc(SYS.MEDICINE_EXPENSE) } });
  await prisma.item.create({ data: { sku: 'DUCK-LIVE', name: 'Live ducks', nameBn: 'জীবন্ত হাঁস', category: 'LIVESTOCK', unit: 'head', salePrice: 450, trackInventory: false, valued: false, incomeAccountId: await acc(SYS.SALES_LIVESTOCK) } });
  const site = await prisma.site.create({ data: { name: 'Main farm', kind: 'FARM' } });
  await prisma.flock.create({ data: { code: 'FLK-01', name: 'Main laying flock', species: 'DUCK', siteId: site.id, startDate: toDate('2026-10-01'), openingCount: 0, currentCount: 0, notes: 'Set the actual number of birds in Production → Flocks so laying rate can be calculated.' } });
  await prisma.party.create({ data: { kind: 'CUSTOMER', name: 'Walk-in customers', notes: 'Counter / cash sales without a named customer.' } });

  if (opts.history) await importOctober(admin.id);
  return { created: true, adminEmail: admin.email };
}

/** Load the October workbook from /upload through the same importer users run from Admin → Import. */
async function importOctober(adminId: string) {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../upload');
  const file = existsSync(dir) ? readdirSync(dir).find(f => f.toLowerCase().endsWith('.xlsx')) : undefined;
  if (!file) return;
  const parsed = parseWorkbook(readFileSync(join(dir, file)));
  await tx(db => importWorkbook(db, { id: adminId }, parsed, { replaceExisting: false, fileName: file }), 180_000);
}
