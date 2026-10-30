// Financial statements and management reports, computed from the posted general ledger.
import { prisma } from '../db.js';
import { DEBIT_NORMAL, type AccountType } from '../lib/constants.js';
import { round2, num } from '../lib/money.js';
import { addDays, daysBetween, monthKey, ymd } from '../lib/dates.js';

type Range = { from?: Date; to?: Date };

const posted = (r: Range) => ({
  status: 'POSTED',
  ...(r.from || r.to ? { date: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } } : {}),
});

/** Net debit−credit per account for the range. */
async function balances(r: Range) {
  const rows = await prisma.journalLine.groupBy({ by: ['accountId'], where: { entry: posted(r) }, _sum: { debit: true, credit: true } });
  const accounts = await prisma.account.findMany({ orderBy: { code: 'asc' } });
  const byId = new Map(rows.map(x => [x.accountId, { debit: num(x._sum.debit), credit: num(x._sum.credit) }]));
  return accounts.map(a => {
    const s = byId.get(a.id) ?? { debit: 0, credit: 0 };
    const net = round2(s.debit - s.credit);
    const balance = DEBIT_NORMAL[a.type as AccountType] ? net : -net;
    return { id: a.id, code: a.code, name: a.name, nameBn: a.nameBn, type: a.type as AccountType, subtype: a.subtype, cashFlow: a.cashFlow, debit: round2(s.debit), credit: round2(s.credit), net, balance };
  });
}

export async function trialBalance(asOf: Date) {
  const rows = (await balances({ to: asOf })).filter(r => r.debit || r.credit);
  const lines = rows.map(r => ({ ...r, debitBalance: r.net > 0 ? r.net : 0, creditBalance: r.net < 0 ? -r.net : 0 }));
  const totalDebit = round2(lines.reduce((a, l) => a + l.debitBalance, 0));
  const totalCredit = round2(lines.reduce((a, l) => a + l.creditBalance, 0));
  return { asOf: ymd(asOf), lines, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

const section = (rows: Awaited<ReturnType<typeof balances>>, pred: (r: (typeof rows)[number]) => boolean) => {
  const lines = rows.filter(pred).filter(r => Math.abs(r.balance) >= 0.005).map(r => ({ id: r.id, code: r.code, name: r.name, nameBn: r.nameBn, amount: r.balance }));
  return { lines, total: round2(lines.reduce((a, l) => a + l.amount, 0)) };
};

export async function profitAndLoss(from: Date, to: Date) {
  const rows = await balances({ from, to });
  const sales = section(rows, r => r.subtype === 'SALES');
  const otherIncome = section(rows, r => r.type === 'INCOME' && r.subtype !== 'SALES');
  const cogs = section(rows, r => r.subtype === 'COGS');
  const operating = section(rows, r => r.subtype === 'OPERATING_EXPENSE');
  const other = section(rows, r => r.type === 'EXPENSE' && !['COGS', 'OPERATING_EXPENSE'].includes(r.subtype));
  const revenue = sales.total;
  const grossProfit = round2(revenue - cogs.total);
  const operatingProfit = round2(grossProfit - operating.total);
  const netProfit = round2(operatingProfit + otherIncome.total - other.total);
  return {
    from: ymd(from), to: ymd(to), sales, cogs, operating, otherIncome, otherExpenses: other,
    revenue, grossProfit, operatingProfit, netProfit,
    totalIncome: round2(revenue + otherIncome.total), totalExpenses: round2(cogs.total + operating.total + other.total),
    grossMargin: revenue ? round2((grossProfit / revenue) * 100) : null,
    netMargin: revenue ? round2((netProfit / revenue) * 100) : null,
  };
}

export async function fiscalYearStart(asOf: Date) {
  const org = await prisma.organization.findUnique({ where: { id: 'org' } });
  const m = (org?.fiscalYearStart ?? 1) - 1;
  const y = asOf.getUTCMonth() >= m ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, m, 1));
}

