# Installable app, encrypted off-site backups, passkey sign-in

*Design agreed with the owner on 2026-11-03. Three separate PRs, built in this order:
1 installable app, 2 encrypted backups, 3 passkeys.*

## Why

FarmLedger is the farm's back-office ledger, reached only over the farm's Tailscale network by about
10 people. They use Android phones, iPhones, the office Windows PC and Windows laptops. Three gaps remain:

- Staff open it as a browser bookmark. They should have a proper app icon on their phone and the Windows taskbar.
- Backups leave the VM unprotected. **The owner's main worry is a lost or stolen backup**, especially the USB
  drive, being opened by someone else. The office itself is considered secure, so theft of the office PC is not
  a concern.
- Sign-in should be as strong as a bank's staff systems, and easier. Phones and laptops already have
  fingerprint, face or Windows Hello. A passkey makes those the way in.

The owner dropped an idle sign-out. Do not build one.

## Part 1: installable app (small)

**Decided by the owner**

- **Name.** The short name under the icon is **"BDP Agro Farm"**. The full name is "Barishal District Police Agro Farm".
  Both are static: this install is one farm.
- **Icon.** Use the current brand mark: the lucide **Leaf** in dark green `#0e3b2c` on a gold rounded tile
  (`--gold`, as `.brand-mark` in `apps/web/src/styles.css`). Wherever the icon sits on a background, use the
  farm's dark green (`#0f5132`, the existing `theme-color`).

**Goals**

- The app installs from Chrome on Android, Windows and the office PC, and from Safari on iPhone
  ("Add to Home Screen").
- Once installed, it opens in its own window with no address bar, and shows the farm's name and icon.
- The favicon changes to the same leaf mark. Today the favicon is a different leaf.

**Non-goals and anti-goals**

- **No offline mode, and no caching of pages or API data.** This is financial data, and a stale screen would be
  worse than none. If the browser needs a service worker for installation, that worker must pass every request
  straight to the network.
- No app store, and no native app.

**My calls**

- **An installed app is tied to the site's address, like a passkey.** The setup steps say to install it only
  after the address rename.
- **Installing needs HTTPS.** The `tailscale serve` address already provides it. The plain `http://…:4000`
  address can't be installed, and closes anyway.

**Left to the builder**

- The manifest fields (`display: standalone`, `start_url: /`, `scope: /`).
- The icon sizes: 192, 512 and 512 maskable PNG, plus a 180 apple-touch-icon. Generate them once and commit
  them; do not add an image library to the app.
- Whether a pass-through service worker is needed.

Check the result in the browser's install prompt.

## Part 2: encrypted off-site backups

**Decided by the owner**

- **Which copies are encrypted.** Every backup copy that **leaves the VM** is encrypted: the
  `BACKUP_COPY_DIR` copy (USB) and a new **Google Drive** copy.
- **Which Drive.** The farm's **official Google account's Drive**: the same account as the farm's Tailscale.
- **Where the key lives.** In the VM's settings (`apps/api/.env`), so daily backups encrypt automatically.
  A **printed copy is sealed in the office safe**. If both are lost, the encrypted backups are gone forever.
  The setup steps must say so plainly.

**My calls (the owner can override)**

- **The live database is not encrypted,** and neither are the backups inside the VM's own backup folder.
  The office is secure, so this avoids new risk to the live data. It also means the existing "Check" button
  and the restore drill keep working unchanged on local backups.
- **Encryption method.** Node's built-in crypto, so no new library.
  - AES-256-GCM, with the key derived from a passphrase by scrypt.
  - A small file header holds a format tag, the salt and the IV, so a file is self-describing.
  - The file name ends in `.db.enc`.
  - Process files in streams or chunks. The database will grow.
- **Making the passphrase.** A console command generates a strong, readable one to print and seal: about
  8 groups of letters and digits, with no look-alike characters, like the temporary passwords in
  `reset-password.ts`. It does **not** write the passphrase into `.env` itself. The owner or deployer puts it
  there, so it is never in a log.
- **Google Drive upload.** Use **rclone**, installed on the VM. FarmLedger runs it after each backup, when a
  setting names the rclone remote and folder. The connection to the Google account is made once by the owner
  (an rclone sign-in), following the setup steps.
  - Drive keeps the same days as `BACKUP_KEEP_DAYS` (default 30). Older encrypted files on Drive are deleted
    the same way.
  - Upload failures are logged, and shown in the app. They never stop the local backup.
- **Restoring.**
  - The restore tool accepts a `.db.enc` file. It asks for the passphrase, or uses the one in `.env`.
  - It decrypts to a temporary file, runs the existing `checkBackup`, and then follows the existing
    restore path.
  - A wrong passphrase gives a clear message, never a crash or a half-written file.
- **Decrypt-only command (the owner asked how to decrypt).**
  - A console command turns a `.db.enc` file into a plain `.db` copy next to it, after running `checkBackup`
    on it.
  - It never touches the live database. The key comes from `.env`, or the command asks for it.
  - Use: an auditor wants old books, or someone needs to inspect a backup.
- **A documented format, so the backups don't depend on FarmLedger.** The exact file layout (header, scrypt
  settings, AES-256-GCM, where the tag sits) is written in the repository docs. Any developer with the
  passphrase can decrypt a backup without FarmLedger.
- **Showing it in the app.**
  - The Backup card shows whether copies leave the VM encrypted, and when the last Drive upload happened.
  - The security check (`services/security-check.ts`) adds checks for:
    - a copy folder set but no encryption key (a **problem**);
    - an encryption key that is too short or weak;
    - the last Drive upload failing.
