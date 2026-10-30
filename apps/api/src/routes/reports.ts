import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit } from '../services/common.js';

import { badRequest } from '../lib/errors.js';
import { parse, zDate } from '../lib/validate.js';
import { endOf, today } from '../lib/dates.js';
import { actorOf, can } from '../auth/auth.js';
import * as R from '../services/reports.js';

const monthStart = () => `${today().slice(0, 8)}01`;
const range = z.object({ from: z.string().optional(), to: z.string().optional() });
const resolve = (q: unknown) => {
  const r = parse(range, q);
  const from = parse(zDate, r.from || monthStart());
  const to = endOf(r.to || today());
  return { from, to };
};
const asOf = (q: unknown) => endOf(parse(z.object({ asOf: z.string().optional() }), q).asOf || today());

export default async function reportRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: can('dashboard.view') }, async req => {
    const { from, to } = resolve(req.query);
    return R.dashboard(from, to);
  });
  app.get('/reports/profit-loss', { preHandler: can('reports.view') }, async req => {
    const { from, to } = resolve(req.query);
    return R.profitAndLoss(from, to);
  });
  app.get('/reports/balance-sheet', { preHandler: can('reports.view') }, async req => R.balanceSheet(asOf(req.query)));
  app.get('/reports/trial-balance', { preHandler: can('reports.view') }, async req => R.trialBalance(asOf(req.query)));
  app.get('/reports/cash-flow', { preHandler: can('reports.view') }, async req => {
    const { from, to } = resolve(req.query);
    return R.cashFlow(from, to);
  });
  app.get('/reports/general-ledger/:accountId', { preHandler: can('accounting.view') }, async req => {
    const { from, to } = resolve(req.query);
    return R.generalLedger((req.params as any).accountId, from, to);
  });
  app.get('/reports/ar-aging', { preHandler: can('sales.view') }, async req => R.aging('AR', asOf(req.query)));
  app.get('/reports/ap-aging', { preHandler: can('purchases.view') }, async req => R.aging('AP', asOf(req.query)));
  app.get('/reports/inventory', { preHandler: can('inventory.view') }, async () => R.inventoryValuation());
  app.get('/reports/production', { preHandler: can('production.view') }, async req => {
    const { from, to } = resolve(req.query);
    return R.productionSummary(from, to);
  });

  app.get('/audit', { preHandler: can('audit.view') }, async req => {
    const q = parse(z.object({ entity: z.string().optional(), search: z.string().optional(), page: z.coerce.number().int().min(1).default(1) }), req.query);
    const where = { ...(q.entity ? { entity: q.entity } : {}), ...(q.search ? { summary: { contains: q.search } } : {}) };
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 100, take: 100 }),
      prisma.auditLog.count({ where }),
    ]);
    return { data, total };
  });

  // Consistent point-in-time copy of the whole database (SQLite installs). PostgreSQL installs use pg_dump.
  app.get('/admin/backup', { preHandler: can('settings.manage') }, async (req, reply) => {
    if (!String(process.env.DATABASE_URL).startsWith('file:')) throw badRequest('Backups for PostgreSQL are taken with pg_dump / your hosting provider.');
    const dir = mkdtempSync(join(tmpdir(), 'farmledger-'));
    const file = join(dir, 'backup.db');
    try {
      await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const data = readFileSync(file);
      await audit(prisma, actorOf(req), 'backup', 'settings', 'org', 'Downloaded a database backup');
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="farmledger-backup-${today()}.db"`);
      return reply.send(data);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
