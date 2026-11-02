// Put a backup back as the farm's database, from the console of the computer that holds it.
//   npm run db:restore -w apps/api                  lists the backups
//   npm run db:restore -w apps/api -- <file name>   restores one (asks you to type RESTORE)
// (or double-click restore-backup.bat on the farm PC). FarmLedger must be stopped first.
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { backupDir, backupPath, checkBackup, isSqlite, listBackups, restoreDatabase, sqliteFile } from '../services/backup.js';

/** Is a FarmLedger server answering on this computer's port? Restoring under a running server would be lost or corrupt. */
async function serverRunning() {
  try {
    // Any answer at all counts as running.
    await fetch(`http://127.0.0.1:${Number(process.env.PORT || 4000)}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = process.argv[2];
  const fail = (msg: string) => { console.error(`\n${msg}\n`); process.exitCode = 1; };
  if (!isSqlite()) fail('Restore is for SQLite installs only. PostgreSQL is restored with pg_restore.');
  else if (!arg) {
    console.log(`\nBackups in ${backupDir()} (newest first):`);
    for (const b of listBackups().slice(0, 15)) console.log(`  ${b.name}   ${(b.size / 1_048_576).toFixed(1)} MB`);
    console.log('\nRestore one with: npm run db:restore -w apps/api -- <file name>\n');
  } else if (await serverRunning()) {
    fail('FarmLedger is still running. Close its window (stop it) first, then run the restore again.');
  } else {
    const file = backupPath(arg) ?? (existsSync(isAbsolute(arg) ? arg : resolve(arg)) ? resolve(arg) : null);
    if (!file) fail(`No backup called ${arg}. Run without a name to see the list.`);
    else {
      const check = await checkBackup(file);
      console.log(`\nBackup: ${file}`);
      if (!check.ok) fail(`This backup cannot be used: ${check.problems.join(' ')}`);
      else {
        console.log(`  Checked OK: not damaged, books balance. ${check.counts.journalEntries} journal entries, ${check.counts.invoices} invoices, ${check.counts.users} users.`);
        console.log(`  It holds work up to about ${check.newestRecordAt ? new Date(check.newestRecordAt).toLocaleString() : 'unknown'}. Anything entered after that will be gone`);
        console.log(`  from FarmLedger (the current database is kept as a copy first).\n  Database to replace: ${sqliteFile()}\n`);
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('Type RESTORE to go ahead, anything else to cancel: ')).trim();
        rl.close();
        if (answer !== 'RESTORE') console.log('\nCancelled. Nothing was changed.\n');
        else {
          try {
            const r = await restoreDatabase({ backupFile: file, dbFile: sqliteFile(), safetyDir: backupDir() });
            console.log('\nRestored. Start FarmLedger again (start-farmledger.bat) and check the latest records.');
            if (r.safetyCopy) console.log(`The database it replaced is kept as ${r.safetyCopy}\n`);
          } catch (e) {
            fail((e as Error).message);
          }
        }
      }
    }
  }
}
