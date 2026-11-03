# Encrypted Off-Site Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every backup copy that leaves the VM, to USB or to Google Drive, is encrypted. Encrypted backups can be
decrypted and restored.

**Architecture:**
- **`services/backup-crypto.ts`.** Encrypts and decrypts files with Node's built-in crypto: AES-256-GCM, with
  the key derived by scrypt. Files are streamed.
- **`services/backup.ts`.** Gains an off-site step after each backup:
  - encrypt the backup once to a temporary file;
  - copy it to `BACKUP_COPY_DIR` as `<name>.enc`;
  - upload it with rclone to `BACKUP_RCLONE_REMOTE`;
  - prune old files in both places;
  - record the result in a small status file.
- **Console tools:** make a key, decrypt a file, and restore an `.enc` file.
- **The app and the security check** read the status file.

**Tech Stack:** Node 20 `node:crypto` and `node:stream`, Fastify 5, Prisma 6 on SQLite, React 19, Vitest. rclone is
an external program and is not an npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-03-app-backups-passkeys-design.md` (Part 2)

## Global Constraints

- **A readable copy never leaves the VM.** If a copy folder or a Drive remote is set and there is no key, or a
  key of fewer than 20 characters, **no off-VM copy is written or uploaded**. The local backup is still taken.
  This is reported as a problem.
- **No change** to the live database or to backups in the local backup folder.
- **No new npm dependency.** Schema changes: none.
- **rclone** is called with an argument list, never through a shell, under the service user.
- **Drive** keeps the same days as `BACKUP_KEEP_DAYS` (default 30).
- **Every user-facing string** in English and Bangla. **No farm-specific addresses** in committed files (the
  repository is public).
- **Testing:** browser checks only on port 4400 with a throwaway database. Never touch port 4000 or the live
  database.

## Settings (new, in `.env`)

- `BACKUP_ENCRYPTION_KEY`: the passphrase.
- `BACKUP_RCLONE_REMOTE`: for example `farmdrive:FarmLedger`. Unset means no Drive upload.
- `BACKUP_RCLONE_BIN`: optional, default `rclone`.

## Review Focus

1. **USB unplugged in the middle of a copy.** No half-written `.enc` file is left looking like a backup: write
   to `.<name>.enc.part`, then rename. (Task 2 test.)
2. **Disk full, or encryption fails.** The temporary file is removed, the local backup stays, and `runBackup`
   still returns. (Task 2 test.)
3. **rclone not installed or not configured.** The status says "Google Drive upload failed: rclone not found",
   with no crash and no retry storm. (Task 2 test.)
4. **The passphrase typed from paper with different case, spaces or dashes.** It still works, because the key
   material is the passphrase lower-cased with everything except letters and digits removed. (Task 1 test.)
5. **Restoring a file made with a different key than the one in `.env`.** The message says "made with a
   different key", and the tool asks for the printed key instead of failing. (Task 3 test.)

---

### Task 1: Encrypt and decrypt backup files

**Files:**
- Create: `apps/api/src/services/backup-crypto.ts`
- Test: `apps/api/test/backup-crypto.test.ts`

**Interfaces:**
- Produces:
  - `normaliseKey(passphrase: string): string`: lower-case, letters and digits only.
  - `keyProblem(passphrase?: string | null): string | null`: returns null when usable; otherwise a plain-English
    reason ("No encryption key is set." or "The encryption key is too short (at least 20 letters and digits).").
  - `newPassphrase(): string`: 8 groups of 4 characters, joined with `-`. The alphabet is
    `abcdefghjkmnpqrstuvwxyz23456789`, with no look-alikes.
  - `keyFingerprint(passphrase: string): string`: 16 hex characters.
  - `encryptFile(src: string, dest: string, passphrase: string): Promise<void>`
  - `decryptFile(src: string, dest: string, passphrase: string): Promise<void>`: on failure it throws
    `BackupKeyError` and leaves no `dest` behind.
  - `class BackupKeyError extends Error { kind: 'not-encrypted' | 'different-key' | 'wrong-key' | 'damaged' }`
  - `isEncryptedFile(file: string): boolean`: checks the magic bytes.
  - `ENC_SUFFIX = '.enc'`

**File format** (documented again in Task 4):

| Bytes | Content |
|---|---|
| 0–7 | `FLBKENC1`, the magic tag |
| 8–23 | scrypt salt (16 bytes) |
| 24–31 | key fingerprint (8 bytes) |
| 32–43 | AES-GCM IV (12 bytes) |
| 44 to end − 16 | ciphertext |
| last 16 | GCM tag |

- **Key:** `scrypt(normaliseKey(p), salt, 32, { N: 2**15, r: 8, p: 1, maxmem: 64 MiB })`.
- **Fingerprint:** `scrypt(normaliseKey(p), 'FarmLedger backup key fingerprint v1', 8, same params)`, as hex.
- Decrypt checks the fingerprint before it decrypts anything.

- [ ] **Step 1: Write the failing tests**, in `describe('backup encryption')`:
  - `it('round-trips a file')`: write 5 MB of random bytes, encrypt, decrypt, and the bytes are equal. The `.enc`
    file is 60 bytes larger (44 + 16) and starts with `FLBKENC1`.
  - `it('accepts the key typed with other case, spaces or dashes')`: encrypt with `newPassphrase()` and decrypt
    with `p.toUpperCase().replace(/-/g, ' ')`.
  - `it('says "different key" for a file made with another key')`: `kind === 'different-key'`, and `dest` does
    not exist.
  - `it('says "damaged" when one byte of the ciphertext changed')`: flip byte 100, `kind === 'damaged'`, and
    `dest` does not exist.
  - `it('says "not encrypted" for a plain backup')`: `kind === 'not-encrypted'`.
  - `it('makes long readable passphrases')`: matches
    `/^([abcdefghjkmnpqrstuvwxyz23456789]{4}-){7}[abcdefghjkmnpqrstuvwxyz23456789]{4}$/`, and two calls differ.
  - `it('refuses missing and short keys')`:
    - `keyProblem(undefined)` and `keyProblem('short-key-123')` are not null;
    - `keyProblem(newPassphrase())` is null;
    - `keyProblem('ab-cd-'.repeat(10))` is null (20 letters and digits after normalising).
- [ ] **Step 2: Run them and confirm they fail.** `cd apps/api && npx vitest run test/backup-crypto.test.ts`
  fails because the module doesn't exist.
- [ ] **Step 3: Implement `backup-crypto.ts`.**
  - Encrypt: `stream/promises.pipeline` from `createReadStream` through `createCipheriv('aes-256-gcm')` into a
    write stream opened after writing the header. Append `cipher.getAuthTag()` at the end.
  - Decrypt: read the header and the last 16 bytes, then stream bytes 44 to size − 16 through the decipher into
    `dest + '.part'`.
  - `final()` failing → `damaged`. Rename `.part` to `dest` only on success; remove `.part` on any error.
- [ ] **Step 4: Run them and confirm they pass.** Same command: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Backups: encrypt and decrypt files (AES-256-GCM, scrypt key)"`

