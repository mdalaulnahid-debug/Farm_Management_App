// Guarded "start over": wipe the database and load the starting data again. For developers' own
// databases. On a database that holds records it needs the exact phrase "DELETE <file name>" and
// always keeps a copy of what it wipes first.
//   npm run db:reset -w apps/api
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { backupDir, isSqlite, sqliteFile } from '../services/backup.js';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const pad = (n: number) => String(n).padStart(2, '0');

export interface ResetAssessment {
  exists: boolean;
  /** True when the file has records, or cannot be read (then we cannot tell, so assume it does). */
  hasData: boolean;
  counts: { users: number; journalEntries: number; invoices: number } | null;
  /** What must be typed to wipe it. */
  phrase: string;
}

/** Look at what a reset would destroy. Only reads; a missing file is not created. */
export async function assessReset(file: string): Promise<ResetAssessment> {
  const phrase = `DELETE ${basename(file)}`;
  if (!existsSync(file)) return { exists: false, hasData: false, counts: null, phrase };
  const db = new PrismaClient({ datasources: { db: { url: `file:${resolve(file).replace(/\\/g, '/')}` } } });
  try {
    const [users, journalEntries, invoices] = await Promise.all([db.user.count(), db.journalEntry.count(), db.salesInvoice.count()]);
    return { exists: true, hasData: users + journalEntries + invoices > 0, counts: { users, journalEntries, invoices }, phrase };
  } catch {
    return { exists: true, hasData: true, counts: null, phrase };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Wipe `file` and recreate the tables (then load the starting data unless `seed` is false).
 * Refuses when the database holds records and `confirm` is not exactly the phrase. The old file is
 * first copied to `safetyDir` as farmledger-before-reset-<date>.db, which pruning never deletes.
 */
export async function resetDatabase(opts: { file: string; confirm?: string; safetyDir: string; seed?: boolean }) {
  const a = await assessReset(opts.file);
  if (a.hasData && opts.confirm !== a.phrase) throw new Error(`Not reset: this database holds records. To wipe it, type exactly: ${a.phrase}`);
  let safetyCopy: string | null = null;
  if (a.exists) {
    mkdirSync(opts.safetyDir, { recursive: true });
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    safetyCopy = join(opts.safetyDir, `farmledger-before-reset-${stamp}.db`);
    copyFileSync(opts.file, safetyCopy);
  }
  // The copy is safe, so remove the old file and let a plain `db push` create empty tables.
  for (const f of [opts.file, `${opts.file}-journal`, `${opts.file}-wal`, `${opts.file}-shm`]) rmSync(f, { force: true });
  const env = { ...process.env, DATABASE_URL: `file:${resolve(opts.file).replace(/\\/g, '/')}`, PRISMA_HIDE_UPDATE_MESSAGE: '1' };
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], { cwd: apiDir, env, stdio: 'pipe' });
  if (opts.seed !== false) execFileSync(process.execPath, [require.resolve('tsx/cli'), 'prisma/seed.ts'], { cwd: apiDir, env, stdio: 'inherit' });
  return { safetyCopy };
}

/** Is a FarmLedger server answering on this computer's port? Never wipe the database under it. */
async function serverRunning() {
  try {
    return (await fetch(`http://127.0.0.1:${Number(process.env.PORT || 4000)}/api/v1/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fail = (msg: string) => { console.error(`\n${msg}\n`); process.exitCode = 1; };
  if (!isSqlite()) fail('db:reset only works on SQLite. A PostgreSQL database is never reset from here.');
  else if (await serverRunning()) fail('FarmLedger is running on this computer. Nothing was changed. Stop it first if you really mean to reset.');
  else {
    const file = sqliteFile();
    const a = await assessReset(file);
    let confirm: string | undefined;
    if (a.hasData) {
      console.log(`\nThis will DELETE EVERYTHING in ${file}`);
      console.log(a.counts ? `  ${a.counts.users} users, ${a.counts.journalEntries} journal entries, ${a.counts.invoices} invoices.` : '  (it could not be read, so it may hold records)');
      console.log('  A copy is kept first in the backup folder, but FarmLedger will start empty.\n');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      confirm = (await rl.question(`To go ahead type exactly  ${a.phrase}  (anything else cancels): `)).trim();
      rl.close();
    }
    if (a.hasData && confirm !== a.phrase) console.log('\nCancelled. Nothing was changed.\n');
    else {
      try {
        const r = await resetDatabase({ file, confirm, safetyDir: backupDir() });
        console.log(`\nDatabase reset.${r.safetyCopy ? ` The old one is kept as ${r.safetyCopy}` : ''}\n`);
      } catch (e) {
        fail((e as Error).message);
      }
    }
  }
}
