// db:reset guard: wiping a database that holds records needs the exact phrase "DELETE <file name>",
// and a copy of the database is always kept first. Only throwaway files in a temp folder are reset here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { assessReset, resetDatabase } from '../src/tools/reset-database.js';

let dir = '';
const open = (file: string) => new PrismaClient({ datasources: { db: { url: `file:${file.replace(/\\/g, '/')}` } } });
const users = async (file: string) => { const db = open(file); try { return await db.user.count(); } finally { await db.$disconnect(); } };

/** A copy of the test database (seeded, with records) standing in for a farm's real database. */
const farmCopy = async (name: string) => {
  const file = join(dir, name);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
};

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: 'TestOwner2026' });
  dir = mkdtempSync(join(tmpdir(), 'farmledger-reset-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('looking before wiping', () => {
  it('sees the records in a database and asks for its exact name', async () => {
    const file = await farmCopy('farm-a.db');
    const a = await assessReset(file);
    expect(a.hasData).toBe(true);
    expect(a.counts!.users).toBeGreaterThan(0);
    expect(a.phrase).toBe('DELETE farm-a.db');
  });

  it('a database that does not exist yet has nothing to lose', async () => {
    const a = await assessReset(join(dir, 'new.db'));
    expect(a.hasData).toBe(false);
    expect(existsSync(join(dir, 'new.db'))).toBe(false);
  });
});

describe('resetting', () => {
  it('refuses without the exact phrase and changes nothing', async () => {
    const file = await farmCopy('farm-b.db');
    const before = await users(file);
    for (const confirm of [undefined, '', 'yes', 'DELETE', 'delete farm-b.db', 'DELETE farmledger.db']) {
      await expect(resetDatabase({ file, confirm, safetyDir: join(dir, 'safety-b'), seed: false })).rejects.toThrow(/not reset/i);
    }
    expect(await users(file)).toBe(before);
    expect(existsSync(join(dir, 'safety-b'))).toBe(false);
  });

  it('with the phrase, keeps a copy first and then starts empty', async () => {
    const file = await farmCopy('farm-c.db');
    const before = await users(file);
    const r = await resetDatabase({ file, confirm: 'DELETE farm-c.db', safetyDir: join(dir, 'safety-c'), seed: false });
    expect(r.safetyCopy).toMatch(/farmledger-before-reset-.*\.db$/);
    expect(await users(r.safetyCopy!)).toBe(before);
    expect(await users(file)).toBe(0);
    expect(readdirSync(join(dir, 'safety-c'))).toHaveLength(1);
  }, 60_000);
});
