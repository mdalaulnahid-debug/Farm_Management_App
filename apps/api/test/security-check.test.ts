// Security settings check: each unsafe setting is reported with a fix, safe ones pass, and only the
// owner (users.manage) can see the report. Settings are passed in, so nothing here changes process.env
// except the backup folder, which points at a temp folder.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth/auth.js';
import { runBackup } from '../src/services/backup.js';
import { newPassphrase } from '../src/services/backup-crypto.js';
import { EXAMPLE_ADMIN_PASSWORD, isTailscaleAddress, securityCheck } from '../src/services/security-check.js';

let app: FastifyInstance;
let dir = '';
const PASSWORD = 'TestOwner2026';
const quiet = { info: () => {}, error: () => {} };
const level = async (key: string, env: Record<string, string | undefined>) =>
  (await securityCheck(prisma, env)).checks.find(c => c.key === key)?.level;

/** A user of its own, so other test files' accounts never decide the result. */
const userWithPassword = async (email: string, password: string, roleKey = 'viewer') => {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  return prisma.user.create({ data: { name: 'Security check user', email, roleId: role.id, passwordHash: await hashPassword(password) } });
};

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  dir = mkdtempSync(join(tmpdir(), 'farmledger-security-'));
  process.env.BACKUP_DIR = join(dir, 'backups');
  app = await buildApp();
});
afterAll(async () => {
  await prisma.user.updateMany({ where: { email: { endsWith: '@security-check.test.local' } }, data: { active: false } });
  await app?.close();
  delete process.env.BACKUP_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('network settings', () => {
  it('no HTTPS proxy and listening everywhere: two warnings, no failure', async () => {
    expect(await level('https', {})).toBe('warn');
    expect(await level('listen_address', {})).toBe('warn');
    expect(await level('listen_address', { HOST: '0.0.0.0' })).toBe('warn');
  });

  it('an HTTPS proxy in front while port 4000 is open to the office network is a problem', async () => {
    expect(await level('https', { TRUST_PROXY: '127.0.0.1' })).toBe('ok');
    expect(await level('listen_address', { TRUST_PROXY: '127.0.0.1', HOST: '0.0.0.0' })).toBe('fail');
  });

  it('the recommended VM settings pass', async () => {
    const env = { TRUST_PROXY: '127.0.0.1', HOST: '127.0.0.1', NODE_ENV: 'production' };
    for (const key of ['https', 'listen_address', 'cookie']) expect(await level(key, env)).toBe('ok');
  });

  it('listening only on the Tailscale address passes', async () => {
    expect(await level('listen_address', { HOST: '100.101.102.103' })).toBe('ok');
    expect(isTailscaleAddress('100.64.0.1')).toBe(true);
    expect(isTailscaleAddress('100.127.255.254')).toBe(true);
    expect(isTailscaleAddress('100.128.0.1')).toBe(false);
    expect(isTailscaleAddress('192.168.1.10')).toBe(false);
  });

  it('NODE_ENV=production over plain HTTP would lock everyone out, so it is a problem', async () => {
    expect(await level('cookie', { NODE_ENV: 'production' })).toBe('fail');
    expect(await level('cookie', { NODE_ENV: 'development' })).toBe('ok');
  });
});

describe('passwords and owner accounts', () => {
  it('anyone still using the example starting password is named', async () => {
    const u = await userWithPassword('starter@security-check.test.local', EXAMPLE_ADMIN_PASSWORD);
    const r = await securityCheck(prisma, {});
    const c = r.checks.find(x => x.key === 'default_password')!;
    expect(c.level).toBe('fail');
    expect(c.title.en).toContain('starter@security-check.test.local');
    expect(r.ok).toBe(false);
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword('AFreshChoice2026') } });
    expect(await level('default_password', {})).toBe('ok');
  });

  it('the ADMIN_PASSWORD from .env counts as a starting password, and keeping it in .env is a warning', async () => {
    await userWithPassword('envpass@security-check.test.local', 'FromTheEnvFile2026');
    expect(await level('default_password', { ADMIN_PASSWORD: 'FromTheEnvFile2026' })).toBe('fail');
    expect(await level('admin_password_in_env', { ADMIN_PASSWORD: 'FromTheEnvFile2026' })).toBe('warn');
    expect(await level('admin_password_in_env', {})).toBe('ok');
    await prisma.user.update({ where: { email: 'envpass@security-check.test.local' }, data: { active: false } });
  });

  it('a single owner is a warning; a spare owner clears it', async () => {
    // Other test files may leave owners on a temporary password, which is a warning of its own; set them aside.
    await prisma.user.updateMany({ where: { active: true, mustChangePassword: true, role: { key: 'owner' } }, data: { active: false } });
    const owners = () => prisma.user.count({ where: { active: true, mustChangePassword: false, role: { key: 'owner' } } });
    if ((await owners()) < 2) {
      expect(await level('owners', {})).toBe('warn');
      await userWithPassword('spare-owner@security-check.test.local', 'SpareOwner2026', 'owner');
    }
    expect(await level('owners', {})).toBe('ok');
  });

  it('an owner on a temporary password is a warning', async () => {
    const u = await userWithPassword('temp-owner@security-check.test.local', 'TempOwner2026', 'owner');
    await prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });
    const c = (await securityCheck(prisma, {})).checks.find(x => x.key === 'owners')!;
    expect(c.level).toBe('warn');
    expect(c.title.en).toContain('temp-owner@security-check.test.local');
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
  });

  it('sign-ins longer than 12 hours are a warning', async () => {
    expect(await level('session_hours', { SESSION_HOURS: '72' })).toBe('warn');
    expect(await level('session_hours', { SESSION_HOURS: '8' })).toBe('ok');
    expect(await level('session_hours', {})).toBe('ok');
  });
});