- **Never a readable copy off the VM.** This follows the owner's main worry.
  - If a copy folder or a Drive remote is set but there is no encryption key, **no off-VM copy is written or
    uploaded**. The local backup is still taken. The log and the security check report a **problem**.
  - A key shorter than 20 characters is refused the same way: no off-VM copy, and a problem.
  - A generated passphrase is always long enough.
- **No key changes in this version.** Each encrypted file stores a short fingerprint of its key, not the key
  itself. That lets restore say "this file was made with a different key" instead of "wrong passphrase".
  - The setup steps say: never change the key. If it must change, keep the old printed key with the old files.
  - Proper key rotation can come later if needed.
- **USB in practice.** The VM runs in VirtualBox on the office PC. The USB drive is passed through to the VM
  and mounted at a folder that is writable by the service user.
  - An unplugged or missing drive is reported as a **problem** in the security check, as `backup_copy` already
    does, and logged at each backup.
  - It never stops the local backup or the Drive upload.
- **Old copies.** Plain `.db` files already in the copy folder are left alone. The setup steps tell the owner
  to delete them once encrypted copies are working.

**Constraints**

- The VM is Ubuntu 24.04, run by systemd as an unprivileged user. Passwordless sudo is limited to restarting
  the service. rclone must therefore work as that user, from its home folder.
- Schema changes must be additive only (`prisma db push` runs unattended). This part should need none.

**Left to the builder**

- The setting names.
- The exact file header layout.
- How rclone is called. Pass arguments as a list, never through a shell.
- The prune command on Drive.

## Part 3: passkey sign-in with fingerprint, face or Windows Hello

**Decided by the owner**

- **Sign-in.** The sign-in page gets **"Sign in with fingerprint / face"**. One touch signs you in, with no
  password and no 6-digit code. **Password plus 2-step code stays as the backup way in.**
- **Devices.** Android phones, iPhones, the office Windows PC and Windows laptops.
- **The address comes first.** Passkeys are tied to the site's address, and the owner **will rename the address
  first**. Building can start now. Setting up passkeys waits for the rename; the setup steps must say so.

**My calls (the owner can override)**

- **Library.** `@simplewebauthn/server` and `@simplewebauthn/browser`: well known and maintained.
- **Biometric check.** Require `userVerification: 'required'`, so the phone or PC checks the fingerprint, face
  or PIN. That is why a passkey counts as strong as password plus code.
- **Picking the account.** Use discoverable credentials, so the user does not type an email.
- **A passkey needs 2-step on first.** You can only add a passkey once 2-step sign-in (authenticator code) is
  already on for your account. That guarantees the backup way in always exists.
  - Adding a passkey also needs your password.
  - A passkey sign-in counts as a 2-step sign-in.
  - "Require 2-step for everyone" is unchanged.
- **Several per person.** One for each device. My settings → Password & security lists them with a name
  (from the device or browser, editable), when each was added and when it was last used. Each can be removed.
- **Synced passkeys are allowed.** Google Password Manager and iCloud Keychain may copy a passkey to the same
  person's other devices. Forbidding that cannot be enforced on phones, and Tailscale device approval still
  blocks any device the owner has not approved. The design accepts this.
- **Lost phone.** "Reset 2-step sign-in" (admin) and the console password reset both also remove that person's
  passkeys.
- **Turning off 2-step yourself also removes your passkeys.** The screen warns first. This keeps the rule that a
  passkey only exists alongside 2-step.
- **The forced password change still applies.** A passkey sign-in on an account flagged "must change password"
  lands on the change-password screen, exactly as a password sign-in does. The existing guards handle it, and
  the session rules don't change.
- **Audit and reporting.**
  - Adding, removing and signing in with a passkey are all recorded in the audit trail, with the
    sign-in marked "(passkey)".
  - Unusual sign-ins reporting keeps working.
- **Which address.** The relying-party ID and the expected origin come from the address the browser used
  (`https://<host>`). An optional setting can pin them.
  - Passkeys need HTTPS. Over plain HTTP the button is hidden, with a short note.
  - The local `localhost` dev and test setup must still work.
- **Storage.** A new `Passkey` table: credential ID, public key, counter, transports, name, created and
  last-used times, and the user. This is additive.
  - Challenges are kept in memory with a short life, like the 2-step tickets.
  - Each challenge can be used once.
- **Limits.** Passkey sign-in has the same rate limit as password sign-in. A failed check is recorded as a
  failed sign-in, but does not count toward the account lock, because passkeys cannot be guessed.

**Goals**

- One-touch sign-in on all four device types.
- No new way in that skips the biometric or 2-step check.
- Existing sign-in, 2-step, lockout, session and permission rules are unchanged.

**Anti-goals**

- No way to sign in with a passkey and no biometric or PIN check.
- No path where someone with only a stolen session can add a passkey.
- No secret material in API responses or logs.

**Left to the builder**

- The exact API routes. Each new route must be added to the permission matrix test.
- The web layout of the passkey list.
- How the device name is guessed.

## Constraints for all three

- Each PR has tests, keeps the full suite passing in shuffled order, and passes type checks and the build.
- Check in the browser on a spare port (4400) with a throwaway database. Never use port 4000 or the live
  database.
- No secrets in git. The repository is **public**, so keep farm-specific addresses out of committed files.
- Plain English and Bangla for every user-facing string, as in the rest of the app.
