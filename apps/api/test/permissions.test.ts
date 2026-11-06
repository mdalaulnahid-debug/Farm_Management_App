// Permission matrix: for every API route, who may call it and who may not.
// The table below is the written-down rule book. The tests check that (1) the table covers every route the
// server really has, (2) strangers are turned away, and (3) each standard role is blocked exactly where
// the table says it lacks a permission. A new route without a table entry fails the "covers every route" test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';
import { today } from '../src/lib/dates.js';
import { DEFAULT_ROLES, type Permission } from '../src/lib/constants.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** 'public' = no sign-in needed; 'signed-in' = any signed-in user; otherwise alternatives, each a list of permissions that are ALL needed. */
type Rule = 'public' | 'signed-in' | Permission[][];
interface Row { method: Method; pattern: string; url: string; rule: Rule; label: string; payload?: unknown }

const need = (...perms: Permission[]): Permission[][] => [perms];
const row = (method: Method, pattern: string, rule: Rule, extra: { label?: string; payload?: unknown } = {}): Row => ({
  method, pattern, url: pattern.replace(/:\w+/g, 'x'), rule, label: extra.label ?? `${method} ${pattern}`, payload: extra.payload,
});

// Valid-looking bodies for the two routes that check permissions after reading the request.
const receipt = { direction: 'IN', date: today(), cashAccountId: 'x', amount: 1 };
const supplierPayment = { direction: 'OUT', date: today(), cashAccountId: 'x', amount: 1 };
const moneyMove = { direction: 'OUT', date: today(), cashAccountId: 'x', counterAccountId: 'x', amount: 1 };
const stockUsage = { date: today(), itemId: 'x', type: 'USAGE', quantity: 1 };
const stockAdjust = { date: today(), itemId: 'x', type: 'ADJUSTMENT', quantity: 1 };

