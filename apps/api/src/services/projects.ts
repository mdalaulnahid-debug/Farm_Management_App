// Business lines (projects), grants received, and money moved between the main farm and side projects.
import type { Db } from '../db.js';
import { prisma } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { money, num, round2 } from '../lib/money.js';
import { normalizePhone } from '../lib/phone.js';
import { SYS } from '../lib/constants.js';
import { accountId, mainProjectId, postEntry } from './ledger.js';
import { createPayment } from './payments.js';
import { audit, type Actor } from './common.js';

/** Find a donor by phone (any format) or exact name; add them to contacts if new. */
async function resolveDonor(db: Db, actor: Actor | null, d: { name?: string | null; phone?: string | null }) {
  const phone = normalizePhone(d.phone);
  const name = d.name?.trim() || null;
  if (!phone && !name) throw badRequest('Enter the name or phone of the person giving the grant.');
  const donors = await db.party.findMany({ where: { kind: { in: ['DONOR', 'BOTH', 'CUSTOMER', 'SUPPLIER'] } } });
  const hit = phone ? donors.find(p => normalizePhone(p.phone) === phone) : donors.find(p => p.name.toLowerCase() === name!.toLowerCase());
  if (hit) return hit;
  const party = await db.party.create({ data: { kind: 'DONOR', name: name ?? phone!, phone } });
  await audit(db, actor, 'create', 'party', party.id, `Donor ${party.name} added`);
  return party;
}

export interface GrantInput {
  date: Date; donor: { name?: string | null; phone?: string | null }; amount: number; cashAccountId: string;
  method?: string; reference?: string | null; notes?: string | null; projectId?: string | null;
}

/** A grant/donation is income (not sales, not owner's capital) and is shown under Other income. */
export async function recordGrant(db: Db, actor: Actor | null, input: GrantInput) {
  const donor = await resolveDonor(db, actor, input.donor);
  const projectId = input.projectId || (await mainProjectId(db));
  return createPayment(db, actor, {
    direction: 'IN', date: input.date, partyId: donor.id, cashAccountId: input.cashAccountId,
    counterAccountId: await accountId(db, SYS.GRANT_INCOME), amount: input.amount, method: input.method,
    reference: input.reference ?? null, notes: input.notes || `Grant from ${donor.name}`, projectId,
  });
}

export interface ProjectTransferInput {
  date: Date; projectId: string; direction: 'OUT' | 'IN'; cashAccountId: string; amount: number; memo?: string | null;
}

/**
 * OUT: main farm cash → side project. IN: money returned from a side project.
 * Booked to "Funds with side projects" (tagged with that project), so it is never an expense of the
 * duck farm; when a side project's own records are kept here, its spending is charged against it.
 */
export async function projectTransfer(db: Db, actor: Actor | null, input: ProjectTransferInput) {
  const amount = money(input.amount);
  if (amount <= 0) throw badRequest('Amount must be greater than zero.');
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project || project.isMain) throw badRequest('Choose a side project.');
  const cash = await db.account.findUnique({ where: { id: input.cashAccountId } });
  if (!cash || !['CASH', 'BANK'].includes(cash.subtype)) throw badRequest('Choose a cash or bank account.');
  const main = await mainProjectId(db);
  const side = await accountId(db, SYS.SIDE_PROJECTS);
  const memo = input.memo?.trim() || (input.direction === 'OUT' ? `Transfer to ${project.name}` : `Returned from ${project.name}`);
  const je = await postEntry(db, actor, {
    date: input.date, memo, sourceType: 'PROJECT_TRANSFER', sourceId: project.id,
    lines: input.direction === 'OUT'
      ? [{ accountId: side, debit: amount, projectId: project.id }, { accountId: cash.id, credit: amount, projectId: main }]
      : [{ accountId: cash.id, debit: amount, projectId: main }, { accountId: side, credit: amount, projectId: project.id }],
  });
  await audit(db, actor, 'create', 'project_transfer', je.id, `${memo}: ${amount}`);
  return je;
}

/** Each project with money sent, returned and still held, plus its income/expenses so far. */
export async function projectSummary() {
  const projects = await prisma.project.findMany({ orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] });
  const side = await prisma.account.findUnique({ where: { code: SYS.SIDE_PROJECTS } });
  const lines = await prisma.journalLine.groupBy({ by: ['projectId', 'accountId'], where: { entry: { status: 'POSTED' } }, _sum: { debit: true, credit: true } });
  const accounts = new Map((await prisma.account.findMany({ select: { id: true, type: true } })).map(a => [a.id, a.type]));
  return projects.map(p => {
    const mine = lines.filter(l => l.projectId === p.id);
    const s = (pred: (l: (typeof mine)[number]) => boolean, f: (l: (typeof mine)[number]) => number) => round2(mine.filter(pred).reduce((a, l) => a + f(l), 0));
    const sent = s(l => l.accountId === side?.id, l => num(l._sum.debit));
    const returned = s(l => l.accountId === side?.id, l => num(l._sum.credit));
    const income = s(l => accounts.get(l.accountId) === 'INCOME', l => num(l._sum.credit) - num(l._sum.debit));
    const expenses = s(l => accounts.get(l.accountId) === 'EXPENSE', l => num(l._sum.debit) - num(l._sum.credit));
    return { ...p, sent, returned, held: round2(sent - returned), income, expenses, profit: round2(income - expenses) };
  });
}
