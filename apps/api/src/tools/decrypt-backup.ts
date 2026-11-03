// Turn an encrypted backup (.db.enc, from the USB drive or Google Drive) into a readable copy next to it.
//   npm run backup:decrypt -w apps/api -- <file.db.enc>      (or double-click decrypt-backup.bat)
// Uses BACKUP_ENCRYPTION_KEY from apps/api/.env, or asks for the key from the sealed paper.
// It never touches the live database.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { BackupKeyError, keyProblem } from '../services/backup-crypto.js';
import { decryptBackupToFile } from '../services/offsite.js';

async function askForKey() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('Type the backup key from the sealed paper: ')).trim();
  } finally {
    rl.close();
  }
}

/**
 * Run `use` with the key from .env; when there is none, or the file was made with a different key,
 * ask for the printed key and try once more.
 */
export async function withBackupKey<T>(use: (key: string) => Promise<T>): Promise<T> {
  const fromEnv = process.env.BACKUP_ENCRYPTION_KEY;
  if (fromEnv && !keyProblem(fromEnv)) {
    try {
      return await use(fromEnv);
    } catch (e) {
      if (!(e instanceof BackupKeyError && e.kind === 'different-key')) throw e;
      console.log('\nThis backup was made with a different key than the one in apps/api/.env.');
    }
  }
  return use(await askForKey());
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = process.argv[2];
  const fail = (msg: string) => { console.error(`\n${msg}\n`); process.exitCode = 1; };
  if (!arg) fail('Name the encrypted backup: npm run backup:decrypt -w apps/api -- <file.db.enc>');
  else if (!existsSync(resolve(arg))) fail(`There is no file ${resolve(arg)}.`);
  else {
    try {
      const r = await withBackupKey(key => decryptBackupToFile(resolve(arg), key));
      console.log(`\nDecrypted to ${r.file}`);
      if (r.check.ok) console.log(`Checked OK: not damaged, books balance. ${r.check.counts.journalEntries} journal entries, ${r.check.counts.users} users.`);
      else fail(`The decrypted copy has problems: ${r.check.problems.join(' ')}`);
      console.log('This copy is NOT encrypted. Keep it on this computer and delete it when you are done.\n');
    } catch (e) {
      fail((e as Error).message);
    }
  }
}
