// Automatic and manual copies of the SQLite database file.
// Infrastructure, not business logic: it reads the whole database with VACUUM INTO and writes files,
// so it uses the shared prisma client directly instead of a caller's transaction.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';
import { isZero, num, round2 } from '../lib/money.js';
import { audit } from './common.js';

export const BACKUP_NAME = /^farmledger-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.db$/;

export interface BackupItem { name: string; size: number; createdAt: string }
interface Log { info: (msg: string) => void; error: (msg: string) => void }

const consoleLog: Log = { info: m => console.log(m), error: m => console.error(m) };
const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const isSqlite = () => String(process.env.DATABASE_URL ?? '').startsWith('file:');

/** The folder holding schema.prisma: Prisma resolves a relative `file:` URL against it. Works from src/ and dist/. */
function prismaDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'prisma', 'schema.prisma'))) return join(dir, 'prisma');
    dir = dirname(dir);
  }
  return resolve('prisma');
}

/** Absolute path of the SQLite database file named by DATABASE_URL. */
export function sqliteFile() {
  const raw = String(process.env.DATABASE_URL ?? '').replace(/^file:/, '').split('?')[0];
  return isAbsolute(raw) ? raw : resolve(prismaDir(), raw);
}

export const backupDir = () => (process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : join(dirname(sqliteFile()), 'backups'));
export const copyDir = () => (process.env.BACKUP_COPY_DIR ? resolve(process.env.BACKUP_COPY_DIR) : null);
export const keepDays = () => {
  const n = Number.parseInt(process.env.BACKUP_KEEP_DAYS ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 30;
};

const item = (dir: string, name: string): BackupItem => {
  const s = statSync(join(dir, name));
  return { name, size: s.size, createdAt: s.mtime.toISOString() };
};

/** Backups in the backup folder, newest first. Files that don't match the backup name are ignored. */
export function listBackups(): BackupItem[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => BACKUP_NAME.test(n)).sort().reverse().map(n => item(dir, n));
}

/** Path of a named backup, or null if the name is not a backup name or the file is missing. */
export function backupPath(name: string) {
  if (!BACKUP_NAME.test(name)) return null;
  const file = join(backupDir(), name);
  return existsSync(file) ? file : null;
}

export interface BackupCheck {
  ok: boolean;
  problems: string[];
  /** Total debits minus total credits over every journal line; zero when the books balance. */
  difference: number;
  balanced: boolean;
  counts: { users: number; journalEntries: number; invoices: number; bills: number; payments: number; auditRows: number };
  /** Time of the newest audit-trail row: the backup holds work up to about then. */
  newestRecordAt: string | null;
  size: number;
}

/** A separate, short-lived connection to another SQLite file; never the live database's client. */
const openFile = (file: string) => new PrismaClient({ datasources: { db: { url: `file:${resolve(file).replace(/\\/g, '/')}` } } });

/**
 * The restore drill: open a backup file on its own and check it would work as the farm's database.
 * Not damaged (SQLite integrity check), really FarmLedger (organization and users), and the books
 * balance. Only reads; a missing file is reported, never created.
 */
