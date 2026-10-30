// Automatic and manual copies of the SQLite database file.
// Infrastructure, not business logic: it reads the whole database with VACUUM INTO and writes files,
// so it uses the shared prisma client directly instead of a caller's transaction.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
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

/** Take a consistent copy of the database now. A second backup in the same minute replaces the first. */
export async function runBackup(kind: 'auto' | 'manual', log: Log = consoleLog): Promise<BackupItem> {
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
  return item(dir, name);
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
    await audit(prisma, null, 'backup', 'settings', b.name, `Automatic daily backup ${b.name}`);
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
