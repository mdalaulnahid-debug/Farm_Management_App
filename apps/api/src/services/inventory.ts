// Perpetual inventory with weighted-average costing.
// - "valued" items (feed, medicine, purchased goods) carry cost; issuing them posts cost.
// - produced items (eggs) are tracked in quantity only: their cost is already expensed
//   as feed/medicine/labour when consumed, which keeps farm accounting simple and honest.
import type { Db } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { qty as q3, round2, num } from '../lib/money.js';

interface MoveInput {
  itemId: string;
  date: Date;
  type: string;
  quantity: number; // positive number; direction comes from `direction`
  unitCost?: number; // for receipts
  sourceType?: string;
  sourceId?: string;
  notes?: string | null;
  createdById?: string | null;
  allowNegative?: boolean;
}

export async function receiveStock(db: Db, m: MoveInput) {
  const item = await db.item.findUnique({ where: { id: m.itemId } });
  if (!item) throw notFound('Item');
  if (!item.trackInventory) return { value: 0, unitCost: 0 };
  const quantity = q3(m.quantity);
  if (quantity <= 0) throw badRequest('Quantity must be greater than zero.');
  const unitCost = item.valued ? num(m.unitCost) : 0;
  const value = round2(quantity * unitCost);
  const onHand = num(item.qtyOnHand);
  const newQty = q3(onHand + quantity);
  const newAvg = item.valued && newQty > 0 ? (Math.max(onHand, 0) * num(item.avgCost) + value) / Math.max(newQty, quantity) : num(item.avgCost);
  await db.item.update({ where: { id: item.id }, data: { qtyOnHand: newQty, avgCost: Math.round(newAvg * 10000) / 10000 } });
  await db.stockMove.create({
    data: {
      date: m.date, itemId: item.id, type: m.type, quantity, unitCost, value,
      sourceType: m.sourceType, sourceId: m.sourceId, notes: m.notes ?? null, createdById: m.createdById ?? null,
    },
  });
  return { value, unitCost };
}

export async function issueStock(db: Db, m: MoveInput) {
  const item = await db.item.findUnique({ where: { id: m.itemId } });
  if (!item) throw notFound('Item');
  if (!item.trackInventory) return { value: 0, unitCost: 0, item };
  const quantity = q3(m.quantity);
  if (quantity <= 0) throw badRequest('Quantity must be greater than zero.');
  const onHand = num(item.qtyOnHand);
  if (!m.allowNegative && quantity - onHand > 0.0005) {
    throw badRequest(`Not enough ${item.name} in stock: ${onHand} ${item.unit} available, ${quantity} requested. Record production, a purchase or an opening stock first.`);
  }
  const unitCost = item.valued ? num(item.avgCost) : 0;
  const value = round2(quantity * unitCost);
  await db.item.update({ where: { id: item.id }, data: { qtyOnHand: q3(onHand - quantity) } });
  await db.stockMove.create({
    data: {
      date: m.date, itemId: item.id, type: m.type, quantity: -quantity, unitCost, value: -value,
      sourceType: m.sourceType, sourceId: m.sourceId, notes: m.notes ?? null, createdById: m.createdById ?? null,
    },
  });
  return { value, unitCost, item };
}

/** Undo every stock move created by a source document. */
export async function reverseStockForSource(db: Db, sourceType: string, sourceId: string) {
  const moves = await db.stockMove.findMany({ where: { sourceType, sourceId, voided: false } });
  for (const mv of moves) {
    const item = await db.item.findUnique({ where: { id: mv.itemId } });
    if (!item) continue;
    const onHand = num(item.qtyOnHand);
    const newQty = q3(onHand - num(mv.quantity));
    let avg = num(item.avgCost);
    if (num(mv.quantity) > 0 && item.valued) {
      // Removing a receipt: take its value out of the average.
      const remainingValue = onHand * avg - num(mv.value);
      avg = newQty > 0 ? Math.max(remainingValue, 0) / newQty : 0;
    }
    await db.item.update({ where: { id: item.id }, data: { qtyOnHand: newQty, avgCost: Math.round(avg * 10000) / 10000 } });
    await db.stockMove.update({ where: { id: mv.id }, data: { voided: true } });
  }
}
