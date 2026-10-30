// Standard stock catalogue for a duck & egg farm. Runs at startup and in the seed:
// adds any missing item by SKU and never overwrites what the farm has edited.
import { prisma } from '../db.js';
import { SYS } from '../lib/constants.js';
import { accountId } from './ledger.js';

interface ItemDef {
  sku: string; name: string; nameBn: string; category: string; unit: string;
  inventory: string; expense: string; reorder?: number; purchasePrice?: number;
}

const CATALOGUE: ItemDef[] = [
  { sku: 'FEED-STARTER', name: 'Duck starter feed', nameBn: 'হাঁসের স্টার্টার খাদ্য', category: 'FEED', unit: 'kg', inventory: SYS.INV_FEED, expense: SYS.FEED_EXPENSE, reorder: 50 },
  { sku: 'FEED-GROWER', name: 'Duck grower feed', nameBn: 'হাঁসের গ্রোয়ার খাদ্য', category: 'FEED', unit: 'kg', inventory: SYS.INV_FEED, expense: SYS.FEED_EXPENSE, reorder: 50 },
  { sku: 'FEED-BRAN', name: 'Rice bran', nameBn: 'চালের কুঁড়া', category: 'FEED', unit: 'kg', inventory: SYS.INV_FEED, expense: SYS.FEED_EXPENSE, reorder: 50 },
  { sku: 'FEED-RICE', name: 'Broken rice', nameBn: 'খুদ', category: 'FEED', unit: 'kg', inventory: SYS.INV_FEED, expense: SYS.FEED_EXPENSE, reorder: 50 },
  { sku: 'VAC-PLAGUE', name: 'Duck plague vaccine', nameBn: 'ডাক প্লেগ টিকা', category: 'MEDICINE', unit: 'vial', inventory: SYS.INV_MEDICINE, expense: SYS.MEDICINE_EXPENSE, reorder: 2 },
  { sku: 'VAC-CHOLERA', name: 'Duck cholera vaccine', nameBn: 'ডাক কলেরা টিকা', category: 'MEDICINE', unit: 'vial', inventory: SYS.INV_MEDICINE, expense: SYS.MEDICINE_EXPENSE, reorder: 2 },
  { sku: 'VIT-MIN', name: 'Vitamins & minerals', nameBn: 'ভিটামিন ও মিনারেল', category: 'MEDICINE', unit: 'pack', inventory: SYS.INV_MEDICINE, expense: SYS.MEDICINE_EXPENSE, reorder: 2 },
  { sku: 'DISINFECT', name: 'Disinfectant', nameBn: 'জীবাণুনাশক', category: 'SUPPLY', unit: 'litre', inventory: SYS.INV_SUPPLIES, expense: '6090', reorder: 1 },
  { sku: 'TRAY-EGG', name: 'Egg trays', nameBn: 'ডিমের ট্রে', category: 'SUPPLY', unit: 'pcs', inventory: SYS.INV_SUPPLIES, expense: '6050', reorder: 50 },
];

const PROJECTS = [
  { code: 'DUCK', name: 'Duck & egg farm', nameBn: 'হাঁস ও ডিমের খামার', kind: 'POULTRY_EGGS', isMain: true, notes: 'Main business.' },
  { code: 'COW', name: 'Cattle (dairy & fattening)', nameBn: 'গরু (দুধ ও মোটাতাজাকরণ)', kind: 'DAIRY', isMain: false, notes: 'Side project. Full dairy/fattening module planned.' },
  { code: 'CHICKEN', name: 'Chicken', nameBn: 'মুরগি', kind: 'POULTRY_MEAT', isMain: false, notes: 'Side project.' },
];

/** Projects, accounts added after the first release, and tagging of older ledger lines. */
async function ensureStructure() {
  for (const p of PROJECTS) {
    if (!(await prisma.project.findUnique({ where: { code: p.code } }))) await prisma.project.create({ data: p });
  }
  const main = await prisma.project.findFirstOrThrow({ where: { isMain: true } });
  await prisma.journalLine.updateMany({ where: { projectId: null }, data: { projectId: main.id } });
  await prisma.flock.updateMany({ where: { projectId: null }, data: { projectId: main.id } });

  if (!(await prisma.account.findUnique({ where: { code: SYS.SIDE_PROJECTS } }))) {
    await prisma.account.create({ data: { code: SYS.SIDE_PROJECTS, name: 'Funds with side projects', nameBn: 'সাইড প্রকল্পে দেওয়া অর্থ', type: 'ASSET', subtype: 'CURRENT_ASSET', cashFlow: 'INVESTING', system: true, description: 'Money moved from the main farm to side projects (cow, chicken) and not yet returned.' } });
  }
  const grant = await prisma.account.findUnique({ where: { code: SYS.GRANT_INCOME } });
  if (!grant) {
    await prisma.account.create({ data: { code: SYS.GRANT_INCOME, name: 'Grants & donations received', nameBn: 'অনুদান প্রাপ্তি', type: 'INCOME', subtype: 'OTHER_INCOME', system: true, description: 'Cash grants and donations from people or organisations. Not sales.' } });
  } else if (!grant.system) {
    await prisma.account.update({ where: { id: grant.id }, data: { name: grant.name === 'Grants & subsidies' ? 'Grants & donations received' : grant.name, nameBn: grant.nameBn === 'অনুদান ও ভর্তুকি' ? 'অনুদান প্রাপ্তি' : grant.nameBn, system: true, active: true } });
  }
}

export async function ensureReferenceData() {
  if (!(await prisma.organization.findUnique({ where: { id: 'org' } }))) return; // not seeded yet
  await ensureStructure();
  for (const d of CATALOGUE) {
    if (await prisma.item.findUnique({ where: { sku: d.sku } })) continue;
    await prisma.item.create({
      data: {
        sku: d.sku, name: d.name, nameBn: d.nameBn, category: d.category, unit: d.unit, trackInventory: true, valued: true,
        reorderLevel: d.reorder ?? 0, purchasePrice: d.purchasePrice ?? 0,
        inventoryAccountId: await accountId(prisma, d.inventory), expenseAccountId: await accountId(prisma, d.expense),
      },
    });
  }
  // Early installs created general medicine as "expense immediately". Track it in stock if it was never used.
  const med = await prisma.item.findUnique({ where: { sku: 'MED' } });
  if (med && !med.trackInventory && (await prisma.stockMove.count({ where: { itemId: med.id } })) === 0) {
    await prisma.item.update({
      where: { id: med.id },
      data: { name: med.name === 'Medicine & vaccine' ? 'Medicine (general)' : med.name, nameBn: med.nameBn === 'ওষুধ ও টিকা' ? 'ওষুধ (সাধারণ)' : med.nameBn, trackInventory: true, valued: true, reorderLevel: 1, inventoryAccountId: await accountId(prisma, SYS.INV_MEDICINE) },
    });
  }
}
