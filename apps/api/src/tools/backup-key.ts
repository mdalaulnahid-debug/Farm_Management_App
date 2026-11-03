// Make the farm's backup encryption key, to print and seal in the office safe.
//   npm run backup:new-key -w apps/api      (or double-click new-backup-key.bat)
// It only prints the key; it never writes it anywhere. Put it in apps/api/.env yourself.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyFingerprint, newPassphrase } from '../services/backup-crypto.js';

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const key = newPassphrase();
  console.log(`
FarmLedger backup encryption key
================================

    ${key}

    Key fingerprint: ${await keyFingerprint(key)}

1. Write or print this key on paper, seal it in an envelope, and keep it in the office safe.
2. Put it in apps/api/.env on the server as:   BACKUP_ENCRYPTION_KEY=${key}
   then restart FarmLedger.
3. Never change it. Backups made with this key open only with this key. If it ever must change,
   keep the old paper with the old backups.

If both the paper and the server's copy are lost, the encrypted backups can never be opened.
Capital letters, spaces and dashes do not matter when the key is typed back in.
`);
}