const ROUTES: Row[] = [
  // Open to everyone
  row('GET', '/health', 'public'),
  row('POST', '/auth/login', 'public'),
  row('POST', '/auth/login/two-step', 'public'),
  row('POST', '/auth/passkey/login/options', 'public'),
  row('POST', '/auth/passkey/login', 'public'),
  row('POST', '/auth/logout', 'public'),
  row('GET', '/auth/brand', 'public'),
  // Any signed-in person, even on a temporary password
  row('GET', '/auth/me', 'signed-in'),
  row('POST', '/auth/change-password', 'signed-in'),
  row('PATCH', '/auth/preferences', 'signed-in'),
  // Any signed-in person who has chosen their own password
  row('GET', '/settings', 'signed-in'),
  row('GET', '/accounts', 'signed-in'),
  row('GET', '/parties', 'signed-in'),
  row('GET', '/parties/:id', 'signed-in'),
  row('GET', '/items', 'signed-in'),
  row('GET', '/sites', 'signed-in'),
  row('GET', '/cash-accounts', 'signed-in'),
  row('GET', '/projects', 'signed-in'),
  // Your own sign-ins (PR #21)
  row('GET', '/auth/sessions', 'signed-in'),
  row('POST', '/auth/sessions/end-others', 'signed-in'),
  row('GET', '/auth/two-step', 'signed-in'),
  row('POST', '/auth/two-step/start', 'signed-in'),
  row('POST', '/auth/two-step/confirm', 'signed-in'),
  row('POST', '/auth/two-step/disable', 'signed-in'),
  row('POST', '/auth/two-step/recovery-codes', 'signed-in'),
  row('GET', '/auth/passkeys', 'signed-in'),
  row('POST', '/auth/passkeys/options', 'signed-in'),
  row('POST', '/auth/passkeys', 'signed-in'),
  row('PATCH', '/auth/passkeys/:id', 'signed-in'),
  row('DELETE', '/auth/passkeys/:id', 'signed-in'),
  row('POST', '/auth/sessions/:id/end', 'signed-in'),
  // Users and roles
  row('GET', '/roles', need('users.manage')),
  row('PUT', '/roles/:id', need('users.manage')),
  row('GET', '/users', need('users.manage')),
  row('POST', '/users', need('users.manage')),
  row('POST', '/users/:id/sign-out', need('users.manage')),
  row('POST', '/users/:id/reset-two-step', need('users.manage')),
  row('PUT', '/admin/two-step-policy', need('users.manage')),
  row('PUT', '/users/:id', need('users.manage')),
  // Organization settings, backups, imports, side projects
  row('PUT', '/settings', need('settings.manage')),
  row('PUT', '/settings/lock-date', need('settings.manage')),
  row('GET', '/admin/backup', need('settings.manage')),
  row('GET', '/admin/backups', need('settings.manage')),
  row('GET', '/admin/security-check', need('users.manage')),
  row('POST', '/admin/backups/:name/check', need('settings.manage')),
  row('POST', '/admin/backups', need('settings.manage')),
  row('GET', '/admin/backups/:name', need('settings.manage')),
  row('GET', '/import/template', need('settings.manage')),
  row('POST', '/import/template/preview', need('settings.manage')),
  row('POST', '/import/template', need('settings.manage')),
  row('POST', '/import/workbook/preview', need('settings.manage')),
  row('POST', '/import/workbook', need('settings.manage')),
  row('GET', '/import/batches', need('settings.manage')),
  row('POST', '/import/batches/:id/undo', need('settings.manage')),
  row('POST', '/projects', need('settings.manage')),
  row('PUT', '/projects/:id', need('settings.manage')),
  // Accounting
  row('POST', '/accounts', need('accounting.manage')),
  row('PUT', '/accounts/:id', need('accounting.manage')),
  row('GET', '/journals', need('accounting.view')),
  row('POST', '/journals', need('accounting.manage')),
  row('POST', '/journals/:id/void', need('accounting.manage')),
  row('GET', '/reports/general-ledger/:accountId', need('accounting.view')),
  // Customers and sales
  row('GET', '/parties/lookup', need('sales.view')),
  row('POST', '/parties', need('parties.manage')),
  row('PUT', '/parties/:id', need('parties.manage')),
  row('GET', '/invoices', need('sales.view')),
  row('GET', '/invoices/:id', need('sales.view')),
  row('POST', '/invoices', need('sales.create')),
  row('POST', '/invoices/:id/void', need('sales.void')),
  row('GET', '/reports/ar-aging', need('sales.view')),
  // Suppliers and purchases
  row('GET', '/bills', need('purchases.view')),
  row('GET', '/bills/:id', need('purchases.view')),
  row('GET', '/vouchers', need('accounting.manage')),
  row('GET', '/vouchers/summary', need('accounting.manage')),
  row('POST', '/vouchers/:id/check', need('accounting.manage')),
  row('POST', '/bills/:id/attachments', need('purchases.view', 'purchases.create')),
  row('GET', '/bills/:id/attachments/:aid', need('purchases.view')),
  row('DELETE', '/bills/:id/attachments/:aid', need('purchases.void')),
  row('POST', '/bills', need('purchases.create')),
  row('POST', '/bills/:id/void', need('purchases.void')),
  row('GET', '/reports/ap-aging', need('purchases.view')),
  // Cash and bank
  row('GET', '/payments', need('banking.view')),
  row('GET', '/payments/:id', need('banking.view')),
  row('POST', '/payments/:id/attachments', [['banking.view', 'sales.create'], ['banking.view', 'purchases.create'], ['banking.view', 'banking.manage']]),
  row('GET', '/payments/:id/attachments/:aid', need('banking.view')),
  row('DELETE', '/payments/:id/attachments/:aid', need('banking.manage')),
  row('POST', '/payments', need('banking.view', 'sales.create'), { label: 'POST /payments (receipt from a customer)', payload: receipt }),
  row('POST', '/payments', need('banking.view', 'purchases.create'), { label: 'POST /payments (payment to a supplier)', payload: supplierPayment }),
  row('POST', '/payments', need('banking.view', 'banking.manage'), { label: 'POST /payments (other money movement)', payload: moneyMove }),
  row('POST', '/payments/:id/void', need('banking.manage')),
  row('POST', '/transfers', need('banking.manage')),
  row('GET', '/cash-counts', need('banking.view')),
  row('POST', '/cash-counts', need('banking.manage')),
  row('GET', '/projects/summary', need('banking.view')),
  row('GET', '/project-transfers', need('banking.view')),
  row('POST', '/project-transfers', need('banking.manage')),
  row('GET', '/grants', need('banking.view')),
  row('POST', '/grants', need('banking.manage')),
  // Inventory
  row('POST', '/items', need('inventory.manage')),
  row('PUT', '/items/:id', need('inventory.manage')),
  row('GET', '/items/:id/moves', need('inventory.view')),
  row('GET', '/stock-moves', need('inventory.view')),
  row('GET', '/reports/inventory', need('inventory.view')),
  // Stock adjustments: inventory managers may record any kind; production staff may only record stock used on the farm.
  row('POST', '/stock-adjustments', need('inventory.manage'), { label: 'POST /stock-adjustments (correction or count)', payload: stockAdjust }),
  row('POST', '/stock-adjustments', [['inventory.manage'], ['production.manage']], { label: 'POST /stock-adjustments (stock used on the farm)', payload: stockUsage }),
  // Production
  row('GET', '/flocks', need('production.view')),
  row('POST', '/flocks', need('production.manage')),
  row('PUT', '/flocks/:id', need('production.manage')),
  row('POST', '/sites', need('production.manage')),
  row('GET', '/production', need('production.view')),
  row('POST', '/production', need('production.manage')),
  row('POST', '/production/:id/void', need('production.manage')),
  // Data-entry staff may also void their OWN entries made the same farm day (same-day-fix.test.ts); with a
  // record that does not exist that exception never applies, so these rows still hold.
  row('POST', '/stock-adjustments/:sourceId/void', need('inventory.manage')),
  row('GET', '/me/today', 'signed-in'),
  row('POST', '/me/today/none', [['production.manage'], ['purchases.create']]),
  row('GET', '/push/key', 'signed-in'),
  row('POST', '/push/subscribe', 'signed-in'),
  row('DELETE', '/push/subscribe', 'signed-in'),
  row('GET', '/settings/reminders', need('settings.manage')),
  row('PUT', '/settings/reminders', need('settings.manage')),
  row('POST', '/settings/reminders/test', need('settings.manage')),
  row('GET', '/reports/production', need('production.view')),
  // Dashboard, reports, audit trail
  row('GET', '/dashboard', need('dashboard.view')),
  row('GET', '/reports/profit-loss', need('reports.view')),
  row('GET', '/reports/balance-sheet', need('reports.view')),
  row('GET', '/reports/trial-balance', need('reports.view')),
  row('GET', '/reports/cash-flow', need('reports.view')),
  row('GET', '/reports/activity', need('audit.view')),
  row('GET', '/reports/books-health', need('audit.view')),
  row('GET', '/audit/integrity', need('audit.view')),
  row('GET', '/audit', need('audit.view')),
];

