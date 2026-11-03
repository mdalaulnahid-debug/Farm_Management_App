# Encrypted backup copies (USB drive and Google Drive)

FarmLedger saves a backup of its database once a day, in its own backup folder on the server. Those local
backups are **not** encrypted. Every copy that **leaves the server** is encrypted with the farm's backup key:

- the USB drive copy (`BACKUP_COPY_DIR`);
- the Google Drive copy (`BACKUP_RCLONE_REMOTE`).

**Without a usable key, no copy leaves the server.** The local backup is still taken. The Backup card and the
security check (Settings → Organization) show a red problem until the key is set.

The settings all go in `apps/api/.env`. Restart FarmLedger after changing them.

| Setting | What it is |
|---|---|
| `BACKUP_ENCRYPTION_KEY` | The backup key (step 1). |
| `BACKUP_COPY_DIR` | A folder on the USB drive (step 3). |
| `BACKUP_RCLONE_REMOTE` | rclone remote and folder on Google Drive, for example `farmdrive:FarmLedger` (step 2). |
| `BACKUP_RCLONE_BIN` | Optional: the rclone program, if it is not on the PATH. |
| `BACKUP_KEEP_DAYS` | Days of copies to keep, on the server, the USB drive and Google Drive. Default 30. |

## 1. Make the key, print it, seal it

On the server, in the FarmLedger folder:

```bash
npm run backup:new-key -w apps/api
```

On Windows, double-click `new-backup-key.bat` instead.

It prints a key such as `abcd-efgh-jkmn-...` (8 groups of 4) and its fingerprint. It does not save the key anywhere.

1. Write or print the key on paper. Seal it in an envelope, write "FarmLedger backup key" and the date on it,
   and keep it in the office safe.
2. Put it in `apps/api/.env` as `BACKUP_ENCRYPTION_KEY=<the key>`, then restart FarmLedger.
3. Check the Backup card: "Back up now" should show the USB and Google Drive copies as **ok**.

> **Never change the key.** A backup opens only with the key it was made with.
> If the key ever has to change, keep the old paper with the old backups.
>
> **If both the paper and the server's copy of the key are lost, the encrypted backups can never be opened.**
> Nobody, including FarmLedger's developers, can recover them.

Capital letters, spaces and dashes do not matter when the key is typed back in.

## 2. Google Drive with rclone

Use the farm's **official** Google account. rclone runs as the same user as FarmLedger, with no root access needed.

1. **Install rclone for the FarmLedger user.** On a Linux server, download the "Linux amd64 zip" from
   rclone.org/downloads, unzip it, and put the `rclone` program in `~/bin`. Then check it with `~/bin/rclone version`.
   If `~/bin` is not on the service's PATH, set `BACKUP_RCLONE_BIN=/home/<user>/bin/rclone`.
2. **Connect the Google account.** The server has no browser, so the sign-in is done on a PC:
   - On the server, run `rclone config` → `n` (new remote) → name `farmdrive` → storage `drive` → leave client ID
     and secret empty → scope **`drive.file`** (rclone sees only the files it made itself, not the rest of the farm's
     Drive; that is enough to upload and remove old copies) → leave the rest at the defaults →
     answer **No** to "Use web browser to automatically authenticate".
   - rclone prints a command `rclone authorize "drive" "..."`. Run that on a Windows PC with rclone installed,
     sign in with the **farm's official Google account** in the browser that opens, and paste the code it prints
     back into the server.
3. **Make the folder:** `rclone mkdir farmdrive:FarmLedger`.
4. Set `BACKUP_RCLONE_REMOTE=farmdrive:FarmLedger` in `apps/api/.env` and restart FarmLedger.

After each backup, FarmLedger uploads the encrypted copy. It then deletes encrypted copies on that Drive folder
that are older than `BACKUP_KEEP_DAYS`. A failed upload is shown on the Backup card and in the security check.
It never stops the local backup.

The rclone sign-in token is kept in `~/.config/rclone/rclone.conf` on the server. Anyone with that file can reach
the files rclone made (the FarmLedger folder), but not the farm's other Drive files, and the backups there are
still encrypted. If the server is ever lost or stolen, remove FarmLedger's access in the Google account
(Security → Third-party apps).

FarmLedger keeps the newest 7 copies on Drive and removes older copies past `BACKUP_KEEP_DAYS`, the same rule as
on the server. Only files named like `farmledger-<date>-<time>.db.enc` at the top of that folder are ever removed.

