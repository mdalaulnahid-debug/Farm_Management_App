// Projects (business lines), grants received, and transfers to/from side projects.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, tx } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { parse, zDate, zId, zMoney, zOptText } from '../lib/validate.js';
import { PAYMENT_METHODS, PROJECT_KINDS, SYS } from '../lib/constants.js';
import { actorOf, can } from '../auth/auth.js';
import { audit } from '../services/common.js';
import { projectSummary, projectTransfer, recordGrant } from '../services/projects.js';

export default async function projectRoutes(app: FastifyInstance) {
  app.get('/projects', { preHandler: can() }, async () => ({ data: await prisma.project.findMany({ orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] }) }));
  app.get('/projects/summary', { preHandler: can('banking.view') }, async () => ({ data: await projectSummary() }));

  const body = z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Use 2–20 letters/numbers'),
    name: z.string().trim().min(2).max(80), nameBn: zOptText(80), kind: z.enum(PROJECT_KINDS),
    active: z.boolean().default(true), notes: zOptText(300),
  });
  app.post('/projects', { preHandler: can('settings.manage') }, async req => {
    const b = parse(body, req.body);
    if (await prisma.project.findUnique({ where: { code: b.code } })) throw conflict(`Project code ${b.code} is already used.`);
    const p = await prisma.project.create({ data: b });
    await audit(prisma, actorOf(req), 'create', 'project', p.id, `Project ${p.name}`);
    return p;
  });
  app.put('/projects/:id', { preHandler: can('settings.manage') }, async req => {
    const { id } = req.params as { id: string };
    const b = parse(body, req.body);
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) throw notFound('Project');
    if (p.isMain && !b.active) throw conflict('The main project cannot be deactivated.');
    const updated = await prisma.project.update({ where: { id }, data: b });
    await audit(prisma, actorOf(req), 'update', 'project', id, `Updated project ${updated.name}`);
    return updated;
  });

  app.get('/project-transfers', { preHandler: can('banking.view') }, async () => {
    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: 'PROJECT_TRANSFER', reversalOf: null }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 200,
      include: { lines: { include: { account: true, project: true } } },
    });
    return {
      data: entries.map(e => {
        const sideLine = e.lines.find(l => l.account.code === SYS.SIDE_PROJECTS)!;
        const out = Number(sideLine.debit) > 0;
        return { id: e.id, number: e.number, date: e.date, memo: e.memo, status: e.status, direction: out ? 'OUT' : 'IN', amount: Number(out ? sideLine.debit : sideLine.credit), project: sideLine.project };
      }),
    };
  });
  app.post('/project-transfers', { preHandler: can('banking.manage') }, async req => {
    const b = parse(z.object({ date: zDate, projectId: zId, direction: z.enum(['OUT', 'IN']), cashAccountId: zId, amount: zMoney, memo: zOptText(200) }), req.body);
    return tx(db => projectTransfer(db, actorOf(req), b));
  });

  app.get('/grants', { preHandler: can('banking.view') }, async () => {
    const grant = await prisma.account.findUnique({ where: { code: SYS.GRANT_INCOME } });
    const data = await prisma.payment.findMany({
      where: { counterAccountId: grant?.id ?? '-', direction: 'IN' }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 300,
      include: { party: { select: { id: true, name: true, phone: true } } },
    });
    const total = data.filter(p => p.status !== 'VOID').reduce((a, p) => a + Number(p.amount), 0);
    return { data, total };
  });
  app.post('/grants', { preHandler: can('banking.manage') }, async req => {
    const b = parse(z.object({
      date: zDate, donor: z.object({ name: zOptText(120), phone: zOptText(40) }), amount: zMoney, cashAccountId: zId,
      method: z.enum(PAYMENT_METHODS).optional(), reference: zOptText(60), notes: zOptText(300), projectId: zOptText(40),
    }), req.body);
    return tx(db => recordGrant(db, actorOf(req), b));
  });
}
