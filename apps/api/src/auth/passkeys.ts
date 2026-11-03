// Passkeys (fingerprint, face, Windows Hello, device PIN): which web address a passkey belongs to, one-use
// challenges kept in memory, and a readable device name. The cryptography is done by @simplewebauthn/server.
import { randomBytes } from 'node:crypto';

const CHALLENGE_MS = 5 * 60_000;

/**
 * The relying party a passkey is tied to: its ID (the host name) and the exact origin the browser must report.
 * PASSKEY_ORIGIN pins it (needed behind a proxy such as tailscale serve, where the server sees another host).
 * Otherwise it comes from the request: https on any host, or http only on localhost, as browsers allow.
 * Null means passkeys cannot work on this address.
 */
export function relyingParty(req: { protocol: string; host: string; hostname: string }): { rpID: string; origin: string } | null {
  const pinned = process.env.PASSKEY_ORIGIN?.trim();
  if (pinned) {
    try {
      const u = new URL(pinned);
      return { rpID: u.hostname, origin: u.origin };
    } catch {
      return null;
    }
  }
  const hostname = req.hostname.replace(/^\[|\]$/g, '');
  if (req.protocol === 'https' || (req.protocol === 'http' && hostname === 'localhost')) {
    return { rpID: hostname, origin: `${req.protocol}://${req.host}` };
  }
  return null;
}

type Kind = 'register' | 'login';
const challenges = new Map<string, { kind: Kind; challenge: string; userId: string | null; expires: number }>();

/** Keep a challenge for one later step. Returns its id; expired ones are swept here. */
export function issueChallenge(kind: Kind, challenge: string, userId: string | null): string {
  const now = Date.now();
  for (const [id, c] of challenges) if (c.expires <= now) challenges.delete(id);
  const id = randomBytes(18).toString('base64url');
  challenges.set(id, { kind, challenge, userId, expires: now + CHALLENGE_MS });
  return id;
}

/** Take a challenge once. Synchronous, so two requests racing with the same answer cannot both get it. */
export function takeChallenge(id: string, kind: Kind): { challenge: string; userId: string | null } | null {
  const c = challenges.get(id);
  if (!c || c.kind !== kind) return null;
  challenges.delete(id);
  if (c.expires <= Date.now()) return null;
  return { challenge: c.challenge, userId: c.userId };
}

/** A name for a new passkey, guessed from the browser, e.g. "Windows PC · Edge". */
export function deviceName(userAgent?: string): string {
  const ua = userAgent ?? '';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone'
    : /Windows/.test(ua) ? 'Windows PC' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : 'This device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : '';
  return (browser ? `${device} · ${browser}` : device).slice(0, 60);
}
