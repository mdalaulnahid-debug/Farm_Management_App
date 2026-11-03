// Security settings check: is this install set up the safe way? Looks at the .env settings, the owner
// accounts and the backups, and says in plain words what to change. Read-only; it never changes a
// setting itself. Shown to the owner in Settings → Organization, printed by `npm run security:check`
// (security-check.bat on Windows) on the server, and summarised in the server log at start-up.
import { accessSync, constants, existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import type { Db } from '../db.js';
import { verifyPassword } from '../auth/auth.js';
import { isSqlite, listBackups } from './backup.js';
import { keyProblem } from './backup-crypto.js';
import { readOffsiteStatus } from './offsite.js';
import { verifyAuditChain } from './audit-chain.js';

/** The starting password in .env.example; nobody may still be using it. */
export const EXAMPLE_ADMIN_PASSWORD = 'ChangeMe!2026';
const MAX_SESSION_HOURS = 12;
const BACKUP_STALE_DAYS = 2;

type Env = Record<string, string | undefined>;
type Text = { en: string; bn: string };
export interface SecurityCheck {
  key: string;
  /** ok: nothing to do. warn: should be fixed. fail: fix before people use the app. */
  level: 'ok' | 'warn' | 'fail';
  title: Text;
  /** What to change, when it is not ok. */
  fix: Text | null;
}
export interface SecurityReport { ok: boolean; warnings: number; failures: number; checkedAt: string; checks: SecurityCheck[] }

const text = (en: string, bn: string): Text => ({ en, bn });

/** 127.0.0.1 / ::1 / localhost: only programs on this computer (such as `tailscale serve`) can connect. */
export const isLoopback = (host: string) => host === 'localhost' || host === '::1' || /^127\./.test(host);
/** A Tailscale address (100.64.0.0/10): only devices on the farm's tailnet can connect. */
export const isTailscaleAddress = (host: string) => {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
};

export async function securityCheck(db: Db, env: Env = process.env): Promise<SecurityReport> {
  const checks: SecurityCheck[] = [];
  const add = (key: string, level: SecurityCheck['level'], title: Text, fix: Text | null = null) => checks.push({ key, level, title, fix });

  const host = (env.HOST ?? '').trim() || '0.0.0.0';
  const proxied = !!(env.TRUST_PROXY ?? '').trim() && env.TRUST_PROXY!.trim() !== 'false';

  // 1. Is there an HTTPS front door?
  if (proxied) add('https', 'ok', text('Reached through an HTTPS proxy (TRUST_PROXY is set).', 'একটি HTTPS প্রক্সির মাধ্যমে চালু (TRUST_PROXY সেট করা)।'));
  else add('https', 'warn',
    text('No HTTPS proxy is set up: pages and passwords travel as plain HTTP.', 'কোনো HTTPS প্রক্সি নেই: পেজ ও পাসওয়ার্ড সাধারণ HTTP-তে যায়।'),
    text('Over Tailscale the connection is already encrypted, but not over the office network. Run `tailscale serve --bg 4000`, then set TRUST_PROXY=127.0.0.1 and HOST=127.0.0.1 in apps/api/.env.',
      'Tailscale-এ সংযোগ আগেই এনক্রিপ্টেড, অফিস নেটওয়ার্কে নয়। `tailscale serve --bg 4000` চালান, তারপর apps/api/.env-এ TRUST_PROXY=127.0.0.1 ও HOST=127.0.0.1 দিন।'));

  // 2. Who can reach port 4000 directly?
  if (isLoopback(host)) add('listen_address', 'ok', text(`Listens on ${host} only: just this computer can connect directly.`, `শুধু ${host}-এ চালু: সরাসরি শুধু এই কম্পিউটার সংযোগ করতে পারে।`));
  else if (isTailscaleAddress(host)) add('listen_address', 'ok', text(`Listens on the Tailscale address ${host} only: just the farm's devices can connect.`, `শুধু Tailscale ঠিকানা ${host}-এ চালু: শুধু খামারের ডিভাইস সংযোগ করতে পারে।`));
  else add('listen_address', proxied ? 'fail' : 'warn',
    text(`Listens on every network this computer is on (HOST=${host}), including the office network and Wi-Fi.`, `এই কম্পিউটারের সব নেটওয়ার্কে চালু (HOST=${host}), অফিস নেটওয়ার্ক ও ওয়াই-ফাই সহ।`),
    proxied
      ? text('Anyone on the office network can open port 4000 directly and skip HTTPS. Set HOST=127.0.0.1 in apps/api/.env.', 'অফিস নেটওয়ার্কের যে কেউ সরাসরি পোর্ট 4000 খুলে HTTPS এড়াতে পারে। apps/api/.env-এ HOST=127.0.0.1 দিন।')
      : text('Set HOST to this computer\'s Tailscale address (100.x.x.x, see `tailscale ip -4`), or better use `tailscale serve` with HOST=127.0.0.1.', 'HOST-এ এই কম্পিউটারের Tailscale ঠিকানা (100.x.x.x, `tailscale ip -4` দেখুন) দিন, অথবা আরও ভালো: HOST=127.0.0.1 দিয়ে `tailscale serve` ব্যবহার করুন।'));

  // 3. The Secure cookie flag must match how people connect, or nobody can sign in.
  if (env.NODE_ENV === 'production' && !proxied) add('cookie', 'fail',
    text('NODE_ENV=production without an HTTPS proxy: browsers will refuse the sign-in cookie over plain HTTP.', 'HTTPS প্রক্সি ছাড়া NODE_ENV=production: সাধারণ HTTP-তে ব্রাউজার সাইন-ইন কুকি নেবে না।'),
    text('Either set up `tailscale serve` with TRUST_PROXY=127.0.0.1, or set NODE_ENV=development until you do.', 'হয় TRUST_PROXY=127.0.0.1 দিয়ে `tailscale serve` চালু করুন, নয়তো ততদিন NODE_ENV=development রাখুন।'));
  else add('cookie', 'ok', text('The sign-in cookie is HTTP-only and marked Secure whenever HTTPS is used.', 'সাইন-ইন কুকি HTTP-only, এবং HTTPS হলে Secure চিহ্নিত।'));

  // 4. Starting passwords.
  const users = await db.user.findMany({ where: { active: true }, include: { role: true } });
  const known = [...new Set([EXAMPLE_ADMIN_PASSWORD, env.ADMIN_PASSWORD].filter((p): p is string => !!p))];
  const weak: string[] = [];
  for (const u of users) {
    for (const p of known) if (await verifyPassword(p, u.passwordHash)) { weak.push(u.email); break; }
  }
  if (weak.length) add('default_password', 'fail',
    text(`Still using the starting password from the setup file: ${weak.join(', ')}.`, `সেটআপ ফাইলের শুরুর পাসওয়ার্ড এখনো ব্যবহার হচ্ছে: ${weak.join(', ')}।`),
    text('Sign in as that person and change the password now (My account → Password), or reset it from the server console (npm run user:reset-password -w apps/api -- <email>, or reset-password.bat on Windows).', 'সেই ব্যক্তি হিসেবে সাইন ইন করে এখনই পাসওয়ার্ড বদলান (আমার অ্যাকাউন্ট → পাসওয়ার্ড), অথবা তার জন্য reset-password.bat চালান।'));
  else add('default_password', 'ok', text('Nobody uses the starting password from the setup file.', 'কেউ সেটআপ ফাইলের শুরুর পাসওয়ার্ড ব্যবহার করছেন না।'));

  if (env.ADMIN_PASSWORD) add('admin_password_in_env', 'warn',
    text('apps/api/.env still holds ADMIN_PASSWORD, the starting owner password.', 'apps/api/.env-এ এখনো ADMIN_PASSWORD (শুরুর মালিক পাসওয়ার্ড) আছে।'),
    text('It is only needed for the very first setup. Delete the ADMIN_PASSWORD line from apps/api/.env and restart FarmLedger.', 'এটি শুধু প্রথম সেটআপে লাগে। apps/api/.env থেকে ADMIN_PASSWORD লাইনটি মুছে FarmLedger আবার চালু করুন।'));
  else add('admin_password_in_env', 'ok', text('No starting password is kept in the settings file.', 'সেটিংস ফাইলে কোনো শুরুর পাসওয়ার্ড রাখা নেই।'));

  // 5. Owner accounts: a spare one, and no owner left on a temporary password.
  const owners = users.filter(u => u.role.key === 'owner');
  const temporary = owners.filter(u => u.mustChangePassword).map(u => u.email);
  if (temporary.length) add('owners', 'warn',
    text(`Owner account still on a temporary password: ${temporary.join(', ')}.`, `মালিক অ্যাকাউন্ট এখনো অস্থায়ী পাসওয়ার্ডে: ${temporary.join(', ')}।`),
    text('Sign in with it and choose a new password.', 'এটি দিয়ে সাইন ইন করে নতুন পাসওয়ার্ড বেছে নিন।'));
  else if (owners.length < 2) add('owners', 'warn',
    text('There is only one owner account.', 'মাত্র একটি মালিক অ্যাকাউন্ট আছে।'),
    text('Add a spare owner account (Users → Add user, role Owner) and keep its password sealed in the office safe. If the main owner is locked out, the spare can let them back in.', 'একটি অতিরিক্ত মালিক অ্যাকাউন্ট যোগ করুন (ব্যবহারকারী → নতুন ব্যবহারকারী, ভূমিকা মালিক) এবং এর পাসওয়ার্ড অফিসের সিন্দুকে সিল করে রাখুন।'));
  else add('owners', 'ok', text(`${owners.length} owner accounts, none on a temporary password.`, `${owners.length}টি মালিক অ্যাকাউন্ট, কোনোটি অস্থায়ী পাসওয়ার্ডে নয়।`));

  // 6. Sign-in lifetime.
  const hours = Number(env.SESSION_HOURS || 12);
  if (!(hours > 0) || hours > MAX_SESSION_HOURS) add('session_hours', 'warn',
    text(`A sign-in lasts ${env.SESSION_HOURS} hours.`, `একটি সাইন-ইন ${env.SESSION_HOURS} ঘণ্টা থাকে।`),
    text(`Set SESSION_HOURS to ${MAX_SESSION_HOURS} or less, so a forgotten browser does not stay signed in for days.`, `SESSION_HOURS ${MAX_SESSION_HOURS} বা কম দিন, যাতে ভুলে খোলা ব্রাউজার দিনের পর দিন সাইন-ইন না থাকে।`));
  else add('session_hours', 'ok', text(`A sign-in ends after ${hours} hours.`, `${hours} ঘণ্টা পরে সাইন-ইন শেষ হয়।`));

  // 7. Backups: recent, and a copy off this computer.
  if (isSqlite()) {
    const newest = listBackups()[0];
    const ageDays = newest ? (Date.now() - new Date(newest.createdAt).getTime()) / 86_400_000 : Infinity;
    if (ageDays > BACKUP_STALE_DAYS) add('backup_recent', 'warn',
      text(newest ? `The newest backup is ${Math.floor(ageDays)} days old.` : 'No backup has been taken yet.', newest ? `সর্বশেষ ব্যাকআপ ${Math.floor(ageDays)} দিন পুরোনো।` : 'এখনো কোনো ব্যাকআপ নেওয়া হয়নি।'),
      text('Keep FarmLedger running (it backs up once a day), or click “Back up now” in the Backup card.', 'FarmLedger চালু রাখুন (দিনে একবার ব্যাকআপ নেয়), অথবা ব্যাকআপ কার্ডে “এখনই ব্যাকআপ নিন” চাপুন।'));
    else add('backup_recent', 'ok', text('A backup was taken in the last 2 days.', 'গত ২ দিনে একটি ব্যাকআপ নেওয়া হয়েছে।'));

    const extra = env.BACKUP_COPY_DIR ? resolve(env.BACKUP_COPY_DIR) : null;
    const remote = env.BACKUP_RCLONE_REMOTE?.trim() || null;
    let writable = false;
    if (extra && existsSync(extra)) try { accessSync(extra, constants.W_OK); writable = true; } catch { /* reported below */ }
    if (!extra && !remote) add('backup_copy', 'warn',
      text('Backups stay only on this computer.', 'ব্যাকআপ শুধু এই কম্পিউটারেই থাকে।'),
      text('If this computer dies or is stolen, the books go with it. Set BACKUP_COPY_DIR in apps/api/.env to a USB drive (e.g. E:\\FarmLedger on Windows, or a mounted drive such as /mnt/farm-backup on Linux), or BACKUP_RCLONE_REMOTE to upload to Google Drive. See docs/BACKUP-ENCRYPTION.md.', 'এই কম্পিউটার নষ্ট বা চুরি হলে হিসাবও যাবে। apps/api/.env-এ BACKUP_COPY_DIR-এ একটি ইউএসবি ড্রাইভ দিন, অথবা Google Drive-এ পাঠাতে BACKUP_RCLONE_REMOTE দিন।'));
    else if (!extra) { /* Google Drive only: reported by backup_drive below. */ }
    else if (!writable) add('backup_copy', 'fail',
      text(`The second backup folder ${extra} is missing or cannot be written to.`, `দ্বিতীয় ব্যাকআপ ফোল্ডার ${extra} নেই বা এতে লেখা যায় না।`),
      text('Plug in the drive or start Google Drive, or correct BACKUP_COPY_DIR in apps/api/.env.', 'ড্রাইভটি লাগান বা Google Drive চালু করুন, অথবা apps/api/.env-এ BACKUP_COPY_DIR ঠিক করুন।'));
    else add('backup_copy', 'ok', text(`Every backup is also copied to ${extra}.`, `প্রতিটি ব্যাকআপ ${extra}-এও কপি হয়।`));

    // Copies leaving this computer must be encrypted; without a usable key none are sent.
    const problem = keyProblem(env.BACKUP_ENCRYPTION_KEY);
    if ((extra || remote) && problem) add('backup_encryption', 'fail',
      text(`No backup copies leave this computer: ${problem}`, 'কোনো ব্যাকআপ কপি এই কম্পিউটারের বাইরে যাচ্ছে না: এনক্রিপশন কী নেই বা খুব ছোট।'),
      text('Make a key with new-backup-key.bat (npm run backup:new-key), seal the printed key in the office safe, put it in apps/api/.env as BACKUP_ENCRYPTION_KEY and restart FarmLedger.', 'new-backup-key.bat (npm run backup:new-key) দিয়ে একটি কী বানান, ছাপানো কী অফিসের সিন্দুকে সিল করে রাখুন, apps/api/.env-এ BACKUP_ENCRYPTION_KEY হিসেবে দিন এবং FarmLedger আবার চালু করুন।'));
    else if (extra || remote) add('backup_encryption', 'ok', text('Copies leaving this computer are encrypted.', 'এই কম্পিউটারের বাইরে যাওয়া কপিগুলো এনক্রিপ্ট করা।'));

    if (remote) {
      const drive = readOffsiteStatus()?.drive;
      if (drive?.state === 'ok') add('backup_drive', 'ok', text('The last backup was uploaded to Google Drive.', 'সর্বশেষ ব্যাকআপ Google Drive-এ আপলোড হয়েছে।'));
      else add('backup_drive', 'warn',
        text(drive?.detail ?? 'No backup has been uploaded to Google Drive yet.', drive?.detail ? 'সর্বশেষ Google Drive আপলোড ব্যর্থ হয়েছে।' : 'এখনো কোনো ব্যাকআপ Google Drive-এ আপলোড হয়নি।'),
        text('Check that rclone is installed for the FarmLedger user and signed in to the farm Google account (docs/BACKUP-ENCRYPTION.md), then click “Back up now”.', 'FarmLedger ব্যবহারকারীর জন্য rclone ইনস্টল ও খামারের Google অ্যাকাউন্টে সাইন-ইন আছে কিনা দেখুন, তারপর “এখনই ব্যাকআপ নিন” চাপুন।'));
    }
  }

  // 8. The audit trail has not been edited behind the app's back.
  const chain = await verifyAuditChain(db, null);
  if (chain.ok) add('audit_chain', 'ok', text('The audit trail is intact.', 'অডিট ট্রেইল অক্ষত।'));
  else add('audit_chain', 'fail',
    text('The audit trail has been changed outside the app.', 'অ্যাপের বাইরে থেকে অডিট ট্রেইল বদলানো হয়েছে।'),
    text('See Settings → Audit trail for the first changed entry, keep every backup, and ask your developer to compare them.', 'প্রথম বদলানো এন্ট্রি দেখতে সেটিংস → অডিট ট্রেইল দেখুন, সব ব্যাকআপ রাখুন এবং ডেভেলপারকে মিলিয়ে দেখতে বলুন।'));

  const failures = checks.filter(c => c.level === 'fail').length;
  const warnings = checks.filter(c => c.level === 'warn').length;
  return { ok: failures === 0, warnings, failures, checkedAt: new Date().toISOString(), checks };
}
