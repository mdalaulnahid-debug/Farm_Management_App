// Off-site backups: copies leaving the farm's computer (USB drive, Google Drive) are always encrypted,
// never readable, and a problem with either never stops the local backup.
// rclone is replaced by a recording fake; every folder is a throwaway temp folder.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { prisma } from '../src/db.js';
import { seed } from '../src/seed.js';
import { checkBackup, restoreDatabase, runBackup } from '../src/services/backup.js';
import { BackupKeyError, decryptFile, encryptFile, newPassphrase } from '../src/services/backup-crypto.js';
import { decryptBackupToFile, openEncryptedForRestore, readOffsiteStatus, setRcloneRunner } from '../src/services/offsite.js';

let root = '';
let run = 0;
let usb = '';
let calls: string[][] = [];
let rcloneAnswer = { ok: true, output: '' };
const key = newPassphrase();
const quiet = { info: () => {}, error: () => {} };
const ENV = ['BACKUP_DIR', 'BACKUP_COPY_DIR', 'BACKUP_RCLONE_REMOTE', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_KEEP_DAYS'];

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
  root = mkdtempSync(join(tmpdir(), 'farmledger-offsite-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  run++;
  process.env.BACKUP_DIR = join(root, `backups-${run}`);
  usb = join(root, `usb-${run}`);
  process.env.BACKUP_COPY_DIR = usb;
  process.env.BACKUP_ENCRYPTION_KEY = key;
  calls = [];
  rcloneAnswer = { ok: true, output: '' };
  setRcloneRunner(async args => { calls.push(args); return rcloneAnswer; });
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  setRcloneRunner(null);
});

const pad = (n: number) => String(n).padStart(2, '0');
const nameFor = (d: Date) => `farmledger-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-0300.db.enc`;
const tmpLeft = () => readdirSync(process.env.BACKUP_DIR!).filter(n => n.startsWith('.tmp-'));

describe('off-site backups', () => {
  it('writes only an encrypted copy to the USB folder', async () => {
    const b = await runBackup('manual', quiet);
    expect(readdirSync(usb)).toEqual([`${b.name}.enc`]);
    const out = join(root, `check-${run}.db`);
    await decryptFile(join(usb, `${b.name}.enc`), out, key);
    expect((await checkBackup(out)).ok).toBe(true);
    expect(b.offsite.usb.state).toBe('ok');
    expect(b.offsite.drive.state).toBe('off');
  });

  it('writes nothing off the VM without a usable key, but still backs up locally', async () => {
    process.env.BACKUP_RCLONE_REMOTE = 'farmdrive:FarmLedger';
    for (const k of [undefined, 'tooshort123']) {
      if (k) process.env.BACKUP_ENCRYPTION_KEY = k; else delete process.env.BACKUP_ENCRYPTION_KEY;
      const b = await runBackup('manual', quiet);
      expect(existsSync(usb) ? readdirSync(usb) : []).toEqual([]);
      expect(calls).toEqual([]);
      expect(b.offsite.usb.state).toBe('skipped-no-key');
      expect(b.offsite.drive.state).toBe('skipped-no-key');
      expect(b.check.ok).toBe(true);
      expect(existsSync(join(process.env.BACKUP_DIR!, b.name))).toBe(true);
    }
  });

  it('uploads to Drive and prunes old copies there', async () => {
    process.env.BACKUP_RCLONE_REMOTE = 'farmdrive:FarmLedger';
    const b = await runBackup('manual', quiet);
    expect(calls[0][0]).toBe('copyto');
    expect(calls[0][2]).toBe(`farmdrive:FarmLedger/${b.name}.enc`);
    expect(calls[1]).toEqual(['delete', 'farmdrive:FarmLedger', '--min-age', '30d', '--include', 'farmledger-*.db.enc']);
    expect(b.offsite.drive.state).toBe('ok');
  });

  it('a Drive failure is recorded and does not stop the backup', async () => {
    process.env.BACKUP_RCLONE_REMOTE = 'farmdrive:FarmLedger';
    rcloneAnswer = { ok: false, output: 'rclone not found' };
    const b = await runBackup('manual', quiet);
    expect(b.offsite.drive.state).toBe('failed');
    expect(b.offsite.drive.detail).toContain('rclone not found');
    expect(calls).toHaveLength(1);
    expect(readdirSync(usb)).toEqual([`${b.name}.enc`]);
    expect(readOffsiteStatus()).toEqual(b.offsite);
  });

  it('an unplugged USB drive leaves no partial file and does not stop the Drive upload', async () => {
    const blocker = join(root, `not-a-folder-${run}`);
    writeFileSync(blocker, 'x');
    process.env.BACKUP_COPY_DIR = join(blocker, 'usb');
    process.env.BACKUP_RCLONE_REMOTE = 'farmdrive:FarmLedger';
    const b = await runBackup('manual', quiet);
    expect(b.offsite.usb.state).toBe('failed');
    expect(b.offsite.drive.state).toBe('ok');
    expect(readdirSync(root, { recursive: true }).map(String).filter(n => n.endsWith('.part'))).toEqual([]);
  });

  it('leaves no temporary file in the backup folder', async () => {
    await runBackup('manual', quiet);
    expect(tmpLeft()).toEqual([]);
    process.env.BACKUP_RCLONE_REMOTE = 'farmdrive:FarmLedger';
    rcloneAnswer = { ok: false, output: 'boom' };
    await runBackup('manual', quiet);
    expect(tmpLeft()).toEqual([]);
  });

  it('prunes old encrypted copies on the USB folder and never plain files', async () => {
    mkdirSync(usb, { recursive: true });
    const old: string[] = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date();
      d.setDate(d.getDate() - 40 - i);
      old.push(nameFor(d));
      writeFileSync(join(usb, old[i]), 'old');
    }
    const plain = old[0].replace(/\.enc$/, '');
    writeFileSync(join(usb, plain), 'old plain copy');
    const b = await runBackup('manual', quiet);
    expect(readdirSync(usb).sort()).toEqual([...old.slice(0, 6), plain, `${b.name}.enc`].sort());
  });
});