export async function balanceSheet(asOf: Date) {
  const rows = await balances({ to: asOf });
  const fyStart = await fiscalYearStart(asOf);
  const prior = await balances({ to: addDays(fyStart, -1) });
  const earnings = (rs: typeof rows) => round2(rs.filter(r => r.type === 'INCOME').reduce((a, r) => a + r.balance, 0) - rs.filter(r => r.type === 'EXPENSE').reduce((a, r) => a + r.balance, 0));
  const totalEarnings = earnings(rows);
  const retained = earnings(prior);
  const currentYear = round2(totalEarnings - retained);

  const currentAssets = section(rows, r => r.type === 'ASSET' && ['CASH', 'BANK', 'RECEIVABLE', 'INVENTORY', 'CURRENT_ASSET'].includes(r.subtype));
  const nonCurrentAssets = section(rows, r => r.type === 'ASSET' && !['CASH', 'BANK', 'RECEIVABLE', 'INVENTORY', 'CURRENT_ASSET'].includes(r.subtype));
  const currentLiabilities = section(rows, r => r.type === 'LIABILITY' && r.subtype !== 'LONG_TERM_LIABILITY');
  const longTermLiabilities = section(rows, r => r.type === 'LIABILITY' && r.subtype === 'LONG_TERM_LIABILITY');
  const equity = section(rows, r => r.type === 'EQUITY');
  equity.lines.push({ id: 'retained', code: '', name: 'Retained earnings (prior years)', nameBn: 'সংরক্ষিত আয় (পূর্ববর্তী বছর)', amount: retained });
  equity.lines.push({ id: 'current', code: '', name: 'Current year profit / (loss)', nameBn: 'চলতি বছরের মুনাফা / (ক্ষতি)', amount: currentYear });
  equity.total = round2(equity.total + totalEarnings);

  const totalAssets = round2(currentAssets.total + nonCurrentAssets.total);
  const totalLiabilities = round2(currentLiabilities.total + longTermLiabilities.total);
  return {
    asOf: ymd(asOf), fiscalYearStart: ymd(fyStart), currentAssets, nonCurrentAssets, currentLiabilities, longTermLiabilities, equity,
    totalAssets, totalLiabilities, totalEquity: equity.total, totalLiabilitiesAndEquity: round2(totalLiabilities + equity.total),
    balanced: Math.abs(totalAssets - totalLiabilities - equity.total) < 0.01,
  };
}

/** Direct-method cash flow: every cash/bank movement is classified by its counter accounts. */
export async function cashFlow(from: Date, to: Date) {
  const cashAccounts = await prisma.account.findMany({ where: { subtype: { in: ['CASH', 'BANK'] } } });
  const cashIds = new Set(cashAccounts.map(a => a.id));
  const before = await balances({ to: addDays(from, -1) });
  const openingCash = round2(before.filter(r => cashIds.has(r.id)).reduce((a, r) => a + r.net, 0));
  const entries = await prisma.journalEntry.findMany({ where: { ...posted({ from, to }), lines: { some: { accountId: { in: [...cashIds] } } } }, include: { lines: { include: { account: true } } } });
  const buckets: Record<string, Map<string, number>> = { OPERATING: new Map(), INVESTING: new Map(), FINANCING: new Map() };
  let openingInRange = 0;
  for (const e of entries) {
    const delta = e.lines.filter(l => cashIds.has(l.accountId)).reduce((a, l) => a + num(l.debit) - num(l.credit), 0);
    if (e.sourceType === 'OPENING') { openingInRange += delta; continue; } // opening balances are not cash flows
    const others = e.lines.filter(l => !cashIds.has(l.accountId));
    const weight = others.reduce((a, l) => a + Math.abs(num(l.debit) - num(l.credit)), 0);
    if (!others.length || !weight) continue; // transfers between cash accounts
    for (const l of others) {
      const share = (Math.abs(num(l.debit) - num(l.credit)) / weight) * delta;
      const label = l.account.subtype === 'RECEIVABLE' ? 'Receipts from customers' : l.account.subtype === 'PAYABLE' ? 'Payments to suppliers' : l.account.name;
      const b = buckets[l.account.cashFlow] ?? buckets.OPERATING;
      b.set(label, round2((b.get(label) ?? 0) + share));
    }
  }
  const toSection = (m: Map<string, number>) => {
    const lines = [...m.entries()].filter(([, v]) => Math.abs(v) >= 0.005).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    return { lines, total: round2(lines.reduce((a, l) => a + l.amount, 0)) };
  };
  const operating = toSection(buckets.OPERATING);
  const investing = toSection(buckets.INVESTING);
  const financing = toSection(buckets.FINANCING);
  const netChange = round2(operating.total + investing.total + financing.total);
  const opening = round2(openingCash + openingInRange);
  return { from: ymd(from), to: ymd(to), openingCash: opening, operating, investing, financing, netChange, closingCash: round2(opening + netChange) };
}

export async function generalLedger(accountIdValue: string, from: Date, to: Date) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountIdValue } });
  const debitNormal = DEBIT_NORMAL[account.type as AccountType];
  const openingAgg = await prisma.journalLine.aggregate({ where: { accountId: account.id, entry: posted({ to: addDays(from, -1) }) }, _sum: { debit: true, credit: true } });
  const openNet = num(openingAgg._sum.debit) - num(openingAgg._sum.credit);
  let running = debitNormal ? openNet : -openNet;
  const opening = round2(running);
  const lines = await prisma.journalLine.findMany({
    where: { accountId: account.id, entry: posted({ from, to }) },
    include: { entry: true, party: { select: { name: true } } },
    orderBy: [{ entry: { date: 'asc' } }, { entry: { createdAt: 'asc' } }],
  });
  const rows = lines.map(l => {
    const d = num(l.debit), c = num(l.credit);
    running = round2(running + (debitNormal ? d - c : c - d));
    return { id: l.id, date: ymd(l.entry.date), number: l.entry.number, entryId: l.entryId, memo: l.memo || l.entry.memo, party: l.party?.name ?? null, sourceType: l.entry.sourceType, debit: d, credit: c, balance: running };
  });
  return { account, from: ymd(from), to: ymd(to), opening, closing: round2(running), lines: rows };
}