export async function checkBackup(file: string): Promise<BackupCheck> {
  const result: BackupCheck = {
    ok: false, problems: [], difference: 0, balanced: false, newestRecordAt: null, size: 0,
    counts: { users: 0, journalEntries: 0, invoices: 0, bills: 0, payments: 0, auditRows: 0 },
  };
  if (!existsSync(file)) {
    result.problems.push('The backup file does not exist.');
    return result;
  }
  result.size = statSync(file).size;
  const db = openFile(file);
  try {
    const integrity = await db.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
    const verdict = integrity.map(r => r.integrity_check).join('; ');
    if (verdict !== 'ok') result.problems.push(`The file is damaged (${verdict.slice(0, 200)}).`);
    const [org, users, journalEntries, invoices, bills, payments, auditRows, sums, newest] = await Promise.all([
      db.organization.findUnique({ where: { id: 'org' }, select: { id: true } }),
      db.user.count(), db.journalEntry.count(), db.salesInvoice.count(), db.bill.count(), db.payment.count(), db.auditLog.count(),
      db.journalLine.aggregate({ _sum: { debit: true, credit: true } }),
      db.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    result.counts = { users, journalEntries, invoices, bills, payments, auditRows };
    if (!org) result.problems.push('It has no farm organization; it is not a FarmLedger database.');
    if (!users) result.problems.push('It has no users, so nobody could sign in.');
    result.difference = round2(num(sums._sum.debit) - num(sums._sum.credit));
    result.balanced = isZero(result.difference);
    if (!result.balanced) result.problems.push(`The books do not balance: debits and credits differ by ${result.difference}.`);
    result.newestRecordAt = newest?.createdAt.toISOString() ?? null;
  } catch (e) {
    result.problems.push(`It could not be read as a FarmLedger database: ${(e as Error).message.split('\n').filter(Boolean).pop()}`);
  } finally {
    await db.$disconnect();
  }
  result.ok = result.problems.length === 0;
  return result;
}

/**
 * Replace the database file with a backup. FarmLedger must be stopped first. The backup is checked
 * before anything changes; the database being replaced is first saved as
 * farmledger-before-restore-<date>.db in `safetyDir`, which automatic pruning never deletes.
 */
export async function restoreDatabase(opts: { backupFile: string; dbFile: string; safetyDir: string }) {
  const check = await checkBackup(opts.backupFile);
  if (!check.ok) throw new Error(`Backup not restored: ${check.problems.join(' ')}`);
  let safetyCopy: string | null = null;
  if (existsSync(opts.dbFile)) {
    mkdirSync(opts.safetyDir, { recursive: true });
    const now = new Date();
    safetyCopy = join(opts.safetyDir, `farmledger-before-restore-${localDay(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`);
    await safeCopy(opts.dbFile, safetyCopy);
  }
  // A leftover journal or write-ahead log means another program still has the database open.
  const inUse = ['-journal', '-wal'].map(x => `${opts.dbFile}${x}`).filter(existsSync);
  if (inUse.length) throw new Error(`Backup not restored: the database is still in use (${inUse.map(f => basename(f)).join(', ')} exists). Close FarmLedger and any database tool, then try again.`);
  // Copy next to the target first, so the swap itself is a single rename; nothing is removed unless it succeeds.
  const temp = `${opts.dbFile}.restoring`;
  copyFileSync(opts.backupFile, temp);
  try {
    renameSync(temp, opts.dbFile);
  } catch (e) {
    rmSync(temp, { force: true });
    throw new Error(`Backup not restored: the database file could not be replaced (${(e as Error).message}). It is probably still open; close FarmLedger and try again. Nothing was changed.`);
  }
  rmSync(`${opts.dbFile}-shm`, { force: true });
  const after = await checkBackup(opts.dbFile);
  if (!after.ok) throw new Error(`The restored database failed its check: ${after.problems.join(' ')} The previous database is saved as ${safetyCopy}.`);
  const db = openFile(opts.dbFile);
  try {
    await db.auditLog.create({ select: { id: true }, data: {
      action: 'restore', entity: 'settings', entityId: basename(opts.backupFile),
      summary: `Database restored from ${basename(opts.backupFile)}${safetyCopy ? `; the database it replaced was saved as ${basename(safetyCopy)}` : ''}`,
    } });
  } finally {
    await db.$disconnect();
  }
  return { check: after, safetyCopy };
}

/**
 * Copy a database for safekeeping. Through SQLite when it can be opened (that also completes any write
 * a crash left half-done, so the copy is complete); a raw copy of the file and its journal otherwise.
 */
async function safeCopy(file: string, to: string) {
  const db = openFile(file);
  try {
    await db.$executeRawUnsafe(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
  } catch {
    copyFileSync(file, to);
    for (const x of ['-journal', '-wal']) if (existsSync(`${file}${x}`)) copyFileSync(`${file}${x}`, `${to}${x}`);
  } finally {
    await db.$disconnect();
  }
  if (!existsSync(to) || statSync(to).size === 0) throw new Error(`Backup not restored: the safety copy ${to} could not be made.`);
}

/** Take a consistent copy of the database now, then check it. A second backup in the same minute replaces the first. */
export async function runBackup(kind: 'auto' | 'manual', log: Log = consoleLog): Promise<BackupItem & { check: BackupCheck }> {
  if (!isSqlite()) throw new Error('Backups are only taken for SQLite installs.');
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const name = `farmledger-${localDay(now)}-${pad(now.getHours())}${pad(now.getMinutes())}.db`;
  const temp = join(dir, `.tmp-${randomBytes(6).toString('hex')}.db`);
  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
    renameSync(temp, join(dir, name));
  } finally {
    rmSync(temp, { force: true });
  }
  log.info(`Database backup (${kind}) saved: ${join(dir, name)}`);
  const check = await checkBackup(join(dir, name));
  if (!check.ok) log.error(`Backup ${name} FAILED its check: ${check.problems.join(' ')}`);
  const extra = copyDir();
  if (extra) {
    try {
      mkdirSync(extra, { recursive: true });
      copyFileSync(join(dir, name), join(extra, name));
      log.info(`Backup copied to ${extra}`);
    } catch (e) {
      log.error(`Could not copy the backup to BACKUP_COPY_DIR (${extra}): ${(e as Error).message}`);
    }
  }
  return { ...item(dir, name), check };
}

/**
 * Delete backups older than BACKUP_KEEP_DAYS (by the date in the file name), always keeping the newest 7.
 * Files that don't match the backup name are never touched. Returns the names deleted.
 */
export function pruneBackups(log: Log = consoleLog): string[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - keepDays());
  const names = readdirSync(dir).filter(n => BACKUP_NAME.test(n)).sort().reverse();
  const deleted: string[] = [];
  for (const name of names.slice(7)) {
    const [, y, m, d] = BACKUP_NAME.exec(name)!;
    if (new Date(Number(y), Number(m) - 1, Number(d)) >= cutoff) continue;
    try {
      rmSync(join(dir, name));
      deleted.push(name);
    } catch (e) {
      log.error(`Could not delete old backup ${name}: ${(e as Error).message}`);
    }
  }
  if (deleted.length) log.info(`Removed ${deleted.length} old backup(s).`);
  return deleted;
}

let running = false;

/** Takes today's automatic backup if there is none yet. Never throws. */
export async function autoBackupIfDue(log: Log = consoleLog) {
  if (running || !isSqlite()) return null;
  running = true;
  try {
    const prefix = `farmledger-${localDay(new Date())}-`;
    if (listBackups().some(b => b.name.startsWith(prefix))) return null;
    const b = await runBackup('auto', log);
    if (!b.check.ok) {
      // A backup that would not restore is no backup: remove it so the next hourly run tries again.
      rmSync(join(backupDir(), b.name), { force: true });
      await audit(prisma, null, 'backup', 'settings', b.name, `Automatic daily backup ${b.name} FAILED its check and was discarded (will retry): ${b.check.problems.join(' ')}`);
      return null;
    }
    await audit(prisma, null, 'backup', 'settings', b.name, `Automatic daily backup ${b.name} (checked OK)`);
    pruneBackups(log);
    return b;
  } catch (e) {
    log.error(`Automatic backup failed: ${(e as Error).message}`);
    return null;
  } finally {
    running = false;
  }
}

/** Check at start and then every hour; take a backup when today's is missing. SQLite only. */
export function startBackupScheduler(log: Log = consoleLog) {
  if (!isSqlite()) return null;
  void autoBackupIfDue(log);
  const timer = setInterval(() => void autoBackupIfDue(log), 60 * 60 * 1000);
  timer.unref();
  return timer;
}
