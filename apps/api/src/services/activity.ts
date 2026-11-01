// "Unusual activity" for the owner: the things an insider would do to hide theft, by when they
// were done (not by the business date on the record). Read-only; computed from the audit trail,
// journals, invoices, stock moves and cash counts.
import { prisma } from '../db.js';
import { num, round2 } from '../lib/money.js';
import { toDate, ymd } from '../lib/dates.js';
import { backdateDays } from './ledger.js';

/** An entry dated more than this many days before it was typed in is listed as back-dated. */
export const BACKDATED_AFTER_DAYS = 2;
const LIMIT = 500;

const pad = (n: number) => String(n).padStart(2, '0');
/** Calendar day on the farm computer's clock (the office is not on UTC). */
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Activity done between the start of `from` and the end of `to`, both farm-local calendar days. */
export async function unusualActivity(from: string, to: string) {
  const when = { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) };
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true, email: true } })).map(u => [u.id, u]));
  const who = (id: string | null | undefined) => (id ? users.get(id)?.name ?? 'Unknown user' : 'System');

  const [audits, entries, invoices, moves, counts, accounts] = await Promise.all([
    prisma.auditLog.findMany({ where: { createdAt: when, OR: [{ action: { in: ['void', 'login_failed'] } }, { entity: { in: ['user', 'role', 'settings'] }, action: { in: ['create', 'update'] } }] }, orderBy: { createdAt: 'desc' } }),
    prisma.journalEntry.findMany({ where: { createdAt: when, sourceType: { not: 'REVERSAL' } }, include: { lines: { select: { debit: true } } }, orderBy: { date: 'asc' } }),
    prisma.salesInvoice.findMany({ where: { createdAt: when, discount: { gt: 0 } }, include: { customer: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: LIMIT }),
    prisma.stockMove.findMany({ where: { createdAt: when, type: { in: ['WASTE', 'GIFT', 'ADJUSTMENT'] }, quantity: { lt: 0 } }, include: { item: { select: { name: true, nameBn: true, unit: true } } } }),
    prisma.cashCount.findMany({ where: { createdAt: when, variance: { lt: 0 } }, orderBy: { createdAt: 'desc' } }),
    prisma.account.findMany({ select: { id: true, name: true, nameBn: true } }),
  ]);
  const accountName = new Map(accounts.map(a => [a.id, a]));

  // Voids, grouped per person, day and reason: replacing or undoing an import voids dozens of records at once.
  const voidGroups = new Map<string, { at: Date; user: string; reason: string; count: number; records: string[]; summary: string }>();
  for (const a of audits.filter(x => x.action === 'void')) {
    const cut = a.summary.indexOf(': ');
    const record = (cut > 0 ? a.summary.slice(0, cut) : a.summary).replace(/^Voided /, '').replace(/^Undid /, 'undo ');
    const reason = cut > 0 ? a.summary.slice(cut + 2) : '';
    const key = `${a.userId}|${localDay(a.createdAt)}|${reason}`;
    const g = voidGroups.get(key) ?? { at: a.createdAt, user: who(a.userId), reason, count: 0, records: [], summary: a.summary };
    g.count++;
    if (g.records.length < 10) g.records.push(record);
    if (g.count > 1) g.summary = `Voided ${g.count} records: ${reason}`;
    voidGroups.set(key, g);
  }
  const voids = [...voidGroups.values()].slice(0, LIMIT);

  // Back-dated entries, grouped by who typed them in and on which day (a month's import is one row).
  const backdated = new Map<string, { user: string; enteredOn: string; count: number; voided: number; earliest: string; latest: string; amount: number; numbers: string[] }>();
  for (const e of entries) {
    const enteredOn = localDay(e.createdAt);
    const days = Math.round((toDate(enteredOn).getTime() - e.date.getTime()) / 86_400_000);
    if (days <= BACKDATED_AFTER_DAYS) continue;
    const key = `${e.createdById}|${enteredOn}`;
    const g = backdated.get(key) ?? { user: who(e.createdById), enteredOn, count: 0, voided: 0, earliest: ymd(e.date), latest: ymd(e.date), amount: 0, numbers: [] };
    g.count++;
    if (e.status === 'VOID') g.voided++;
    if (ymd(e.date) < g.earliest) g.earliest = ymd(e.date);
    if (ymd(e.date) > g.latest) g.latest = ymd(e.date);
    g.amount = round2(g.amount + e.lines.reduce((s, l) => s + num(l.debit), 0));
    if (g.numbers.length < 5) g.numbers.push(e.number);
    backdated.set(key, g);
  }

  const discounts = invoices.map(i => ({
    number: i.number, date: ymd(i.date), at: i.createdAt, customer: i.customer.name, user: who(i.createdById), status: i.status,
    subtotal: num(i.subtotal), discount: num(i.discount), percent: num(i.subtotal) > 0 ? round2((num(i.discount) / num(i.subtotal)) * 100) : 0,
  }));

  // Stock taken out without a sale: waste, gifts and count shortfalls, grouped per person, day and item.
  const writeOffs = new Map<string, { user: string; enteredOn: string; item: string; itemBn: string | null; unit: string; type: string; quantity: number; value: number; count: number }>();
  for (const m of moves) {
    const enteredOn = localDay(m.createdAt);
    const key = `${m.createdById}|${enteredOn}|${m.itemId}|${m.type}`;
    const g = writeOffs.get(key) ?? { user: who(m.createdById), enteredOn, item: m.item.name, itemBn: m.item.nameBn, unit: m.item.unit, type: m.type, quantity: 0, value: 0, count: 0 };
    g.quantity = round2(g.quantity - num(m.quantity));
    g.value = round2(g.value - num(m.value));
    g.count++;
    writeOffs.set(key, g);
  }

  const cashShortages = counts.map(c => ({
    date: ymd(c.date), at: c.createdAt, account: accountName.get(c.accountId)?.name ?? '', accountBn: accountName.get(c.accountId)?.nameBn ?? null,
    user: who(c.createdById), book: num(c.bookBalance), counted: num(c.counted), variance: num(c.variance),
  }));

  const failed = new Map<string, { user: string; email: string; count: number; last: Date; ips: string[] }>();
  for (const a of audits.filter(x => x.action === 'login_failed')) {
    const u = a.entityId ? users.get(a.entityId) : undefined;
    const g = failed.get(a.entityId ?? '') ?? { user: u?.name ?? 'Unknown user', email: u?.email ?? '', count: 0, last: a.createdAt, ips: [] };
    g.count++;
    if (a.ip && !g.ips.includes(a.ip)) g.ips.push(a.ip);
    failed.set(a.entityId ?? '', g);
  }

  const adminChanges = audits.filter(a => a.action !== 'void' && a.action !== 'login_failed').slice(0, LIMIT)
    .map(a => ({ at: a.createdAt, user: who(a.userId), entity: a.entity, action: a.action, summary: a.summary }));

  const result = {
    from, to, backdateDays: backdateDays(), backdatedAfterDays: BACKDATED_AFTER_DAYS,
    voids,
    backdated: [...backdated.values()].sort((a, b) => b.enteredOn.localeCompare(a.enteredOn) || b.count - a.count),
    discounts,
    writeOffs: [...writeOffs.values()].sort((a, b) => b.value - a.value || b.quantity - a.quantity),
    cashShortages,
    failedSignIns: [...failed.values()].sort((a, b) => b.count - a.count),
    adminChanges,
  };
  return {
    ...result,
    counts: {
      voids: voids.reduce((s, g) => s + g.count, 0), backdated: result.backdated.reduce((s, g) => s + g.count, 0), discounts: discounts.length,
      writeOffs: result.writeOffs.length, cashShortages: cashShortages.length,
      failedSignIns: result.failedSignIns.reduce((s, f) => s + f.count, 0), adminChanges: adminChanges.length,
    },
  };
}
