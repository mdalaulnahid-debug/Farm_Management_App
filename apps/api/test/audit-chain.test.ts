// Tamper-evident audit trail: sealed rows form a hash chain; editing or deleting a row is caught,
// and even a fully recomputed chain is caught by comparing with an earlier backup. Damage is made
// inside rolled-back transactions or on throwaway copies, never left in the test database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { audit } from '../src/services/common.js';
import { rowHash, sealAudit, verifyAuditChain } from '../src/services/audit-chain.js';
import { backupPath, listBackups, runBackup } from '../src/services/backup.js';

const quiet = { info: () => {}, error: () => {} };

let app: FastifyInstance;
let cookie = '';
let dir = '';
const PASSWORD = 'TestOwner2026';

/** Run `damage` and verify in one transaction, then roll it all back. */
async function withDamage(damage: (db: Prisma.TransactionClient) => Promise<unknown>, backupFile?: string) {
  let report: Awaited<ReturnType<typeof verifyAuditChain>> | undefined;
  await prisma.$transaction(async db => {
    await damage(db);
    report = await verifyAuditChain(db, backupFile);
    throw new Error('rollback');
  }, { timeout: 60_000 }).catch(e => { if ((e as Error).message !== 'rollback') throw e; });
  return report!;
}
const middleRow = async (db: Prisma.TransactionClient | typeof prisma) => {
  const n = await db.auditLog.count({ where: { seq: { not: null } } });
  return db.auditLog.findFirstOrThrow({ where: { seq: Math.max(1, Math.floor(n / 2)) } });
};

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.local', password: PASSWORD } });
  cookie = String(res.headers['set-cookie']).split(';')[0];
  dir = mkdtempSync(join(tmpdir(), 'farmledger-chain-'));
  await sealAudit(prisma);
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('sealing', () => {
  it('seals every row into one unbroken chain', async () => {
    const r = await verifyAuditChain(prisma);
    expect(r.ok).toBe(true);
    expect(r.unsealed).toBe(0);
    expect(r.sealed).toBe(await prisma.auditLog.count());
    expect(r.headCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it('new rows are sealed onto the end of the chain', async () => {
    const before = await verifyAuditChain(prisma);
    await audit(prisma, null, 'create', 'test', null, 'Chain test row 1');
    await audit(prisma, null, 'create', 'test', null, 'Chain test row 2');
    expect((await verifyAuditChain(prisma)).unsealed).toBe(2);
    expect(await sealAudit(prisma)).toBe(2);
    const after = await verifyAuditChain(prisma);
    expect(after.ok).toBe(true);
    expect(after.sealed).toBe(before.sealed + 2);
    expect(after.headCode).not.toBe(before.headCode);
  });

  it('two sealing runs at once do not fork the chain', async () => {
    for (let i = 0; i < 5; i++) await audit(prisma, null, 'create', 'test', null, `Parallel ${i}`);
    await Promise.all([sealAudit(prisma), sealAudit(prisma), sealAudit(prisma)]);
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });
});

describe('tampering is caught', () => {
  it('an edited row', async () => {
    const target = await middleRow(prisma);
    const r = await withDamage(db => db.auditLog.update({ where: { id: target.id }, data: { summary: 'Nothing happened here' } }));
    expect(r.ok).toBe(false);
    expect(r.firstBreak).toMatchObject({ seq: target.seq, problem: 'edited' });
  });

  it('a deleted row', async () => {
    const target = await middleRow(prisma);
    const r = await withDamage(db => db.auditLog.delete({ where: { id: target.id } }));
    expect(r.ok).toBe(false);
    expect(r.firstBreak).toMatchObject({ seq: target.seq, problem: 'missing' });
  });

  it('a recomputed chain is caught by comparing with an earlier backup', async () => {
    const backup = join(dir, 'before.db');
    await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    const target = await middleRow(prisma);
    const r = await withDamage(async db => {
      // A careful insider edits a row and recomputes every hash after it.
      await db.auditLog.update({ where: { id: target.id }, data: { summary: 'Rewritten' } });
      const rows = await db.auditLog.findMany({ where: { seq: { gte: target.seq! } }, orderBy: { seq: 'asc' } });
      let prev = (await db.auditLog.findFirst({ where: { seq: target.seq! - 1 } }))?.hash ?? '';
      for (const row of rows) { prev = rowHash(prev, row.seq!, row); await db.auditLog.update({ where: { id: row.id }, data: { hash: prev } }); }
    }, backup);
    expect(r.firstBreak).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.backup).toMatchObject({ firstMismatchSeq: target.seq });
    expect(r.backup!.mismatched).toBeGreaterThan(0);
  });

  it('the newest rows deleted are caught by the backup comparison', async () => {
    const backup = join(dir, 'before-tail.db');
    await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    const r = await withDamage(async db => {
      const last = await db.auditLog.findFirstOrThrow({ orderBy: { seq: 'desc' } });
      await db.auditLog.deleteMany({ where: { seq: { gte: last.seq! - 2 } } });
    }, backup);
    expect(r.ok).toBe(false);
    expect(r.backup!.mismatched).toBe(3);
  });

  it('the rolled-back tampering left the real trail intact', async () => {
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });
});

describe('integrity on the Audit trail screen', () => {
  it('seals and reports for the owner', async () => {
    await audit(prisma, null, 'create', 'test', null, 'Before the integrity check');
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/integrity', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, unsealed: 0 });
  });

  it('after a restore, only backups taken after it are compared (no false alarm)', async () => {
    const backups = join(dir, 'route-backups');
    process.env.BACKUP_DIR = backups;
    try {
      // A backup that knows rows the "restored" database will not have.
      await audit(prisma, null, 'create', 'test', null, 'Will be lost by the restore');
      await runBackup('manual', quiet);
      const lost = await prisma.auditLog.findFirstOrThrow({ where: { summary: 'Will be lost by the restore' } });
      await new Promise(r => setTimeout(r, 1100));
      // Simulate the restore inside a transaction we roll back: the newer rows are gone, a restore row is written.
      let report: any;
      await prisma.$transaction(async tx => {
        await tx.auditLog.deleteMany({ where: { seq: { gte: lost.seq! } } });
        await tx.auditLog.create({ data: { action: 'restore', entity: 'settings', summary: 'Database restored from an older backup' } });
        const restoredAt = new Date();
        const comparable = listBackups().filter(b => new Date(b.createdAt) > restoredAt);
        report = await verifyAuditChain(tx, comparable[0] ? backupPath(comparable[0].name) : null);
        throw new Error('rollback');
      }, { timeout: 60_000 }).catch(e => { if ((e as Error).message !== 'rollback') throw e; });
      expect(report.ok).toBe(true);
      expect(report.backup).toBeNull();
    } finally {
      delete process.env.BACKUP_DIR;
    }
  });

  it('an unreadable newest backup is reported, not silently skipped', async () => {
    const bad = join(dir, 'unreadable.db');
    writeFileSync(bad, 'garbage '.repeat(500));
    const r = await verifyAuditChain(prisma, bad);
    expect(r.backup!.error).toBeTruthy();
  });

  it('needs the audit permission', async () => {
    const operator = await prisma.role.findUniqueOrThrow({ where: { key: 'operator' } });
    await app.inject({ method: 'POST', url: '/api/v1/users', headers: { cookie }, payload: { name: 'Chain Op', email: 'chain-op@test.local', roleId: operator.id, password: 'ChainTemp2026' } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'chain-op@test.local', password: 'ChainTemp2026' } });
    const op = String(login.headers['set-cookie']).split(';')[0];
    await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: { cookie: op }, payload: { current: 'ChainTemp2026', next: 'ChainOwn2026' } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/audit/integrity', headers: { cookie: op } })).statusCode).toBe(403);
  });
});
