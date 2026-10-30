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

export async function ensureReferenceData() {
  if (!(await prisma.organization.findUnique({ where: { id: 'org' } }))) return; // not seeded yet
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
