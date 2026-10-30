// Farm operations that touch stock and the books: daily production, stock adjustments,
// transfers between cash/bank accounts, and physical cash counts.
import type { Db } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { money, num, qty as q3, round2 } from '../lib/money.js';
import { SYS } from '../lib/constants.js';
import { accountBalance, accountId, postEntry, reverseEntry } from './ledger.js';
import { issueStock, receiveStock, reverseStockForSource } from './inventory.js';
import { audit, type Actor } from './common.js';

// ───────────── Daily production ─────────────

export interface ProductionInput {
  date: Date;
  flockId: string;
  eggItemId?: string | null;
  eggsCollected: number;
  eggsBroken?: number;
  mortality?: number;
  culled?: number;
  feedItemId?: string | null;
  feedQty?: number;
  waterLitres?: number | null;
  notes?: string | null;
}

export async function recordProduction(db: Db, actor: Actor | null, input: ProductionInput) {
  const flock = await db.flock.findUnique({ where: { id: input.flockId } });
  if (!flock || flock.status !== 'ACTIVE') throw badRequest('Choose an active flock.');
  const collected = Math.trunc(input.eggsCollected || 0);
  const broken = Math.trunc(input.eggsBroken || 0);
  const mortality = Math.trunc(input.mortality || 0);
  const culled = Math.trunc(input.culled || 0);
  if ([collected, broken, mortality, culled].some(n => n < 0)) throw badRequest('Counts cannot be negative.');
  if (broken > collected) throw badRequest('Broken eggs cannot exceed eggs collected.');
  if (mortality + culled > flock.currentCount) throw badRequest(`Mortality and culls exceed the flock's ${flock.currentCount} birds.`);
  const exists = await db.productionLog.findFirst({ where: { flockId: flock.id, date: input.date, status: 'POSTED' } });
  if (exists) throw conflict('Production for this flock and date is already recorded. Void it to re-enter.');

  const log = await db.productionLog.create({
    data: {
      date: input.date, flockId: flock.id, eggsCollected: collected, eggsBroken: broken, mortality, culled,
      feedItemId: input.feedItemId || null, feedQty: q3(input.feedQty ?? 0), waterLitres: input.waterLitres ?? null,
      notes: input.notes ?? null, createdById: actor?.id ?? null,
    },
  });

  const good = collected - broken;
  if (good > 0) {
    const eggItem = input.eggItemId
      ? await db.item.findUnique({ where: { id: input.eggItemId } })
      : await db.item.findFirst({ where: { category: 'PRODUCE', active: true, trackInventory: true }, orderBy: { createdAt: 'asc' } });
    if (!eggItem) throw badRequest('Create an egg item (category Produce) before recording production.');
    await receiveStock(db, { itemId: eggItem.id, date: input.date, type: 'PRODUCTION', quantity: good, unitCost: 0, sourceType: 'PRODUCTION', sourceId: log.id, notes: `${flock.code} production`, createdById: actor?.id });
  }

  let feedCost = 0;
  if (input.feedItemId && num(input.feedQty) > 0) {
    const res = await issueStock(db, { itemId: input.feedItemId, date: input.date, type: 'CONSUMPTION', quantity: num(input.feedQty), sourceType: 'PRODUCTION', sourceId: log.id, notes: `Fed to ${flock.code}`, createdById: actor?.id });
    feedCost = res.value;
    if (feedCost > 0 && res.item) {
      const je = await postEntry(db, actor, {
        date: input.date, memo: `Feed consumed by ${flock.code} (${num(input.feedQty)} ${res.item.unit} ${res.item.name})`, sourceType: 'PRODUCTION', sourceId: log.id,
        lines: [
          { accountId: res.item.expenseAccountId || (await accountId(db, SYS.FEED_EXPENSE)), debit: feedCost },
          { accountId: res.item.inventoryAccountId || (await accountId(db, SYS.INV_FEED)), credit: feedCost },
        ],
      });
      await db.productionLog.update({ where: { id: log.id }, data: { journalEntryId: je.id } });
    }
  }
  if (mortality + culled > 0) await db.flock.update({ where: { id: flock.id }, data: { currentCount: flock.currentCount - mortality - culled } });
  await db.productionLog.update({ where: { id: log.id }, data: { feedCost } });
  await audit(db, actor, 'create', 'production', log.id, `${flock.code}: ${collected} eggs, ${mortality} mortality, feed ${num(input.feedQty)}`);
  return db.productionLog.findUniqueOrThrow({ where: { id: log.id }, include: { flock: true } });
}