describe('decrypting and restoring encrypted backups', () => {
  /** A fresh backup and its encrypted copy, in this test's own folder. */
  const encryptedBackup = async () => {
    const b = await runBackup('manual', quiet);
    const plain = join(process.env.BACKUP_DIR!, b.name);
    const enc = join(root, `restore-${run}`, `${b.name}.enc`);
    mkdirSync(join(root, `restore-${run}`), { recursive: true });
    await encryptFile(plain, enc, key);
    return { plain, enc, name: b.name };
  };

  it('decrypts to a readable, checked copy next to the file', async () => {
    const { enc } = await encryptedBackup();
    const r = await decryptBackupToFile(enc, key);
    expect(r.file).toBe(enc.replace(/\.enc$/, ''));
    expect(r.file.endsWith('.db')).toBe(true);
    expect(r.check.ok).toBe(true);
  });

  it('will not overwrite an existing file', async () => {
    const { enc } = await encryptedBackup();
    const out = enc.replace(/\.enc$/, '');
    writeFileSync(out, 'already here');
    await expect(decryptBackupToFile(enc, key)).rejects.toThrow(/already exists/i);
    expect(readFileSync(out, 'utf8')).toBe('already here');
  });

  it('restores from an encrypted backup with the label in the audit trail', async () => {
    const { plain, enc, name } = await encryptedBackup();
    const live = join(root, `live-${run}.db`);
    copyFileSync(plain, live);
    const opened = await openEncryptedForRestore(enc, key);
    expect(opened.file.startsWith(process.env.BACKUP_DIR!)).toBe(true);
    await restoreDatabase({ backupFile: opened.file, dbFile: live, safetyDir: join(root, `safety-${run}`), label: `${name}.enc` });
    opened.cleanup();
    expect(existsSync(opened.file)).toBe(false);
    const db = new PrismaClient({ datasources: { db: { url: `file:${live.replace(/\\/g, '/')}` } } });
    try {
      const row = await db.auditLog.findFirst({ where: { action: 'restore' }, orderBy: { createdAt: 'desc' } });
      expect(row?.summary).toContain(`${name}.enc`);
    } finally { await db.$disconnect(); }
  });

  it('a different key is reported as such', async () => {
    const { enc } = await encryptedBackup();
    const e = await openEncryptedForRestore(enc, newPassphrase()).catch(x => x);
    expect(e).toBeInstanceOf(BackupKeyError);
    expect((e as BackupKeyError).kind).toBe('different-key');
    expect(readdirSync(process.env.BACKUP_DIR!).filter(n => n.startsWith('.restore-'))).toEqual([]);
  });
});

describe('the Backup card', () => {
  it('the Backup card data says where encrypted copies go', async () => {
    await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
    process.env.BACKUP_RCLONE_REMOTE = 'farmdrive:FarmLedger';
    const app: FastifyInstance = await buildApp();
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.local', password: 'TestOwner2026' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      await app.inject({ method: 'POST', url: '/api/v1/admin/backups', headers: { cookie } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/backups', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const { offsite } = res.json();
      expect(offsite.keyProblem).toBeNull();
      expect(offsite.usbDir).toBe(usb);
      expect(offsite.driveRemote).toBe('farmdrive:FarmLedger');
      expect(offsite.last.usb.state).toBe('ok');
      expect(offsite.last.drive.state).toBe('ok');
      expect(res.body).not.toContain(key);

      delete process.env.BACKUP_ENCRYPTION_KEY;
      const off = (await app.inject({ method: 'GET', url: '/api/v1/admin/backups', headers: { cookie } })).json().offsite;
      expect(off.keyProblem).toMatch(/no encryption key/i);
    } finally {
      await app.close();
    }
  });
});