const holds = (rule: Rule, perms: Permission[]) => rule === 'public' || rule === 'signed-in' || rule.some(alt => alt.every(p => perms.includes(p)));
const describeRule = (rule: Rule) => rule === 'public' ? 'open to everyone' : rule === 'signed-in' ? 'any signed-in user'
  : rule.map(alt => alt.join(' + ')).join(' OR ');

/** Every /api/v1 "METHOD /pattern" Fastify has registered (the automatic HEAD copies of GET routes are ignored). */
function registeredRoutes(app: FastifyInstance) {
  const found = new Set<string>();
  const segs: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = line.match(/^((?:[│ ] {3})*)[├└]── (.+?) \(([A-Z, ]+)\)$/);
    if (!m) continue;
    const depth = m[1].length / 4;
    segs[depth] = m[2];
    const path = segs.slice(0, depth + 1).join('');
    if (!path.startsWith('/api/v1/')) continue;
    for (const method of m[3].split(', ')) if (method !== 'HEAD' && method !== 'OPTIONS') found.add(`${method} ${path.slice('/api/v1'.length)}`);
  }
  return found;
}

let app: FastifyInstance;
let backupDir = '';
const OWNER_PASSWORD = 'TestOwner2026';
const cookies: Record<string, string> = {};
const addresses: Record<string, string> = { anonymous: '10.9.0.1' };
const ROLE_KEYS = ['manager', 'accountant', 'operator', 'viewer'];