export async function voidProduction(db: Db, actor: Actor | null, id: string, reason: string) {
  const log = await db.productionLog.findUnique({ where: { id } });
  if (!log) throw notFound('Production record');
  if (log.status === 'VOID') throw conflict('Already void.');
  await reverseStockForSource(db, 'PRODUCTION', id);
  if (log.journalEntryId) await reverseEntry(db, actor, log.journalEntryId, reason);
  const lost = log.mortality + log.culled;
  if (lost) await db.flock.update({ where: { id: log.flockId }, data: { currentCount: { increment: lost } } });
  await db.productionLog.update({ where: { id }, data: { status: 'VOID', notes: [log.notes, `VOID: ${reason}`].filter(Boolean).join(' · ') } });
  await audit(db, actor, 'void', 'production', id, `Voided production record: ${reason}`);
}

// ───────────── Stock adjustments ─────────────

export interface AdjustmentInput {
  date: Date;
  itemId: string;
  /** USAGE = used on the farm; COUNT = physical count, `quantity` is the counted amount. */
  type: 'ADJUSTMENT' | 'GIFT' | 'WASTE' | 'OPENING' | 'USAGE' | 'COUNT';
  quantity: number; // signed for ADJUSTMENT; positive for the others
  unitCost?: number;
  notes?: string | null;
}

export async function adjustStock(db: Db, actor: Actor | null, input: AdjustmentInput) {
  const item = await db.item.findUnique({ where: { id: input.itemId } });
  if (!item || !item.trackInventory) throw badRequest('Choose a stock-tracked item.');
  let type = input.type;
  let quantity = q3(input.quantity);
  let notes = input.notes ?? null;
  if (type === 'COUNT') {
    if (quantity < 0) throw badRequest('Counted quantity cannot be negative.');
    const onHand = num(item.qtyOnHand);
    const diff = q3(quantity - onHand);
    if (diff === 0) return { sourceId: null, value: 0, difference: 0 };
    notes = [`Stock count: counted ${quantity} ${item.unit}, system had ${onHand}.`, notes].filter(Boolean).join(' ');
    type = 'ADJUSTMENT';
    quantity = diff;
  }
  if (quantity === 0) throw badRequest('Quantity cannot be zero.');
  const incoming = type === 'OPENING' || (type === 'ADJUSTMENT' && quantity > 0);
  if (type !== 'ADJUSTMENT' && quantity < 0) throw badRequest('Enter a positive quantity.');
  const sourceId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inventoryAcc = item.inventoryAccountId || (await accountId(db, SYS.INV_SUPPLIES));
  const lossAcc = await accountId(db, SYS.INVENTORY_LOSS);
  let value = 0;
  if (incoming) {
    const unitCost = money(input.unitCost ?? (type === 'ADJUSTMENT' ? num(item.avgCost) : 0));
    value = (await receiveStock(db, { itemId: item.id, date: input.date, type, quantity: Math.abs(quantity), unitCost, sourceType: 'ADJUSTMENT', sourceId, notes, createdById: actor?.id })).value;
    if (value > 0) {
      const credit = type === 'OPENING' ? await accountId(db, SYS.OPENING_EQUITY) : lossAcc;
      await postEntry(db, actor, { date: input.date, memo: `${type === 'OPENING' ? 'Opening stock' : 'Stock gain'}: ${item.name}`, sourceType: 'ADJUSTMENT', sourceId, lines: [{ accountId: inventoryAcc, debit: value }, { accountId: credit, credit: value }] });
    }
  } else {
    const moveType = type === 'USAGE' ? 'CONSUMPTION' : type;
    value = (await issueStock(db, { itemId: item.id, date: input.date, type: moveType, quantity: Math.abs(quantity), sourceType: 'ADJUSTMENT', sourceId, notes, createdById: actor?.id })).value;
    if (value > 0) {
      // Farm use is an operating cost of that kind (medicine, feed...); gifts, waste and shrinkage are losses.
      const debit = type === 'USAGE'
        ? item.expenseAccountId || (await accountId(db, item.category === 'MEDICINE' ? SYS.MEDICINE_EXPENSE : item.category === 'FEED' ? SYS.FEED_EXPENSE : '6090'))
        : lossAcc;
      const label = { USAGE: 'Used on farm', GIFT: 'Gifted', WASTE: 'Waste/loss' }[type as string] ?? 'Stock shrinkage';
      await postEntry(db, actor, { date: input.date, memo: `${label}: ${item.name}`, sourceType: 'ADJUSTMENT', sourceId, lines: [{ accountId: debit, debit: value }, { accountId: inventoryAcc, credit: value }] });
    }
  }
  await audit(db, actor, 'create', 'stock_adjustment', sourceId, `${input.type} ${quantity} ${item.unit} ${item.name}`);
  return { sourceId, value, difference: quantity };
}