### Task 2: Off-site step in every backup: USB copy and Google Drive upload

**Files:**
- Modify: `apps/api/src/services/backup.ts`. Add the off-site step to `runBackup` (after `checkBackup`,
  replacing the plain `copyFileSync` to `copyDir()`), and add pruning of `.enc` files.
- Create: `apps/api/src/services/offsite.ts`
- Test: `apps/api/test/offsite-backup.test.ts`

**Interfaces:**
- Consumes: Task 1's `encryptFile`, `keyProblem`, `ENC_SUFFIX`.
- Produces:
  - `interface OffsiteStatus { at: string; name: string; usb: Outcome; drive: Outcome }`, where
    `type Outcome = { state: 'ok' | 'off' | 'skipped-no-key' | 'failed'; detail?: string }`.
  - `sendOffsite(backupFile: string, log: Log): Promise<OffsiteStatus>`: never throws. It writes
    `<backupDir>/.offsite-status.json`.
  - `readOffsiteStatus(): OffsiteStatus | null`
  - `rcloneRemote(): string | null`
  - `setRcloneRunner(fn: ((args: string[]) => Promise<{ ok: boolean; output: string }>) | null): void`, for tests.
    The default runner is `execFile(BACKUP_RCLONE_BIN || 'rclone', args, { timeout: 10 min })`. ENOENT becomes
    "rclone not found".
  - `ENC_NAME = /^farmledger-\d{4}-\d{2}-\d{2}-\d{4}\.db\.enc$/`
  - `runBackup` now returns `BackupItem & { check: BackupCheck; offsite: OffsiteStatus }`.

**Behaviour:**

- If neither `copyDir()` nor `rcloneRemote()` is set, both outcomes are `off` and nothing is encrypted.
- If either is set and `keyProblem(BACKUP_ENCRYPTION_KEY)` is not null, the configured ones are
  `skipped-no-key`, with the reason as `detail`. Nothing is written or uploaded. The problem is logged with
  `log.error`.
