// Passkeys: which address a passkey belongs to, one-use challenges, device names, and (below) the routes, driven
// by a software authenticator so the fingerprint/face/PIN step is simulated without real hardware.
import { afterEach, describe, expect, it } from 'vitest';
import { deviceName, issueChallenge, relyingParty, takeChallenge } from '../src/auth/passkeys.js';

const req = (protocol: string, host: string) => ({ protocol, host, hostname: host.replace(/:\d+$/, '') });

describe('passkey basics', () => {
  afterEach(() => { delete process.env.PASSKEY_ORIGIN; });

  it('belongs to the https address the browser used', () => {
    expect(relyingParty(req('https', 'farm.example.ts.net'))).toEqual({ rpID: 'farm.example.ts.net', origin: 'https://farm.example.ts.net' });
    expect(relyingParty(req('http', 'localhost:5173'))).toEqual({ rpID: 'localhost', origin: 'http://localhost:5173' });
    expect(relyingParty(req('http', '192.0.2.10:4000'))).toBeNull();
  });

  it('PASSKEY_ORIGIN overrides what the request says', () => {
    process.env.PASSKEY_ORIGIN = 'https://farm.example.ts.net';
    expect(relyingParty(req('http', '127.0.0.1:4000'))).toEqual({ rpID: 'farm.example.ts.net', origin: 'https://farm.example.ts.net' });
  });

  it('a challenge can be taken once, by the right step only', () => {
    const id = issueChallenge('login', 'abc', null);
    expect(takeChallenge(id, 'register')).toBeNull();
    const id2 = issueChallenge('login', 'def', 'u1');
    expect(takeChallenge(id2, 'login')).toEqual({ challenge: 'def', userId: 'u1' });
    expect(takeChallenge(id2, 'login')).toBeNull();
  });

  it('guesses a readable device name', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36')).toBe('Android phone · Chrome');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0')).toBe('Windows PC · Edge');
    expect(deviceName(undefined)).toBe('This device');
  });
});
