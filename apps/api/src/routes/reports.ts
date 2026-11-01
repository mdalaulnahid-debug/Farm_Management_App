import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { parse, zDate } from '../lib/validate.js';
import { addDays, endOf, today, toDate, ymd } from '../lib/dates.js';
import { can } from '../auth/auth.js';
import * as R from '../services/reports.js';
import { unusualActivity } from '../services/activity.js';
import { sealAudit, verifyAuditChain } from '../services/audit-chain.js';
import { backupPath, isSqlite, listBackups } from '../services/backup.js';

const monthStart = () => `${today().slice(0, 8)}01`;
const range = z.object({ from: z.string().optional(), to: z.string().optional(), projectId: z.string().optional() });
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
    const projectId = (req.query as { projectId?: string }).projectId || null;
    return R.profitAndLoss(from, to, projectId);
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

  // What an insider would do to hide theft, for the owner to look over (default: the last 7 days).
  app.get('/reports/activity', { preHandler: can('audit.view') }, async req => {
    const r = parse(range, req.query);
    const to = r.to ? ymd(parse(zDate, r.to)) : today();
    const from = r.from ? ymd(parse(zDate, r.from)) : ymd(addDays(toDate(to), -6));
    return unusualActivity(from, to);
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

  // Is the audit trail intact? Seals new rows, recomputes the chain and compares it with the newest backup.
  // After a restore, older backups legitimately hold history the restored database does not, so only a
  // backup taken after the latest restore is compared.
  app.get('/audit/integrity', { preHandler: can('audit.view') }, async () => {
    await sealAudit(prisma);
    const restoredAt = (await prisma.auditLog.findFirst({ where: { action: 'restore' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt;
    const candidates = isSqlite() ? listBackups().filter(b => !restoredAt || new Date(b.createdAt) > restoredAt) : [];
    const report = await verifyAuditChain(prisma, candidates[0] ? backupPath(candidates[0].name) : null);
    return { ...report, restoredAt: restoredAt?.toISOString() ?? null };
  });
}
