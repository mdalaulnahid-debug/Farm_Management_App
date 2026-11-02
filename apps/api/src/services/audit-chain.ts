// Tamper-evident audit trail. A sealing job gives each audit row, in order, a sequence number and a
// hash of (previous hash + the row). Editing or deleting a sealed row breaks the chain from there on.
// Someone with the database file could recompute the whole chain, so verification also compares it
// with a backup: rewriting history would mean rewriting every backup copy too (USB, cloud).
// Sealing runs outside business transactions, so it never slows down or fails a user's save.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { Db } from '../db.js';

interface Row { id: string; seq: number | null; hash: string | null; createdAt: Date; userId: string | null; ip: string | null; action: string; entity: string; entityId: string | null; summary: string; data: string | null }

const BATCH = 500;

export function rowHash(prev: string, seq: number, r: Row) {
  const canonical = JSON.stringify([seq, r.id, r.createdAt.toISOString(), r.userId, r.ip, r.action, r.entity, r.entityId, r.summary, r.data]);
  return createHash('sha256').update(`${prev}\n${canonical}`).digest('hex');
}

let sealing: Promise<number> | null = null;

/** Seal every unsealed audit row, oldest first. Returns how many were sealed. One run at a time. */
export function sealAudit(db: Db): Promise<number> {
  sealing ??= (async () => {
    let total = 0;
    try {
      const last = await db.auditLog.findFirst({ where: { seq: { not: null } }, orderBy: { seq: 'desc' }, select: { seq: true, hash: true } });
      let seq = last?.seq ?? 0;
      let prev = last?.hash ?? '';
      for (;;) {
        const rows = await db.auditLog.findMany({ where: { seq: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: BATCH });
        if (!rows.length) break;
        // One short transaction per batch: one disk write instead of one per row, and users wait at most a moment.
        const sealed: { id: string; seq: number; hash: string }[] = [];
        for (const r of rows) {
          seq++;
          prev = rowHash(prev, seq, r);
          sealed.push({ id: r.id, seq, hash: prev });
        }
        const write = async (tx: Prisma.TransactionClient | Db) => {
          for (const s of sealed) await tx.auditLog.update({ where: { id: s.id }, data: { seq: s.seq, hash: s.hash } });
        };
        if ('$transaction' in db) await db.$transaction(tx => write(tx), { timeout: 60_000 });
        else await write(db);
        total += rows.length;
      }
    } finally {
      sealing = null;
    }
    return total;
  })();
  return sealing;
}

export interface ChainReport {
  ok: boolean;
  sealed: number;
  unsealed: number;
  /** First sealed row whose hash no longer matches (edited), or after which a row is missing (deleted). */
  firstBreak: { seq: number; at: string; summary: string; problem: 'edited' | 'missing' } | null;
  /** A short code for the newest sealed row; write it down now and then to compare later. */
  headCode: string | null;
  /** Comparison with a backup taken earlier: every row it holds must still be here, unchanged. */
  backup: { file: string; compared: number; mismatched: number; firstMismatchSeq: number | null; error?: string } | null;
}

/** Recompute the chain from the start and, if given, compare it with a backup's chain. Read-only. */
export async function verifyAuditChain(db: Db, backupFile?: string | null): Promise<ChainReport> {
  const report: ChainReport = { ok: true, sealed: 0, unsealed: await db.auditLog.count({ where: { seq: null } }), firstBreak: null, headCode: null, backup: null };
  let prev = '';
  let expected = 1;
  let after = 0;
  for (;;) {
    const rows = await db.auditLog.findMany({ where: { seq: { gt: after } }, orderBy: { seq: 'asc' }, take: BATCH });
    if (!rows.length) break;
    for (const r of rows) {
      const seq = r.seq!;
      if (!report.firstBreak && seq !== expected) report.firstBreak = { seq: expected, at: r.createdAt.toISOString(), summary: `rows ${expected}–${seq - 1} are gone`, problem: 'missing' };
      if (!report.firstBreak && rowHash(prev, seq, r) !== r.hash) report.firstBreak = { seq, at: r.createdAt.toISOString(), summary: r.summary, problem: 'edited' };
      prev = r.hash ?? '';
      expected = seq + 1;
      after = seq;
      report.sealed++;
    }
  }
  report.headCode = prev ? `${prev.slice(0, 4)}-${prev.slice(4, 8)}`.toUpperCase() : null;

  if (backupFile && existsSync(backupFile)) {
    const other = new PrismaClient({ datasources: { db: { url: `file:${resolve(backupFile).replace(/\\/g, '/')}` } } });
    try {
      const theirs = await other.auditLog.findMany({ where: { seq: { not: null } }, select: { seq: true, hash: true }, orderBy: { seq: 'asc' } });
      const ours = new Map((await db.auditLog.findMany({ where: { seq: { lte: theirs.at(-1)?.seq ?? 0 } }, select: { seq: true, hash: true } })).map(r => [r.seq, r.hash]));
      const bad = theirs.filter(t => ours.get(t.seq) !== t.hash);
      report.backup = { file: backupFile, compared: theirs.length, mismatched: bad.length, firstMismatchSeq: bad[0]?.seq ?? null };
    } catch (e) {
      const message = (e as Error).message;
      // A backup from before sealing existed has no chain columns: nothing to compare. Anything else
      // (damaged, locked, unreadable) is reported, never silently treated as "compared, fine".
      const noChain = /no such column|does not exist|P2022/i.test(message) || (e as { code?: string }).code === 'P2022';
      report.backup = { file: backupFile, compared: 0, mismatched: 0, firstMismatchSeq: null, ...(noChain ? {} : { error: message.split('\n').filter(Boolean).pop() ?? 'unreadable' }) };
    } finally {
      await other.$disconnect();
    }
  }
  report.ok = !report.firstBreak && !(report.backup && report.backup.mismatched > 0);
  return report;
}