// Signing out ends the session it is called with, so the sign-out check is always made without one.
const send = async (r: Row, who: string) => {
  const res = await app.inject({
    method: r.method, url: `/api/v1${r.url}`, payload: r.payload as any,
    headers: cookies[who] && r.pattern !== '/auth/logout' ? { cookie: cookies[who] } : {}, remoteAddress: addresses[who],
  });
  return res.statusCode;
};
const signIn = async (email: string, password: string, remoteAddress: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress });
  expect(res.statusCode).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0];
};

beforeAll(async () => {
  backupDir = mkdtempSync(join(tmpdir(), 'farmledger-perm-'));
  process.env.BACKUP_DIR = backupDir; // a role allowed to "Back up now" must not write into the project folder
  await seed({ history: true, adminEmail: 'owner@test.local', adminPassword: OWNER_PASSWORD });
  await prisma.user.update({ where: { email: 'owner@test.local' }, data: { mustChangePassword: false } });
  app = await buildApp();
  const ownerCookie = await signIn('owner@test.local', OWNER_PASSWORD, '10.9.0.2');

  for (const [i, key] of ROLE_KEYS.entries()) {
    const email = `${key}@perm.test.local`;
    const temporary = `Temp${key}2026`;
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    const created = await app.inject({
      method: 'POST', url: '/api/v1/users', headers: { cookie: ownerCookie }, remoteAddress: '10.9.0.2',
      payload: { name: `Test ${key}`, email, roleId: role.id, password: temporary },
    });
    expect(created.statusCode).toBe(200);
    addresses[key] = `10.9.1.${i + 1}`;
    cookies[key] = await signIn(email, temporary, addresses[key]);
    const changed = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: { cookie: cookies[key] }, remoteAddress: addresses[key],
      payload: { current: temporary, next: `${temporary}New` },
    });
    expect(changed.statusCode).toBe(200);
  }
});
afterAll(async () => {
  await app?.close();
  delete process.env.BACKUP_DIR;
  if (backupDir) rmSync(backupDir, { recursive: true, force: true });
});

describe('the rule book covers every route', () => {
  it('lists each route the server has, so a new route cannot go unchecked', () => {
    const known = new Set(ROUTES.map(r => `${r.method} ${r.pattern}`));
    const missing = [...registeredRoutes(app)].filter(r => !known.has(r));
    expect(missing, `Routes with no entry in the permission table: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no entries for routes that no longer exist', () => {
    const real = registeredRoutes(app);
    const stale = [...new Set(ROUTES.map(r => `${r.method} ${r.pattern}`))].filter(r => !real.has(r));
    expect(stale, `Table entries without a route: ${stale.join(', ')}`).toEqual([]);
  });

  it('finds a sensible number of routes (guards against the route reader silently breaking)', () => {
    expect(registeredRoutes(app).size).toBeGreaterThan(70);
  });
});

describe('a visitor who is not signed in', () => {
  for (const r of ROUTES) {
    if (r.rule === 'public') {
      it(`can reach ${r.label} (open to everyone)`, async () => {
        const status = await send(r, 'anonymous');
        expect([401, 403]).not.toContain(status);
      });
    } else {
      it(`is turned away (401) from ${r.label}`, async () => {
        expect(await send(r, 'anonymous')).toBe(401);
      });
    }
  }
});

for (const key of ROLE_KEYS) {
  const role = DEFAULT_ROLES.find(r => r.key === key)!;
  describe(`a ${role.name} (${key})`, () => {
    for (const r of ROUTES) {
      if (holds(r.rule, role.permissions)) {
        it(`is allowed to use ${r.label} (${describeRule(r.rule)})`, async () => {
          const status = await send(r, key);
          expect([401, 403]).not.toContain(status);
        });
      } else {
        it(`is refused (403) on ${r.label} (needs ${describeRule(r.rule)})`, async () => {
          expect(await send(r, key)).toBe(403);
        });
      }
    }
  });
}
