// Backup restore drill: every backup can be checked (opens, not damaged, books balance), and a
// restore replaces the database only with a good backup, keeping a copy of what it replaced.
// All restores here run on throwaway files in a temp folder, never on the test database in use.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { checkBackup, restoreDatabase, runBackup } from '../src/services/backup.js';

let app: FastifyInstance;
let ownerCookie = '';
let dir = '';
let good = '';
const PASSWORD = 'TestOwner2026';
const quiet = { info: () => {}, error: () => {} };
const open = (file: string) => new PrismaClient({ datasources: { db: { url: `file:${file.replace(/\\/g, '/')}` } } });
const hasMarker = async (file: string) => {
  const db = open(file);
  try { return (await db.auditLog.count({ where: { summary: 'MARKER: made after the backup' } })) > 0; } finally { await db.$disconnect(); }
};

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  dir = mkdtempSync(join(tmpdir(), 'farmledger-restore-'));
  process.env.BACKUP_DIR = join(dir, 'backups');
  app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.local', password: PASSWORD } });
  ownerCookie = String(res.headers['set-cookie']).split(';')[0];
  good = join(process.env.BACKUP_DIR, (await runBackup('manual', quiet)).name);
});
afterAll(async () => {
  await app?.close();
  delete process.env.BACKUP_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('checking a backup', () => {
  it('a fresh backup opens, is undamaged, has the farm’s data and balanced books', async () => {
    const c = await checkBackup(good);
    expect(c.problems).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.balanced).toBe(true);
    expect(c.counts.users).toBeGreaterThan(0);
    expect(c.counts.journalEntries).toBe(await prisma.journalEntry.count());
    expect(c.newestRecordAt).toBeTruthy();
  });

  it('every new backup is checked as it is taken', async () => {
    const b = await runBackup('manual', quiet);
    expect(b.check.ok).toBe(true);
  });

  it('a damaged file fails the check', async () => {
    const bad = join(dir, 'damaged.db');
    writeFileSync(bad, 'this is not a database at all, just some text'.repeat(200));
    const c = await checkBackup(bad);
    expect(c.ok).toBe(false);
    expect(c.problems.length).toBeGreaterThan(0);
  });

  it('a missing file fails the check and is not created', async () => {
    const missing = join(dir, 'missing.db');
    expect((await checkBackup(missing)).ok).toBe(false);
    expect(existsSync(missing)).toBe(false);
  });
});

describe('restoring', () => {
  /** A stand-in for the farm's live database: the good backup plus one record made "after" it. */
  const liveWithLaterWork = async (name: string) => {
    const live = join(dir, name);
    copyFileSync(good, live);
    const db = open(live);
    try { await db.auditLog.create({ data: { action: 'create', entity: 'test', summary: 'MARKER: made after the backup' } }); } finally { await db.$disconnect(); }
    return live;
  };

  it('puts the backup back and keeps a copy of the database it replaced', async () => {
    const live = await liveWithLaterWork('live-a.db');
    const safety = join(dir, 'safety-a');
    const r = await restoreDatabase({ backupFile: good, dbFile: live, safetyDir: safety });

    expect(await hasMarker(live)).toBe(false);
    expect(r.safetyCopy && existsSync(r.safetyCopy)).toBe(true);
    expect(await hasMarker(r.safetyCopy!)).toBe(true);
    expect((await checkBackup(live)).ok).toBe(true);
    const db = open(live);
    try {
      expect(await db.auditLog.findFirst({ where: { action: 'restore', summary: { contains: 'restored from' } } })).not.toBeNull();
    } finally { await db.$disconnect(); }
  });

  it('refuses a damaged backup and leaves the database alone', async () => {
    const live = await liveWithLaterWork('live-b.db');
    const bad = join(dir, 'damaged-b.db');
    writeFileSync(bad, 'garbage'.repeat(500));
    const safety = join(dir, 'safety-b');
    await expect(restoreDatabase({ backupFile: bad, dbFile: live, safetyDir: safety })).rejects.toThrow(/not restored/i);
    expect(await hasMarker(live)).toBe(true);
    expect(existsSync(safety) ? readdirSync(safety) : []).toEqual([]);
  });
});

describe('restore drill from the Backup card', () => {
  const check = (name: string, cookie = ownerCookie) => app.inject({ method: 'POST', url: `/api/v1/admin/backups/${name}/check`, headers: { cookie } });

  it('checks a backup by name and records the drill', async () => {
    const name = good.split(/[\\/]/).pop()!;
    const res = await check(name);
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { action: 'backup', summary: { contains: `Checked backup ${name}: OK` } } })).not.toBeNull();
  });

  it('refuses names that are not backups', async () => {
    expect((await check('..%2F..%2Ffarmledger.db')).statusCode).toBe(400);
    expect((await check('farmledger-1999-01-01-0000.db')).statusCode).toBe(404);
  });

  it('is for the owner only', async () => {
    const viewer = await prisma.role.findUniqueOrThrow({ where: { key: 'viewer' } });
    await app.inject({ method: 'POST', url: '/api/v1/users', headers: { cookie: ownerCookie }, payload: { name: 'Drill Viewer', email: 'drill-viewer@test.local', roleId: viewer.id, password: 'ViewerTemp2026' } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'drill-viewer@test.local', password: 'ViewerTemp2026' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: { cookie }, payload: { current: 'ViewerTemp2026', next: 'ViewerOwn2026' } });
    expect((await check(good.split(/[\\/]/).pop()!, cookie)).statusCode).toBe(403);
  });
});
