// The general ledger. Every financial event in the system ends up here as a balanced
// journal entry; reports are computed exclusively from journal lines.
import type { Db } from '../db.js';
import { badRequest, conflict } from '../lib/errors.js';
import { money, round2, isZero } from '../lib/money.js';
import { ymd } from '../lib/dates.js';
import { nextNumber, type Actor } from './common.js';

export interface LineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  partyId?: string | null;
  memo?: string | null;
}

export interface EntryInput {
  date: Date;
  memo: string;
  sourceType: string;
  sourceId?: string | null;
  lines: LineInput[];
}

const accountCache = new Map<string, string>();

/** Resolve a system account id by its code (e.g. SYS.CASH). */
export async function accountId(db: Db, code: string) {
  const cached = accountCache.get(code);
  if (cached) return cached;
  const acc = await db.account.findUnique({ where: { code }, select: { id: true } });
  if (!acc) throw new Error(`System account ${code} is missing. Run the seed.`);
  accountCache.set(code, acc.id);
  return acc.id;
}
export const clearAccountCache = () => accountCache.clear();

export async function assertOpenPeriod(db: Db, date: Date) {
  const org = await db.organization.findUnique({ where: { id: 'org' }, select: { lockDate: true } });
  if (org?.lockDate && date.getTime() <= org.lockDate.getTime()) {
    throw conflict(`The books are closed up to ${ymd(org.lockDate)}. Choose a later date or ask the owner to reopen the period.`);
  }
}

/** Merge, round and validate lines, then post the entry. Throws if unbalanced. */
export async function postEntry(db: Db, actor: Actor | null, input: EntryInput) {
  await assertOpenPeriod(db, input.date);
  const lines = input.lines
    .map(l => ({ ...l, debit: money(l.debit), credit: money(l.credit) }))
    .map(l => {
      // Normalize a line that carries both sides into a single net side.
      const net = round2(l.debit - l.credit);
      return { ...l, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter(l => !isZero(l.debit) || !isZero(l.credit));
  if (lines.length < 2) throw badRequest('A journal entry needs at least two non-zero lines.');
  const dr = round2(lines.reduce((a, l) => a + l.debit, 0));
  const cr = round2(lines.reduce((a, l) => a + l.credit, 0));
  if (!isZero(dr - cr)) throw badRequest(`Journal entry is not balanced (debits ${dr} ≠ credits ${cr}).`);

  const number = await nextNumber(db, 'JE');
  return db.journalEntry.create({
    data: {
      number, date: input.date, memo: input.memo, sourceType: input.sourceType, sourceId: input.sourceId ?? null,
      createdById: actor?.id ?? null,
      lines: { create: lines.map(l => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, partyId: l.partyId ?? null, memo: l.memo ?? null })) },
    },
  });
}

/** Void an entry by posting its mirror image, dated on the original date (or `onDate`). */
export async function reverseEntry(db: Db, actor: Actor | null, entryId: string, reason: string, onDate?: Date) {
  const entry = await db.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } });
  if (!entry) return null;
  if (entry.status === 'VOID') throw conflict(`Journal ${entry.number} is already void.`);
  const reversal = await postEntry(db, actor, {
    date: onDate ?? entry.date,
    memo: `Reversal of ${entry.number}: ${reason}`,
    sourceType: 'REVERSAL',
    sourceId: entry.id,
    lines: entry.lines.map(l => ({ accountId: l.accountId, debit: Number(l.credit), credit: Number(l.debit), partyId: l.partyId, memo: l.memo })),
  });
  await db.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOID' } });
  await db.journalEntry.update({ where: { id: reversal.id }, data: { reversalOf: entry.id, status: 'VOID' } });
  return reversal;
}

/** Sum of (debit − credit) for an account up to and including `asOf`. */
export async function accountBalance(db: Db, accountIdValue: string, asOf?: Date) {
  const agg = await db.journalLine.aggregate({
    where: { accountId: accountIdValue, ...(asOf ? { entry: { date: { lte: asOf } } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return round2(Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0));
}
