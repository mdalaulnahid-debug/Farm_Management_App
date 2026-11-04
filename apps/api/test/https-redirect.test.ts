// Plain-http visits are only ever sent on to https: the redirect server never shows a page or accepts a form.
import { afterAll, describe, expect, it } from 'vitest';
import { buildRedirectApp, httpsTarget } from '../src/lib/https-redirect.js';

describe('https redirect target', () => {
  it('sends a bare name to the same host over https, keeping the path', () => {
    expect(httpsTarget('bdp-agrofarm.tailbc4554.ts.net', '/sales?x=1', '')).toBe('https://bdp-agrofarm.tailbc4554.ts.net/sales?x=1');
  });

  it('drops the plain-http port', () => {
    expect(httpsTarget('farm.example.ts.net:80', '/', '')).toBe('https://farm.example.ts.net/');
  });

  it('prefers the farm address in PASSKEY_ORIGIN, so an old name lands on the new one', () => {
    expect(httpsTarget('farmledger.old.ts.net', '/login', 'https://bdp-agrofarm.tailbc4554.ts.net/')).toBe('https://bdp-agrofarm.tailbc4554.ts.net/login');
  });

  it('ignores a PASSKEY_ORIGIN that is not a plain https address', () => {
    expect(httpsTarget('farm.ts.net', '/', 'http://farm.ts.net')).toBe('https://farm.ts.net/');
  });

  it('refuses a missing or odd Host instead of redirecting somewhere strange', () => {
    expect(httpsTarget(undefined, '/', '')).toBeNull();
    expect(httpsTarget('evil.com/x', '/', '')).toBeNull();
    expect(httpsTarget('a b', '/', '')).toBeNull();
  });
});

describe('redirect server', () => {
  const app = buildRedirectApp();
  afterAll(() => app.close());

  it('answers every method with a 308 to https and nothing else', async () => {
    const saved = process.env.PASSKEY_ORIGIN;
    delete process.env.PASSKEY_ORIGIN;
    try {
      for (const method of ['GET', 'POST'] as const) {
        const res = await app.inject({ method, url: '/api/v1/auth/login', headers: { host: 'farm.ts.net' }, payload: method === 'POST' ? { password: 'x' } : undefined });
        expect(res.statusCode).toBe(308);
        expect(res.headers.location).toBe('https://farm.ts.net/api/v1/auth/login');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).not.toContain('<html');
      }
    } finally {
      if (saved !== undefined) process.env.PASSKEY_ORIGIN = saved;
    }
  });

  it('says to use https when the Host is unusable', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'bad host' } });
    expect(res.statusCode).toBe(400);
  });
});