describe('backups', () => {
  it('no backup yet, and none off this computer: warnings', async () => {
    expect(await level('backup_recent', {})).toBe('warn');
    expect(await level('backup_copy', {})).toBe('warn');
  });

  it('a second backup folder that is missing is a problem; one that exists passes', async () => {
    expect(await level('backup_copy', { BACKUP_COPY_DIR: join(dir, 'unplugged-usb') })).toBe('fail');
    expect(await level('backup_copy', { BACKUP_COPY_DIR: dir })).toBe('ok');
  });

  it('a copy folder without a key is a problem', async () => {
    expect(await level('backup_encryption', { BACKUP_COPY_DIR: dir })).toBe('fail');
    expect(await level('backup_encryption', { BACKUP_COPY_DIR: dir, BACKUP_ENCRYPTION_KEY: 'short' })).toBe('fail');
    expect(await level('backup_encryption', { BACKUP_RCLONE_REMOTE: 'x:y' })).toBe('fail');
    expect(await level('backup_encryption', { BACKUP_COPY_DIR: dir, BACKUP_ENCRYPTION_KEY: newPassphrase() })).toBe('ok');
    expect(await level('backup_encryption', {})).toBeUndefined();
  });

  it('a failed Drive upload is a warning', async () => {
    const k = newPassphrase();
    const status = (state: string) => {
      mkdirSync(process.env.BACKUP_DIR!, { recursive: true });
      writeFileSync(join(process.env.BACKUP_DIR!, '.offsite-status.json'), JSON.stringify({
        at: new Date().toISOString(), name: 'farmledger-2026-11-03-0900.db', usb: { state: 'off' }, drive: { state, detail: 'Google Drive upload failed: rclone not found' },
      }));
    };
    status('failed');
    const report = await securityCheck(prisma, { BACKUP_RCLONE_REMOTE: 'x:y', BACKUP_ENCRYPTION_KEY: k });
    const drive = report.checks.find(c => c.key === 'backup_drive');
    expect(drive?.level).toBe('warn');
    expect(drive?.title.en).toContain('rclone not found');
    status('ok');
    expect(await level('backup_drive', { BACKUP_RCLONE_REMOTE: 'x:y', BACKUP_ENCRYPTION_KEY: k })).toBe('ok');
    expect(await level('backup_drive', {})).toBeUndefined();
    rmSync(join(process.env.BACKUP_DIR!, '.offsite-status.json'));
  });

  it('Google Drive alone counts as a copy off this computer', async () => {
    expect(await level('backup_copy', { BACKUP_RCLONE_REMOTE: 'x:y' })).not.toBe('warn');
  });

  it('a fresh backup passes', async () => {
    await runBackup('manual', quiet);
    expect(await level('backup_recent', {})).toBe('ok');
  });

  it('the audit trail is reported intact', async () => {
    expect(await level('audit_chain', {})).toBe('ok');
  });
});

describe('who can see the report', () => {
  const signIn = async (email: string, password: string, remoteAddress: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress });
    expect(res.statusCode).toBe(200);
    return String(res.headers['set-cookie']).split(';')[0];
  };

  it('the owner sees every check, with English and Bangla text', async () => {
    const cookie = await signIn('owner@test.local', PASSWORD, '10.7.0.1');
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/security-check', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checks.map((c: any) => c.key)).toEqual(expect.arrayContaining(['https', 'listen_address', 'cookie', 'default_password', 'owners', 'backup_copy', 'audit_chain']));
    for (const c of body.checks) expect(c.title.bn).toBeTruthy();
  });

  it('an accountant cannot (it names accounts on weak passwords)', async () => {
    await userWithPassword('accountant@security-check.test.local', 'Accountant2026', 'accountant');
    const cookie = await signIn('accountant@security-check.test.local', 'Accountant2026', '10.7.0.2');
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/security-check', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
