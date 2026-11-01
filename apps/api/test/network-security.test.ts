// Network hardening (P1-4): who the server believes the client is, when the session cookie is
// marked Secure, and the Content-Security-Policy sent with every response.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, trustProxySetting } from '../src/server.js';
import { seed } from '../src/seed.js';

const PASSWORD = 'TestOwner2026';
const login = (app: FastifyInstance, headers: Record<string, string> = {}, password = PASSWORD, remoteAddress?: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.local', password }, headers, ...(remoteAddress ? { remoteAddress } : {}) });
const wrongLogin = (app: FastifyInstance, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'nobody@test.local', password: 'wrong-password-1' }, headers });

let app: FastifyInstance | undefined;
const start = async (trustProxy?: string) => {
  if (trustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = trustProxy;
  app = await buildApp();
  return app;
};

beforeAll(async () => {
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: PASSWORD });
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env.TRUST_PROXY;
});

describe('TRUST_PROXY setting', () => {
  it('trusts no proxy unless one is configured', () => {
    expect(trustProxySetting(undefined)).toBe(false);
    expect(trustProxySetting('')).toBe(false);
    expect(trustProxySetting('false')).toBe(false);
  });
  it('accepts proxy addresses', () => {
    expect(trustProxySetting('127.0.0.1')).toBe('127.0.0.1');
    expect(trustProxySetting(' 127.0.0.1, ::1 ')).toBe('127.0.0.1,::1');
  });
  it('refuses "true", which would let any client fake its address', () => {
    expect(() => trustProxySetting('true')).toThrow(/TRUST_PROXY/);
  });
});

describe('login rate limit cannot be dodged with a fake address', () => {
  it('ignores X-Forwarded-For when no proxy is configured', async () => {
    const a = await start();
    const codes: number[] = [];
    for (let i = 1; i <= 12; i++) codes.push((await wrongLogin(a, { 'x-forwarded-for': `10.9.9.${i}` })).statusCode);
    expect(codes.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
  it('uses X-Forwarded-For only from the configured proxy', async () => {
    // inject() connects from 127.0.0.1, so here the request comes "through" the proxy.
    const a = await start('127.0.0.1');
    for (let i = 1; i <= 11; i++) expect((await wrongLogin(a, { 'x-forwarded-for': `10.9.9.${i}` })).statusCode).toBe(401);
    // A different real client behind the proxy is limited on its own address.
    for (let i = 1; i <= 10; i++) await wrongLogin(a, { 'x-forwarded-for': '10.1.1.1' });
    expect((await wrongLogin(a, { 'x-forwarded-for': '10.1.1.1' })).statusCode).toBe(429);
  });
});

describe('session cookie Secure flag', () => {
  const cookieOf = (res: Awaited<ReturnType<typeof login>>) => String(res.headers['set-cookie']);

  it('is not Secure on plain HTTP (office network), so sign-in still works there', async () => {
    const a = await start();
    const res = await login(a);
    expect(res.statusCode).toBe(200);
    expect(cookieOf(res)).toMatch(/HttpOnly/i);
    expect(cookieOf(res)).not.toMatch(/Secure/i);
  });
  it('is Secure when the configured proxy says the browser used HTTPS', async () => {
    const a = await start('127.0.0.1');
    const res = await login(a, { 'x-forwarded-proto': 'https' });
    expect(res.statusCode).toBe(200);
    expect(cookieOf(res)).toMatch(/Secure/i);
  });
  it('ignores X-Forwarded-Proto from a client that is not the proxy', async () => {
    const a = await start('127.0.0.1');
    const res = await login(a, { 'x-forwarded-proto': 'https' }, PASSWORD, '192.168.1.50');
    expect(res.statusCode).toBe(200);
    expect(cookieOf(res)).not.toMatch(/Secure/i);
  });
});

describe('Content-Security-Policy', () => {
  it('is sent and only allows the app’s own scripts', async () => {
    const a = await start();
    const csp = String((await a.inject({ method: 'GET', url: '/api/v1/health' })).headers['content-security-policy'] ?? '');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });
  it('does not force HTTPS, which would break the plain-HTTP office address', async () => {
    const a = await start();
    const csp = String((await a.inject({ method: 'GET', url: '/api/v1/health' })).headers['content-security-policy'] ?? '');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});
