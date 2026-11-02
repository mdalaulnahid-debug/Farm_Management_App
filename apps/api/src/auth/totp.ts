// 2-step sign-in codes: the 6-digit codes of an authenticator app (TOTP, RFC 6238, SHA-1, 30 seconds),
// and one-time recovery codes for a lost phone. Works offline; no SMS.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
/** Codes from one step either side are accepted, for a phone clock that is a little off. */
const DRIFT_STEPS = 1;

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = BASE32.indexOf(ch);
    if (i < 0) throw new Error('Not a base32 secret.');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 as authenticator apps expect. */
export const newSecret = () => base32Encode(randomBytes(20));

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The code for one time step (HOTP, RFC 4226). */
export function codeAt(secret: string, step: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const n = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(n % 10 ** digits).padStart(digits, '0');
}

/**
 * The time step a code belongs to, or null if it is wrong. A step at or before `lastUsedStep` is refused,
 * so a code that was already used (or overheard) cannot be used again.
 */
export function verifyCode(secret: string, code: string, lastUsedStep: number | null = null, now = Date.now()) {
  const given = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const current = stepAt(now);
  for (let d = -DRIFT_STEPS; d <= DRIFT_STEPS; d++) {
    const step = current + d;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(given))) return step;
  }
  return null;
}

/** The link an authenticator app reads from the QR code. */
export const otpauthUrl = (issuer: string, account: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

// Recovery codes: no look-alike characters, written as xxxx-xxxx so they can be read off paper.
const RECOVERY_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_COUNT = 10;
const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashRecovery = (code: string) => createHash('sha256').update(normaliseRecovery(code)).digest('hex');

export function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const c = Array.from({ length: 8 }, () => RECOVERY_CHARS[randomInt(RECOVERY_CHARS.length)]).join('');
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

/** If `code` is one of the unused recovery codes, the remaining hashes without it; otherwise null. */
export function useRecoveryCode(storedJson: string | null, code: string) {
  if (normaliseRecovery(code).length !== 8) return null;
  const hashes: string[] = storedJson ? JSON.parse(storedJson) : [];
  const h = hashRecovery(code);
  const i = hashes.indexOf(h);
  return i < 0 ? null : hashes.filter((_, j) => j !== i);
}