export async function aging(kind: 'AR' | 'AP', asOf: Date) {
  const docs = kind === 'AR'
    ? (await prisma.salesInvoice.findMany({ where: { status: { in: ['POSTED', 'PARTIAL'] }, date: { lte: asOf } }, include: { customer: true } }))
      .map(d => ({ id: d.id, number: d.number, date: d.date, dueDate: d.dueDate, partyId: d.customerId, party: d.customer.name, open: round2(num(d.total) - num(d.amountPaid)) }))
    : (await prisma.bill.findMany({ where: { status: { in: ['POSTED', 'PARTIAL'] }, date: { lte: asOf } }, include: { supplier: true } }))
      .map(d => ({ id: d.id, number: d.number, date: d.date, dueDate: d.dueDate, partyId: d.supplierId ?? 'none', party: d.supplier?.name ?? 'No supplier', open: round2(num(d.total) - num(d.amountPaid)) }));
  const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus'] as const;
  const parties = new Map<string, { partyId: string; party: string; total: number } & Record<(typeof buckets)[number], number>>();
  const documents = docs.filter(d => d.open > 0.005).map(d => {
    const overdue = daysBetween(d.dueDate, asOf);
    const bucket = overdue <= 0 ? 'current' : overdue <= 30 ? 'd1_30' : overdue <= 60 ? 'd31_60' : overdue <= 90 ? 'd61_90' : 'd90plus';
    const p = parties.get(d.partyId) ?? { partyId: d.partyId, party: d.party, total: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    p[bucket] = round2(p[bucket] + d.open);
    p.total = round2(p.total + d.open);
    parties.set(d.partyId, p);
    return { ...d, date: ymd(d.date), dueDate: ymd(d.dueDate), overdueDays: Math.max(overdue, 0), bucket };
  });
  const rows = [...parties.values()].sort((a, b) => b.total - a.total);
  const totals = Object.fromEntries(['total', ...buckets].map(k => [k, round2(rows.reduce((a, r) => a + (r as any)[k], 0))]));
  return { kind, asOf: ymd(asOf), rows, totals, documents: documents.sort((a, b) => b.overdueDays - a.overdueDays) };
}

export async function inventoryValuation() {
  const items = await prisma.item.findMany({ where: { trackInventory: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  const rows = items.map(i => ({ id: i.id, sku: i.sku, name: i.name, nameBn: i.nameBn, category: i.category, unit: i.unit, valued: i.valued, qtyOnHand: num(i.qtyOnHand), avgCost: num(i.avgCost), value: i.valued ? round2(num(i.qtyOnHand) * num(i.avgCost)) : 0, reorderLevel: num(i.reorderLevel), low: num(i.reorderLevel) > 0 && num(i.qtyOnHand) <= num(i.reorderLevel) }));
  return { rows, totalValue: round2(rows.reduce((a, r) => a + r.value, 0)) };
}

export async function productionSummary(from: Date, to: Date) {
  const logs = await prisma.productionLog.findMany({ where: { status: 'POSTED', date: { gte: from, lte: to } }, include: { flock: true }, orderBy: { date: 'asc' } });
  const flocks = await prisma.flock.findMany({ where: { status: 'ACTIVE' } });
  const birds = flocks.reduce((a, f) => a + f.currentCount, 0);
  const byDay = new Map<string, { date: string; eggs: number; broken: number; mortality: number; feedQty: number; feedCost: number; birds: number }>();
  for (const l of logs) {
    const k = ymd(l.date);
    const d = byDay.get(k) ?? { date: k, eggs: 0, broken: 0, mortality: 0, feedQty: 0, feedCost: 0, birds: 0 };
    d.eggs += l.eggsCollected; d.broken += l.eggsBroken; d.mortality += l.mortality + l.culled;
    d.feedQty = round2(d.feedQty + num(l.feedQty)); d.feedCost = round2(d.feedCost + num(l.feedCost));
    d.birds += l.flock.currentCount;
    byDay.set(k, d);
  }
  const days = [...byDay.values()].map(d => ({ ...d, layingRate: d.birds ? round2((d.eggs / d.birds) * 100) : null }));
  const totals = days.reduce((a, d) => ({ eggs: a.eggs + d.eggs, broken: a.broken + d.broken, mortality: a.mortality + d.mortality, feedQty: round2(a.feedQty + d.feedQty), feedCost: round2(a.feedCost + d.feedCost) }), { eggs: 0, broken: 0, mortality: 0, feedQty: 0, feedCost: 0 });
  const rates = days.map(d => d.layingRate).filter((x): x is number => x !== null);
  return {
    from: ymd(from), to: ymd(to), days, totals, birds, activeFlocks: flocks.length,
    avgLayingRate: rates.length ? round2(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
    feedPerEgg: totals.eggs ? round2((totals.feedQty * 1000) / totals.eggs) / 1000 : null,
    feedCostPerEgg: totals.eggs ? round2(totals.feedCost / totals.eggs) : null,
  };
}

export async function dashboard(from: Date, to: Date) {
  const [pl, bal, inv, prod] = await Promise.all([profitAndLoss(from, to), balances({ to }), inventoryValuation(), productionSummary(from, to)]);
  const sumSub = (subs: string[]) => round2(bal.filter(r => subs.includes(r.subtype)).reduce((a, r) => a + r.balance, 0));

  // 12-month trend ending at `to`.
  const trendStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  const lines = await prisma.journalLine.findMany({ where: { entry: posted({ from: trendStart, to }), account: { type: { in: ['INCOME', 'EXPENSE'] } } }, select: { debit: true, credit: true, account: { select: { type: true } }, entry: { select: { date: true } } } });
  const months = new Map<string, { month: string; income: number; expenses: number; profit: number }>();
  for (let i = 0; i < 12; i++) {
    const k = monthKey(new Date(Date.UTC(trendStart.getUTCFullYear(), trendStart.getUTCMonth() + i, 1)));
    months.set(k, { month: k, income: 0, expenses: 0, profit: 0 });
  }
  for (const l of lines) {
    const m = months.get(monthKey(l.entry.date));
    if (!m) continue;
    if (l.account.type === 'INCOME') m.income = round2(m.income + num(l.credit) - num(l.debit));
    else m.expenses = round2(m.expenses + num(l.debit) - num(l.credit));
  }
  const trend = [...months.values()].map(m => ({ ...m, profit: round2(m.income - m.expenses) }));

  const expenseBreakdown = [...pl.cogs.lines, ...pl.operating.lines, ...pl.otherExpenses.lines].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const topCustomersRaw = await prisma.salesInvoice.groupBy({ by: ['customerId'], where: { status: { not: 'VOID' }, date: { gte: from, lte: to } }, _sum: { total: true }, orderBy: { _sum: { total: 'desc' } }, take: 5 });
  const customers = await prisma.party.findMany({ where: { id: { in: topCustomersRaw.map(t => t.customerId) } } });
  const topCustomers = topCustomersRaw.map(t => ({ name: customers.find(c => c.id === t.customerId)?.name ?? '—', total: num(t._sum.total) }));
  const overdue = await prisma.salesInvoice.aggregate({ where: { status: { in: ['POSTED', 'PARTIAL'] }, dueDate: { lt: to } }, _count: true, _sum: { total: true, amountPaid: true } });
  const eggsSold = await prisma.stockMove.aggregate({ where: { type: 'SALE', voided: false, date: { gte: from, lte: to }, item: { category: 'PRODUCE' } }, _sum: { quantity: true } });
  const recent = await prisma.auditLog.findMany({ where: { action: { in: ['create', 'void'] } }, orderBy: { createdAt: 'desc' }, take: 8, include: { user: { select: { name: true } } } });

  return {
    from: ymd(from), to: ymd(to),
    kpis: {
      revenue: pl.revenue, totalIncome: pl.totalIncome, expenses: pl.totalExpenses, netProfit: pl.netProfit, netMargin: pl.netMargin,
      cash: sumSub(['CASH']), bank: sumSub(['BANK']), receivables: sumSub(['RECEIVABLE']), payables: sumSub(['PAYABLE']),
      inventoryValue: inv.totalValue, overdueCount: overdue._count, overdueAmount: round2(num(overdue._sum.total) - num(overdue._sum.amountPaid)),
      eggsProduced: prod.totals.eggs, eggsSold: -num(eggsSold._sum.quantity), birds: prod.birds, mortality: prod.totals.mortality, avgLayingRate: prod.avgLayingRate,
      feedCostPerEgg: prod.feedCostPerEgg,
    },
    trend, expenseBreakdown, topCustomers, production: prod.days,
    lowStock: inv.rows.filter(r => r.low),
    stock: inv.rows.slice(0, 8),
    recent: recent.map(r => ({ id: r.id, at: r.createdAt, user: r.user?.name ?? 'System', action: r.action, entity: r.entity, summary: r.summary })),
  };
}
