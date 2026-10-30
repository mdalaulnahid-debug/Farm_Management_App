import type { Db } from '../db.js';

/** Gap-free, human-readable document numbers per prefix: INV-000123. Runs inside the caller's transaction. */
export async function nextNumber(db: Db, prefix: string, width = 6) {
  const seq = await db.sequence.upsert({
    where: { key: prefix },
    create: { key: prefix, next: 2 },
    update: { next: { increment: 1 } },
  });
  return `${prefix}-${String(seq.next - 1).padStart(width, '0')}`;
}

export interface Actor { id: string; ip?: string }

export async function audit(db: Db, actor: Actor | null, action: string, entity: string, entityId: string | null, summary: string, data?: unknown) {
  await db.auditLog.create({
    data: {
      userId: actor?.id ?? null, ip: actor?.ip, action, entity, entityId, summary,
      data: data === undefined ? null : JSON.stringify(data),
    },
  });
}
