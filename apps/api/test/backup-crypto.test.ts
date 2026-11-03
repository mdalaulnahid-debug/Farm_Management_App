// Backup encryption: a file locked with the farm's key opens only with that key, says clearly why it
// won't open otherwise, and never leaves a half-written file behind.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackupKeyError, decryptFile, encryptFile, isEncryptedFile, keyProblem, newPassphrase } from '../src/services/backup-crypto.js';

let dir = '';
let plain = '';
const key = newPassphrase();
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'farmledger-crypto-'));
  plain = join(dir, 'plain.db');
  writeFileSync(plain, randomBytes(5 * 1024 * 1024));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const kindOf = async (p: Promise<unknown>) => {
  try { await p; return 'no error'; } catch (e) { return e instanceof BackupKeyError ? e.kind : `other: ${(e as Error).message}`; }
};

describe('backup encryption', () => {
  it('round-trips a file', async () => {
    const enc = join(dir, 'rt.db.enc');
    const out = join(dir, 'rt.db');
    await encryptFile(plain, enc, key);
    expect(statSync(enc).size).toBe(statSync(plain).size + 60);
    expect(readFileSync(enc).subarray(0, 8).toString()).toBe('FLBKENC1');
    expect(isEncryptedFile(enc)).toBe(true);
    expect(isEncryptedFile(plain)).toBe(false);
    await decryptFile(enc, out, key);
    expect(readFileSync(out).equals(readFileSync(plain))).toBe(true);
  });

  it('accepts the key typed with other case, spaces or dashes', async () => {
    const enc = join(dir, 'typed.db.enc');
    const out = join(dir, 'typed.db');
    await encryptFile(plain, enc, key);
    await decryptFile(enc, out, key.toUpperCase().replace(/-/g, ' '));
    expect(readFileSync(out).equals(readFileSync(plain))).toBe(true);
  });

  it('says "different key" for a file made with another key', async () => {
    const enc = join(dir, 'other.db.enc');
    const out = join(dir, 'other.db');
    await encryptFile(plain, enc, key);
    expect(await kindOf(decryptFile(enc, out, newPassphrase()))).toBe('different-key');
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.part`)).toBe(false);
  });

  it('says "damaged" when one byte of the ciphertext changed', async () => {
    const enc = join(dir, 'bad.db.enc');
    const out = join(dir, 'bad.db');
    await encryptFile(plain, enc, key);
    const b = readFileSync(enc);
    b[100] ^= 0xff;
    writeFileSync(enc, b);
    expect(await kindOf(decryptFile(enc, out, key))).toBe('damaged');
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.part`)).toBe(false);
  });

  it('says "not encrypted" for a plain backup', async () => {
    expect(await kindOf(decryptFile(plain, join(dir, 'never.db'), key))).toBe('not-encrypted');
  });

  it('makes long readable passphrases', () => {
    const a = newPassphrase();
    expect(a).toMatch(/^([abcdefghjkmnpqrstuvwxyz23456789]{4}-){7}[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
    expect(newPassphrase()).not.toBe(a);
  });

  it('refuses missing and short keys', () => {
    expect(keyProblem(undefined)).not.toBeNull();
    expect(keyProblem('')).not.toBeNull();
    expect(keyProblem('short-key-123')).not.toBeNull();
    expect(keyProblem(newPassphrase())).toBeNull();
    expect(keyProblem('ab-cd-'.repeat(5))).toBeNull();
  });
});