- Otherwise:
  1. Encrypt once to `<backupDir>/.tmp-<rand>.db.enc`.
  2. **USB:** write to `<copyDir>/.<name>.enc.part`, then rename to `<copyDir>/<name>.enc`.
  3. **Drive:** run rclone with `['copyto', temp, `${remote}/${name}.enc`]`, then
     `['delete', remote, '--min-age', `${keepDays()}d`, '--include', 'farmledger-*.db.enc']`.
  4. Always remove the temp file.
- Prune `.enc` files in `copyDir()` with the same rule as `pruneBackups`: by the date in the name, older than
  `keepDays()`, always keeping the newest 7. Plain `.db` files are never touched.

- [ ] **Step 1: Write the failing tests**, in `describe('off-site backups')`. Each uses temp `BACKUP_DIR` and
  `BACKUP_COPY_DIR` folders and a recording fake runner via `setRcloneRunner`.
  - `it('writes only an encrypted copy to the USB folder')`: with a generated key, the copy folder holds exactly
    `<name>.enc` and no `.db`. `decryptFile` of it then passes `checkBackup`. `offsite.usb.state === 'ok'`.
  - `it('writes nothing off the VM without a usable key, but still backs up locally')`: with no key, then with
    `'tooshort123'`, the copy folder stays empty, the fake runner is never called,
    `usb.state === 'skipped-no-key'`, and the local backup exists with `check.ok`.
  - `it('uploads to Drive and prunes old copies there')`: the runner received `copyto` with `<remote>/<name>.enc`,
    then `delete` with `--min-age 30d`. `drive.state === 'ok'`.
  - `it('a Drive failure is recorded and does not stop the backup')`: the runner returns
    `{ ok: false, output: 'rclone not found' }`. Expect `drive.state === 'failed'` and a `detail` containing
    `'rclone not found'`. The USB copy is still written, and `readOffsiteStatus()` returns the same.
  - `it('an unplugged USB drive leaves no partial file and does not stop the Drive upload')`: set `BACKUP_COPY_DIR`
    to a path under a regular **file**, so `mkdir` fails. Expect `usb.state === 'failed'`, no `.part` file
    anywhere, and `drive.state === 'ok'`.
  - `it('leaves no temporary file in the backup folder')`: after each run, no `.tmp-*` remains.
  - `it('prunes old encrypted copies on the USB folder and never plain files')`: seed 10 `.enc` files dated
    40 days ago and one plain `.db` dated 40 days ago. After the run, the 7 newest `.enc` files plus today's
    remain, and so does the `.db`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run test/offsite-backup.test.ts`
- [ ] **Step 3: Implement `offsite.ts` and wire it into `runBackup`.** `restore.test.ts` must keep passing.
- [ ] **Step 4: Run the new tests, `restore.test.ts` and `permissions.test.ts`.** All pass.
- [ ] **Step 5: Commit.** `git commit -m "Backups: encrypted copies to USB and Google Drive, never a readable copy off the VM"`

### Task 3: Console tools: make a key, decrypt, restore an encrypted backup

**Files:**
- Create: `apps/api/src/tools/backup-key.ts`. It prints `newPassphrase()` with print-and-seal instructions and
  does not write `.env`.
- Create: `apps/api/src/tools/decrypt-backup.ts`
- Modify: `apps/api/src/tools/restore-backup.ts`, which accepts `.db.enc`.
- Modify: `apps/api/src/services/backup.ts`. `restoreDatabase(opts)` gains an optional `label?: string`, used in
  the audit summary instead of the temp file's name.
- Modify: `apps/api/package.json`. Add the scripts `backup:new-key` and `backup:decrypt`, in the same `tsx
  --env-file-if-exists=.env` form as the others.
- Create: `new-backup-key.bat` and `decrypt-backup.bat` at the root, CRLF, following `restore-backup.bat`.
- Test: add to `apps/api/test/offsite-backup.test.ts`.

**Interfaces:**
- Consumes: Task 1's `decryptFile`, `isEncryptedFile`, `BackupKeyError`, `keyProblem`.
- Produces:
  - `decryptBackupToFile(encFile: string, passphrase: string, outFile?: string): Promise<{ file: string; check: BackupCheck }>`.
    The default `outFile` is the same path without `.enc`. It refuses to overwrite an existing file, and it never
    touches the live database.
  - `openEncryptedForRestore(encFile: string, passphrase: string): Promise<{ file: string; cleanup: () => void }>`.
    It decrypts to `<backupDir>/.restore-<rand>.db`.
- In the CLI, when `.env` has no key or the error is `different-key`, the tool asks "Type the backup key from the
  sealed paper:".

- [ ] **Step 1: Write the failing tests:**
  - `it('decrypts to a readable, checked copy next to the file')`: `check.ok`, and the file ends in `.db`.
  - `it('will not overwrite an existing file')`: rejects, and the existing file is unchanged.
  - `it('restores from an encrypted backup with the label in the audit trail')`: use the restore.test.ts pattern
    on throwaway files: `openEncryptedForRestore`, then `restoreDatabase({ ..., label: '<name>.enc' })`. The
    audit summary contains `'<name>.enc'`, and the temp file is gone after `cleanup()`.
  - `it('a different key is reported as such')`: `openEncryptedForRestore(enc, otherKey)` rejects with
    `kind === 'different-key'`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the two functions in `offsite.ts`, the `label` option, the CLIs and the scripts.**
- [ ] **Step 4: Run the tests (they pass), then run `npm run backup:new-key -w apps/api` once.** It prints one
  passphrase and the instructions.
- [ ] **Step 5: Commit.** `git commit -m "Backups: make a key, decrypt, and restore encrypted backups from the console"`

### Task 4: Show it: Backup card, security check, settings file, setup guide

**Files:**
- Modify: `apps/api/src/routes/backup.ts`. `GET /admin/backups` adds
  `offsite: { usbDir: string | null; driveRemote: string | null; keyProblem: string | null; last: OffsiteStatus | null }`.
  No new route.
- Modify: `apps/web/src/pages/Admin.tsx`, the `BackupCard`. It shows a line "Copies leaving this computer:
  encrypted to USB · Google Drive" with ok, failed or skipped badges and the last time. A red alert appears when
  `keyProblem` is set and a destination is configured.
- Modify: `apps/api/src/services/security-check.ts`.
  - New check `backup_encryption`:
    - **fail** when a USB folder or Drive remote is set and `keyProblem` is not null;
    - **ok** "Copies leaving this computer are encrypted" when set;
    - no row when neither is set (the existing `backup_copy` warning covers that).
  - New check `backup_drive`:
    - **warn** when the last status shows `drive.state === 'failed'`, with the detail;
    - **ok** when the last upload succeeded;
    - absent when there is no remote.
  - The `backup_copy` fix text mentions Google Drive via `BACKUP_RCLONE_REMOTE` as an alternative.
- Modify: `apps/api/.env.example`. Add the three settings, commented, with one line each.
- Create: `docs/BACKUP-ENCRYPTION.md`, generic with no farm addresses. It covers:
  1. making the key (`new-backup-key.bat` / `npm run backup:new-key`), printing and sealing it, and the
     **never change it** rule;
  2. installing rclone for the service user without root, connecting the official Google account
     (`rclone config` on the VM, with `rclone authorize` run on a PC that has a browser), and setting the
     remote;
  3. mounting the USB drive in the VM (VirtualBox: Devices → USB) so the service user can write to it;
  4. deleting old plain `.db` copies from the USB once encrypted ones are working;
  5. restoring an encrypted backup, and decrypt-only;
  6. **the file format table from Task 1**, so any developer can decrypt without FarmLedger.
- Test: `apps/api/test/security-check.test.ts` (add) and `apps/api/test/offsite-backup.test.ts` (route).

- [ ] **Step 1: Write the failing tests:**
  - `it('a copy folder without a key is a problem')`: `level('backup_encryption', { BACKUP_COPY_DIR: dir })` is
    `'fail'`, and with `BACKUP_ENCRYPTION_KEY: newPassphrase()` it is `'ok'`.
  - `it('a failed Drive upload is a warning')`: write a status file with `drive.state 'failed'`, then
    `level('backup_drive', { BACKUP_RCLONE_REMOTE: 'x:y', BACKUP_ENCRYPTION_KEY: k })` is `'warn'`.
  - `it('the Backup card data says where encrypted copies go')`: `GET /admin/backups` as the owner returns
    `offsite.keyProblem === null` and `offsite.usbDir` when configured. It never includes the key itself: the
    response text does not contain the passphrase.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Checks.**
  - Run the full suite and two shuffled orders (`--sequence.shuffle.files --sequence.seed=N`): all pass.
  - Run `npm run typecheck` and `npm run build`: both clean.
  - In the browser on port 4400 with a throwaway DB, a temp copy folder and a generated key: "Back up now" shows
    encrypted USB ok and Drive off. With the key removed and a restart, the card shows the red alert.
- [ ] **Step 5: Commit, push, open the PR, and send it to the chief engineer.**