## 3. The USB drive

1. **Give the server the drive.** For a VirtualBox virtual machine, plug the drive into the host PC, then in the
   VM's window choose **Devices → USB →** the drive. To make this permanent, add a USB filter for it in the VM's
   settings (Settings → USB).
2. **Mount it** at a fixed folder that the FarmLedger user can write to, for example `/mnt/farm-backup`. Add an
   `/etc/fstab` line with the `nofail` option, so the server still starts without the drive.
3. With the drive mounted, **make the folder on the drive yourself**: `mkdir /mnt/farm-backup/FarmLedger`.
   FarmLedger never creates it. When the drive is missing, the folder is missing too, so the problem shows.
   (If FarmLedger made the folder, an unplugged drive would leave an empty `/mnt/farm-backup` and the copy would
   quietly land on the server's own disk.)
4. Set `BACKUP_COPY_DIR=/mnt/farm-backup/FarmLedger` in `apps/api/.env` and restart FarmLedger.

On Windows, make the folder on the drive (for example `E:\FarmLedger`) and set `BACKUP_COPY_DIR=E:\FarmLedger`.

Copies are written under a hidden `.part` name first and renamed when complete. A drive pulled out mid-copy never
leaves a file that looks like a backup. An unplugged drive is shown as a problem; the local backup and the Google
Drive upload still happen.

**Old plain copies.** Before this change, the USB drive received readable `.db` copies. FarmLedger never deletes
those. Once the encrypted `.db.enc` copies are arriving, delete the old `.db` files from the drive by hand.

## 4. Restoring and decrypting

**Restore** (puts an encrypted backup back as the farm's database). Stop FarmLedger first, then run:

```bash
npm run db:restore -w apps/api -- /path/to/farmledger-2026-11-03-0300.db.enc
```

On Windows, double-click `restore-backup.bat` and give the full path.

The key comes from `apps/api/.env`. If it is not there, or the file was made with a different key, the tool asks
for the key from the sealed paper. The backup is checked before anything changes, and the current database is
kept as a copy first.

**Decrypt only** (a readable copy for an auditor, or to inspect a backup; the live database is not touched):

```bash
npm run backup:decrypt -w apps/api -- /path/to/farmledger-2026-11-03-0300.db.enc
```

On Windows, double-click `decrypt-backup.bat`.

It writes `farmledger-2026-11-03-0300.decrypted.db` in the server's backup folder (never next to the encrypted file,
which may be on the USB drive), checks it, and never overwrites an existing
file. That copy is **not** encrypted: delete it when you are done.

## 5. The file format (decrypting without FarmLedger)

Any developer with the key can decrypt a `.db.enc` file without FarmLedger. The result is a normal SQLite
database file.

| Bytes | Content |
|---|---|
| 0–7 | `FLBKENC1` (ASCII), the format tag |
| 8–23 | scrypt salt, 16 bytes |
| 24–31 | key fingerprint, 8 bytes |
| 32–43 | AES-256-GCM IV, 12 bytes |
| 44 to end − 16 | ciphertext |
| last 16 bytes | AES-GCM authentication tag |

- **Key material:** the key, lower-cased, with everything except `a–z` and `0–9` removed.
- **Encryption key:** `scrypt(material, salt, 32 bytes, N = 2^15, r = 8, p = 1)`.
- **Fingerprint:** `scrypt(material, "FarmLedger backup key fingerprint v1", 8 bytes, same N, r, p)`. If it differs
  from bytes 24–31, the file was made with a different key.
- **Cipher:** AES-256-GCM, no additional authenticated data. Decrypt the ciphertext with the key, IV and tag; a
  tag mismatch means the file was changed or cut short.

For example, in Node.js:

```js
const { scryptSync, createDecipheriv } = require('node:crypto');
const fs = require('node:fs');
const f = fs.readFileSync('backup.db.enc');
const material = process.argv[2].toLowerCase().replace(/[^a-z0-9]/g, '');
const key = scryptSync(material, f.subarray(8, 24), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const d = createDecipheriv('aes-256-gcm', key, f.subarray(32, 44));
d.setAuthTag(f.subarray(f.length - 16));
fs.writeFileSync('backup.db', Buffer.concat([d.update(f.subarray(44, f.length - 16)), d.final()]));
```
