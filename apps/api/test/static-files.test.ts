// The built web app as the server sends it: ready-compressed copies to browsers that accept them, plain files to
// those that do not, and "Vary: Accept-Encoding" so a cache between them never hands one the other's copy.
// Runs only when the web app has been built (apps/web/dist), as on the VM and in CI after the build step.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';

const dist = resolve(__dirname, '../../web/dist');
const built = existsSync(resolve(dist, 'index.html'));
const asset = built ? readdirSync(resolve(dist, 'assets')).find(f => f.endsWith('.js') && existsSync(resolve(dist, 'assets', `${f}.br`))) : undefined;
let app: FastifyInstance;

beforeAll(async () => { if (built) app = await buildApp(); });
afterAll(async () => { await app?.close(); });

describe.skipIf(!built || !asset)('static files', () => {
  it('sends the brotli copy to browsers that accept it, with Vary', async () => {
    const res = await app.inject({ method: 'GET', url: `/assets/${asset}`, headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(String(res.headers.vary)).toMatch(/Accept-Encoding/i);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('sends the plain file to browsers that do not, still with Vary', async () => {
    const res = await app.inject({ method: 'GET', url: `/assets/${asset}`, headers: { 'accept-encoding': 'identity' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(String(res.headers.vary)).toMatch(/Accept-Encoding/i);
  });
});