// ───────────── Cash & bank ─────────────

export async function transfer(db: Db, actor: Actor | null, input: { date: Date; fromAccountId: string; toAccountId: string; amount: number; memo?: string }) {
  const amount = money(input.amount);
  if (amount <= 0) throw badRequest('Amount must be greater than zero.');
  if (input.fromAccountId === input.toAccountId) throw badRequest('Choose two different accounts.');
  const accounts = await db.account.findMany({ where: { id: { in: [input.fromAccountId, input.toAccountId] } } });
  if (accounts.length !== 2 || accounts.some(a => !['CASH', 'BANK'].includes(a.subtype))) throw badRequest('Transfers are between cash/bank accounts.');
  const je = await postEntry(db, actor, {
    date: input.date, memo: input.memo || 'Transfer between accounts', sourceType: 'TRANSFER',
    lines: [{ accountId: input.toAccountId, debit: amount }, { accountId: input.fromAccountId, credit: amount }],
  });
  await audit(db, actor, 'create', 'transfer', je.id, `Transfer ${amount}`);
  return je;
}

export async function cashCount(db: Db, actor: Actor | null, input: { date: Date; accountId: string; counted: number; notes?: string | null; postVariance?: boolean }) {
  const account = await db.account.findUnique({ where: { id: input.accountId } });
  if (!account || !['CASH', 'BANK'].includes(account.subtype)) throw badRequest('Choose a cash or bank account.');
  const book = await accountBalance(db, account.id, new Date(input.date.getTime() + 86_399_999));
  const counted = money(input.counted);
  const variance = round2(counted - book);
  const count = await db.cashCount.create({ data: { date: input.date, accountId: account.id, bookBalance: book, counted, variance, notes: input.notes ?? null, createdById: actor?.id ?? null } });
  if (input.postVariance && Math.abs(variance) >= 0.01) {
    const shortage = await accountId(db, SYS.CASH_SHORTAGE);
    await postEntry(db, actor, {
      date: input.date, memo: `Cash count variance (${account.name})`, sourceType: 'ADJUSTMENT', sourceId: count.id,
      lines: variance > 0
        ? [{ accountId: account.id, debit: variance }, { accountId: shortage, credit: variance }]
        : [{ accountId: shortage, debit: -variance }, { accountId: account.id, credit: -variance }],
    });
  }
  await audit(db, actor, 'create', 'cash_count', count.id, `Counted ${counted} vs book ${book} (${variance})`);
  return count;
}
