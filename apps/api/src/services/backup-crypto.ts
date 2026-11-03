// Encrypting backup copies that leave the farm's computer (USB drive, Google Drive).
// Node's own crypto only: AES-256-GCM with a key derived from the farm's passphrase by scrypt.
// The file layout is documented in docs/BACKUP-ENCRYPTION.md so any developer can decrypt without FarmLedger:
//   0–7 "FLBKENC1" · 8–23 scrypt salt · 24–31 key fingerprint · 32–43 IV · ciphertext · last 16 GCM tag
import { closeSync, createReadStream, createWriteStream, existsSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export const ENC_SUFFIX = '.enc';
const MAGIC = Buffer.from('FLBKENC1');
const HEADER = 44;
const TAG = 16;
const SCRYPT: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const FINGERPRINT_SALT = 'FarmLedger backup key fingerprint v1';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const MIN_KEY = 20;

export class BackupKeyError extends Error {
  constructor(public kind: 'not-encrypted' | 'different-key' | 'wrong-key' | 'damaged', message: string) {
    super(message);
  }
}

/** The key material: lower case, letters and digits only, so the key works however it is typed from paper. */
export const normaliseKey = (passphrase: string) => passphrase.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Null when the passphrase can be used; otherwise the reason it can't. */
export function keyProblem(passphrase?: string | null): string | null {
  if (!passphrase || !normaliseKey(passphrase)) return 'No encryption key is set.';
  if (normaliseKey(passphrase).length < MIN_KEY) return `The encryption key is too short (at least ${MIN_KEY} letters and digits).`;
  return null;
}

/** A strong passphrase to print and seal: 8 groups of 4, no look-alike characters. */
export const newPassphrase = () =>
  Array.from({ length: 8 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-');

const derive = (passphrase: string, salt: Buffer | string, length: number) =>
  new Promise<Buffer>((ok, fail) => scryptCb(normaliseKey(passphrase), salt, length, SCRYPT, (e, k) => (e ? fail(e) : ok(k))));

const fingerprintBytes = (passphrase: string) => derive(passphrase, FINGERPRINT_SALT, 8);

/** A short, safe-to-show fingerprint of the key (16 hex characters); it does not reveal the key. */
export const keyFingerprint = async (passphrase: string) => (await fingerprintBytes(passphrase)).toString('hex');

function readBytes(file: string, start: number, length: number) {
  const fd = openSync(file, 'r');
  try {
    const b = Buffer.alloc(length);
    const n = readSync(fd, b, 0, length, start);
    return b.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/** Does the file start with the encrypted-backup tag? */
export function isEncryptedFile(file: string) {
  try {
    return readBytes(file, 0, MAGIC.length).equals(MAGIC);
  } catch {
    return false;
  }
}

/** Encrypt `src` into `dest`, streamed. A failed run leaves no `dest`. */
export async function encryptFile(src: string, dest: string, passphrase: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const [key, fp] = await Promise.all([derive(passphrase, salt, 32), fingerprintBytes(passphrase)]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(dest);
  try {
    out.write(Buffer.concat([MAGIC, salt, fp, iv]));
    await pipeline(createReadStream(src), cipher, out, { end: false });
    await new Promise<void>((ok, fail) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? fail(e) : ok())));
  } catch (e) {
    out.destroy();
    rmSync(dest, { force: true });
    throw e;
  }
}

/**
 * Decrypt `src` into `dest`. The key fingerprint is checked before anything is decrypted, so a file made
 * with another key is reported as such. Nothing is left at `dest` unless the whole file decrypted and its
 * tag matched.
 */
export async function decryptFile(src: string, dest: string, passphrase: string) {
  const size = existsSync(src) ? statSync(src).size : 0;
  const head = size >= HEADER ? readBytes(src, 0, HEADER) : Buffer.alloc(0);
  if (head.length < HEADER || !head.subarray(0, 8).equals(MAGIC)) {
    throw new BackupKeyError('not-encrypted', 'This file is not an encrypted FarmLedger backup.');
  }
  if (size < HEADER + TAG) throw new BackupKeyError('damaged', 'The encrypted backup is damaged (it is cut short).');
  const salt = head.subarray(8, 24);
  const fp = head.subarray(24, 32);
  const iv = head.subarray(32, 44);
  if (!timingSafeEqual(fp, await fingerprintBytes(passphrase))) {
    throw new BackupKeyError('different-key', 'This backup was made with a different key than the one given.');
  }
  const decipher = createDecipheriv('aes-256-gcm', await derive(passphrase, salt, 32), iv);
  decipher.setAuthTag(readBytes(src, size - TAG, TAG));
  const part = `${dest}.part`;
  try {
    await pipeline(size - TAG > HEADER ? createReadStream(src, { start: HEADER, end: size - TAG - 1 }) : [], decipher, createWriteStream(part));
  } catch (e) {
    rmSync(part, { force: true });
    if (/unable to authenticate|auth/i.test((e as Error).message)) {
      throw new BackupKeyError('damaged', 'The encrypted backup is damaged: it has been changed or cut short since it was made.');
    }
    throw e;
  }
  renameSync(part, dest);
}
