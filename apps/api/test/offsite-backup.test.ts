// Off-site backups: copies leaving the farm's computer (USB drive, Google Drive) are always encrypted,
// never readable, and a problem with either never stops the local backup.
// rclone is replaced by a recording fake; every folder is a throwaway temp folder.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed } from '../src/seed.js';
import { checkBackup, runBackup } from '../src/services/backup.js';
import { decryptFile, newPassphrase } from '../src/services/backup-crypto.js';
import { readOffsiteStatus, setRcloneRunner } from '../src/services/offsite.js';

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
