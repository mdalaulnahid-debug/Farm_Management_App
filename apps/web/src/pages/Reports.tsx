import { useState, type ReactNode } from 'react';
import { BarChart3, BookCheck, CalendarClock, Download, Egg, Landmark, Package, Printer, Scale, Waves } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { downloadCsv, fmtDate, fmtMoney, fmtNum, fmtPct, ymd } from '../lib/format';
import { Alert, Card, Field, Input, Loading, PageHeader, RangePicker, thisMonth, type Range } from '../components/ui';
import { Money } from '../components/forms';

type Key = 'pl' | 'bs' | 'cf' | 'tb' | 'ar' | 'ap' | 'inv' | 'prod';
interface Line { id?: string; code?: string; name: string; nameBn?: string | null; amount: number }
interface Section { lines: Line[]; total: number }

/** Same-length period immediately before `r`, for comparison columns. */
const previous = (r: Range): Range => {
  const from = new Date(`${r.from}T00:00:00Z`), to = new Date(`${r.to}T00:00:00Z`);
  const sameMonths = from.getUTCDate() === 1 && new Date(to.getTime() + 86400000).getUTCDate() === 1;
  if (sameMonths) {
    const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1;
    const pf = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - months, 1));
    const pt = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 0));
    return { from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) };
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  return { from: new Date(from.getTime() - days * 86400000).toISOString().slice(0, 10), to: new Date(from.getTime() - 86400000).toISOString().slice(0, 10) };
};

export default function Reports() {
  const { t } = usePrefs();
  const { can } = useAuth();
  const [key, setKey] = useState<Key>('pl');
  const [range, setRange] = useState<Range>(thisMonth());
  const [asOf, setAsOf] = useState(ymd());
  const reports: { key: Key; icon: any; title: string; desc: string; perm: string; kind: 'range' | 'asof' | 'none' }[] = [
    { key: 'pl', icon: BarChart3, title: t('Profit & loss', 'লাভ-ক্ষতি বিবরণী'), desc: t('Income statement with prior-period comparison', 'পূর্ববর্তী সময়ের সাথে তুলনাসহ আয় বিবরণী'), perm: 'reports.view', kind: 'range' },
    { key: 'bs', icon: Scale, title: t('Balance sheet', 'ব্যালান্স শিট'), desc: t('Assets, liabilities and equity', 'সম্পদ, দায় ও মূলধন'), perm: 'reports.view', kind: 'asof' },
    { key: 'cf', icon: Waves, title: t('Cash flow', 'নগদ প্রবাহ'), desc: t('Operating, investing, financing (direct method)', 'পরিচালন, বিনিয়োগ, অর্থায়ন (প্রত্যক্ষ পদ্ধতি)'), perm: 'reports.view', kind: 'range' },
    { key: 'tb', icon: BookCheck, title: t('Trial balance', 'রেওয়ামিল'), desc: t('Debit and credit balance of every account', 'প্রতিটি হিসাবের ডেবিট ও ক্রেডিট স্থিতি'), perm: 'reports.view', kind: 'asof' },
    { key: 'ar', icon: CalendarClock, title: t('Receivables aging', 'পাওনার বয়স বিশ্লেষণ'), desc: t('Who owes you, and for how long', 'কে কত দিন ধরে কত টাকা বাকি'), perm: 'sales.view', kind: 'asof' },
    { key: 'ap', icon: Landmark, title: t('Payables aging', 'দেনার বয়স বিশ্লেষণ'), desc: t('What you owe suppliers', 'সরবরাহকারীদের কাছে দেনা'), perm: 'purchases.view', kind: 'asof' },
    { key: 'inv', icon: Package, title: t('Inventory valuation', 'মজুদ মূল্যায়ন'), desc: t('Stock on hand at weighted-average cost', 'ভারিত গড় মূল্যে হাতে মজুদ'), perm: 'inventory.view', kind: 'none' },
    { key: 'prod', icon: Egg, title: t('Production performance', 'উৎপাদন কার্যকারিতা'), desc: t('Eggs, laying rate, mortality, feed efficiency', 'ডিম, ডিম পাড়ার হার, মৃত্যু, খাদ্য দক্ষতা'), perm: 'production.view', kind: 'range' },
  ];
  const allowed = reports.filter(r => can(r.perm));
  const current = allowed.find(r => r.key === key) ?? allowed[0];

  return (
    <>
      <PageHeader crumb={t('Finance', 'অর্থ')} title={t('Reports', 'রিপোর্ট')} subtitle={t('All statements are calculated live from the posted general ledger.', 'সব বিবরণী পোস্ট করা সাধারণ খাতা থেকে সরাসরি হিসাব করা হয়।')}
        actions={<>
          {current?.kind === 'range' && <RangePicker value={range} onChange={setRange} />}
          {current?.kind === 'asof' && <Field label={t('As of', 'তারিখ পর্যন্ত')}><Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></Field>}
          <button className="btn" onClick={() => window.print()}><Printer size={16} />{t('Print / PDF', 'প্রিন্ট / পিডিএফ')}</button>
        </>} />
      <div className="grid g4 no-print">
        {allowed.map(r => (
          <button key={r.key} className="card kpi" style={{ textAlign: 'left', cursor: 'pointer', borderColor: r.key === current?.key ? 'var(--brand-2)' : undefined, boxShadow: r.key === current?.key ? 'var(--focus)' : undefined }} onClick={() => setKey(r.key)}>
            <div className="kpi-label"><span className="kpi-icon"><r.icon size={16} /></span><b style={{ color: 'var(--text)' }}>{r.title}</b></div>
            <div className="kpi-sub">{r.desc}</div>
          </button>
        ))}
      </div>
      {current?.key === 'pl' && <ProfitLoss range={range} />}
      {current?.key === 'bs' && <BalanceSheet asOf={asOf} />}
      {current?.key === 'cf' && <CashFlow range={range} />}
      {current?.key === 'tb' && <TrialBalance asOf={asOf} />}
      {(current?.key === 'ar' || current?.key === 'ap') && <Aging kind={current.key} asOf={asOf} />}
      {current?.key === 'inv' && <InventoryValuation />}
      {current?.key === 'prod' && <ProductionReport range={range} />}
    </>
  );
}

function Statement({ title, period, children, onCsv }: { title: string; period: string; children: ReactNode; onCsv?: () => void }) {
  const { t } = usePrefs();
  const { me } = useAuth();
  return (
    <Card className="statement" actions={onCsv && <button className="btn sm no-print" onClick={onCsv}><Download size={14} />CSV</button>}>
      <div className="statement-head"><div className="muted small">{me?.organization.name}</div><h2>{title}</h2><p>{period}</p></div>
      <div className="table-wrap">{children}</div>
      <div className="muted small" style={{ padding: '10px 18px' }}>{t('Amounts in BDT. Generated', 'টাকার অঙ্ক বিডিটি-তে। তৈরি')} {new Date().toLocaleString()}</div>
    </Card>
  );
}

const nm = (l: Line, lang: string) => (lang === 'bn' && l.nameBn ? l.nameBn : l.name);

function ProfitLoss({ range }: { range: Range }) {
  const { t, lang } = usePrefs();
  const prev = previous(range);
  const cur = useApi<any>('/reports/profit-loss', range);
  const old = useApi<any>('/reports/profit-loss', prev);
  if (!cur.data || !old.data) return <Loading />;
  const c = cur.data, p = old.data;
  const prevOf = (sec: string, id?: string) => (p[sec] as Section).lines.find(l => l.id === id)?.amount ?? 0;
  const change = (a: number, b: number) => (b ? fmtPct(((a - b) / Math.abs(b)) * 100, lang) : '—');
  const rows: [string, string | number, number, number, string][] = [];
  const sec = (key: string, label: string, totalLabel: string) => {
    const s = c[key] as Section;
    const lines = [...s.lines];
    for (const l of (p[key] as Section).lines) if (!lines.find(x => x.id === l.id)) lines.push({ ...l, amount: 0 });
    return (
      <>
        <tr className="subtotal"><td colSpan={4}>{label}</td></tr>
        {lines.map(l => { rows.push([label, `${l.code} ${l.name}`, l.amount, prevOf(key, l.id), '']); return <tr key={l.id} className="indent"><td>{l.code} · {nm(l, lang)}</td><td className="num"><Money v={l.amount} /></td><td className="num muted"><Money v={prevOf(key, l.id)} /></td><td className="num muted">{change(l.amount, prevOf(key, l.id))}</td></tr>; })}
        {!lines.length && <tr className="indent"><td className="muted" colSpan={4}>{t('None', 'নেই')}</td></tr>}
        <tr><td><b>{totalLabel}</b></td><td className="num"><b><Money v={s.total} /></b></td><td className="num muted"><Money v={(p[key] as Section).total} /></td><td className="num muted">{change(s.total, (p[key] as Section).total)}</td></tr>
      </>
    );
  };
  const total = (label: string, a: number, b: number, grand = false) => { rows.push(['', label, a, b, '']); return <tr className={grand ? 'grand' : 'subtotal'}><td>{label}</td><td className="num"><Money v={a} /></td><td className="num"><Money v={b} /></td><td className="num">{change(a, b)}</td></tr>; };
  const body = (
    <table className="table">
      <thead><tr><th>{t('Account', 'হিসাব')}</th><th className="num">{fmtDate(c.from, lang)} – {fmtDate(c.to, lang)}</th><th className="num">{t('Previous', 'পূর্ববর্তী')} ({fmtDate(p.from, lang)} – {fmtDate(p.to, lang)})</th><th className="num">{t('Change', 'পরিবর্তন')}</th></tr></thead>
      <tbody>
        {sec('sales', t('Revenue', 'আয়'), t('Net sales', 'নিট বিক্রয়'))}
        {sec('cogs', t('Cost of sales', 'বিক্রয় ব্যয়'), t('Total cost of sales', 'মোট বিক্রয় ব্যয়'))}
        {total(t('Gross profit', 'মোট মুনাফা'), c.grossProfit, p.grossProfit)}
        {sec('operating', t('Operating expenses', 'পরিচালন খরচ'), t('Total operating expenses', 'মোট পরিচালন খরচ'))}
        {total(t('Operating profit', 'পরিচালন মুনাফা'), c.operatingProfit, p.operatingProfit)}
        {sec('otherIncome', t('Other income', 'অন্যান্য আয়'), t('Total other income', 'মোট অন্যান্য আয়'))}
        {sec('otherExpenses', t('Other expenses', 'অন্যান্য খরচ'), t('Total other expenses', 'মোট অন্যান্য খরচ'))}
        {total(c.netProfit >= 0 ? t('Net profit', 'নিট মুনাফা') : t('Net loss', 'নিট ক্ষতি'), c.netProfit, p.netProfit, true)}
      </tbody>
    </table>
  );
  return (
    <>
      <div className="grid g4 no-print">
        {[[t('Net sales', 'নিট বিক্রয়'), c.revenue], [t('Gross margin', 'মোট মার্জিন'), c.grossMargin, '%'], [t('Net profit', 'নিট মুনাফা'), c.netProfit], [t('Net margin', 'নিট মার্জিন'), c.netMargin, '%']].map(([l, v, pct]) => (
          <div key={l as string} className="card kpi"><div className="kpi-label">{l}</div><div className={`kpi-value ${Number(v) < 0 ? 'neg' : ''}`}>{pct ? fmtPct(v as number, lang) : fmtMoney(v as number, lang)}</div></div>
        ))}
      </div>
      <Statement title={t('Profit & loss statement', 'লাভ-ক্ষতি বিবরণী')} period={`${fmtDate(c.from, lang)} – ${fmtDate(c.to, lang)}`} onCsv={() => downloadCsv(`profit-loss_${c.from}_${c.to}.csv`, ['Section', 'Account', 'Current', 'Previous', ''], rows)}>{body}</Statement>
    </>
  );
}

function BalanceSheet({ asOf }: { asOf: string }) {
  const { t, lang } = usePrefs();
  const q = useApi<any>('/reports/balance-sheet', { asOf });
  if (!q.data) return <Loading />;
  const b = q.data;
  const csv: (string | number)[][] = [];
  const sec = (s: Section, label: string, totalLabel: string) => (
    <>
      <tr className="subtotal"><td colSpan={2}>{label}</td></tr>
      {s.lines.map(l => { csv.push([label, `${l.code ?? ''} ${l.name}`.trim(), l.amount]); return <tr key={l.id} className="indent"><td>{l.code ? `${l.code} · ` : ''}{nm(l, lang)}</td><td className="num"><Money v={l.amount} /></td></tr>; })}
      {!s.lines.length && <tr className="indent"><td className="muted" colSpan={2}>{t('None', 'নেই')}</td></tr>}
      <tr><td><b>{totalLabel}</b></td><td className="num"><b><Money v={s.total} /></b></td></tr>
    </>
  );
  return (
    <>
      {!b.balanced && <Alert tone="error">{t('The balance sheet does not balance. Check opening balances and manual journals.', 'ব্যালান্স শিট মিলছে না। প্রারম্ভিক স্থিতি ও ম্যানুয়াল জার্নাল পরীক্ষা করুন।')}</Alert>}
      <Statement title={t('Balance sheet', 'ব্যালান্স শিট')} period={t(`As of ${fmtDate(b.asOf, lang)}`, `${fmtDate(b.asOf, lang)} তারিখে`)} onCsv={() => downloadCsv(`balance-sheet_${b.asOf}.csv`, ['Section', 'Account', 'Amount'], csv)}>
        <table className="table">
          <tbody>
            {sec(b.currentAssets, t('Current assets', 'চলতি সম্পদ'), t('Total current assets', 'মোট চলতি সম্পদ'))}
            {sec(b.nonCurrentAssets, t('Non-current assets', 'স্থায়ী সম্পদ'), t('Total non-current assets', 'মোট স্থায়ী সম্পদ'))}
            <tr className="grand"><td>{t('TOTAL ASSETS', 'মোট সম্পদ')}</td><td className="num"><Money v={b.totalAssets} /></td></tr>
            {sec(b.currentLiabilities, t('Current liabilities', 'চলতি দায়'), t('Total current liabilities', 'মোট চলতি দায়'))}
            {sec(b.longTermLiabilities, t('Long-term liabilities', 'দীর্ঘমেয়াদি দায়'), t('Total long-term liabilities', 'মোট দীর্ঘমেয়াদি দায়'))}
            <tr className="subtotal"><td>{t('Total liabilities', 'মোট দায়')}</td><td className="num"><Money v={b.totalLiabilities} /></td></tr>
            {sec(b.equity, t("Owner's equity", 'মালিকের মূলধন'), t('Total equity', 'মোট মূলধন'))}
            <tr className="grand"><td>{t('TOTAL LIABILITIES & EQUITY', 'মোট দায় ও মূলধন')}</td><td className="num"><Money v={b.totalLiabilitiesAndEquity} /></td></tr>
          </tbody>
        </table>
      </Statement>
    </>
  );
}

function CashFlow({ range }: { range: Range }) {
  const { t, lang } = usePrefs();
  const q = useApi<any>('/reports/cash-flow', range);
  if (!q.data) return <Loading />;
  const c = q.data;
  const csv: (string | number)[][] = [['', 'Opening cash & bank', c.openingCash]];
  const sec = (s: { lines: { name: string; amount: number }[]; total: number }, label: string, totalLabel: string) => (
    <>
      <tr className="subtotal"><td colSpan={2}>{label}</td></tr>
      {s.lines.map(l => { csv.push([label, l.name, l.amount]); return <tr key={l.name} className="indent"><td>{l.name}</td><td className="num"><Money v={l.amount} /></td></tr>; })}
      {!s.lines.length && <tr className="indent"><td className="muted" colSpan={2}>{t('No cash movement', 'কোনো নগদ লেনদেন নেই')}</td></tr>}
      <tr><td><b>{totalLabel}</b></td><td className="num"><b><Money v={s.total} /></b></td></tr>
    </>
  );
  csv.push(['', 'Net change', c.netChange], ['', 'Closing cash & bank', c.closingCash]);
  return (
    <Statement title={t('Cash flow statement', 'নগদ প্রবাহ বিবরণী')} period={`${fmtDate(c.from, lang)} – ${fmtDate(c.to, lang)}`} onCsv={() => downloadCsv(`cash-flow_${c.from}_${c.to}.csv`, ['Section', 'Line', 'Amount'], csv)}>
      <table className="table">
        <tbody>
          <tr className="subtotal"><td>{t('Opening cash & bank balance', 'প্রারম্ভিক নগদ ও ব্যাংক স্থিতি')}</td><td className="num"><Money v={c.openingCash} /></td></tr>
          {sec(c.operating, t('Operating activities', 'পরিচালন কার্যক্রম'), t('Net cash from operating activities', 'পরিচালন কার্যক্রম থেকে নিট নগদ'))}
          {sec(c.investing, t('Investing activities', 'বিনিয়োগ কার্যক্রম'), t('Net cash from investing activities', 'বিনিয়োগ কার্যক্রম থেকে নিট নগদ'))}
          {sec(c.financing, t('Financing activities', 'অর্থায়ন কার্যক্রম'), t('Net cash from financing activities', 'অর্থায়ন কার্যক্রম থেকে নিট নগদ'))}
          <tr className="subtotal"><td>{t('Net change in cash', 'নগদের নিট পরিবর্তন')}</td><td className="num"><Money v={c.netChange} /></td></tr>
          <tr className="grand"><td>{t('Closing cash & bank balance', 'সমাপনী নগদ ও ব্যাংক স্থিতি')}</td><td className="num"><Money v={c.closingCash} /></td></tr>
        </tbody>
      </table>
    </Statement>
  );
}

function TrialBalance({ asOf }: { asOf: string }) {
  const { t, lang } = usePrefs();
  const q = useApi<any>('/reports/trial-balance', { asOf });
  if (!q.data) return <Loading />;
  const tb = q.data;
  return (
    <>
      <Alert tone={tb.balanced ? undefined : 'error'}>{tb.balanced ? t('Debits equal credits — the ledger is in balance.', 'ডেবিট ও ক্রেডিট সমান — খাতা মিলেছে।') : t('Debits and credits differ — contact support.', 'ডেবিট ও ক্রেডিট মিলছে না।')}</Alert>
      <Statement title={t('Trial balance', 'রেওয়ামিল')} period={t(`As of ${fmtDate(tb.asOf, lang)}`, `${fmtDate(tb.asOf, lang)} তারিখে`)} onCsv={() => downloadCsv(`trial-balance_${tb.asOf}.csv`, ['Code', 'Account', 'Type', 'Debit', 'Credit'], tb.lines.map((l: any) => [l.code, l.name, l.type, l.debitBalance, l.creditBalance]))}>
        <table className="table">
          <thead><tr><th>{t('Code', 'কোড')}</th><th>{t('Account', 'হিসাব')}</th><th className="num">{t('Debit', 'ডেবিট')}</th><th className="num">{t('Credit', 'ক্রেডিট')}</th></tr></thead>
          <tbody>{tb.lines.map((l: any) => <tr key={l.id}><td className="mono">{l.code}</td><td>{nm(l, lang)}</td><td className="num">{l.debitBalance ? <Money v={l.debitBalance} /> : ''}</td><td className="num">{l.creditBalance ? <Money v={l.creditBalance} /> : ''}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>{t('Total', 'মোট')}</td><td className="num"><Money v={tb.totalDebit} /></td><td className="num"><Money v={tb.totalCredit} /></td></tr></tfoot>
        </table>
      </Statement>
    </>
  );
}

function Aging({ kind, asOf }: { kind: 'ar' | 'ap'; asOf: string }) {
  const { t, lang } = usePrefs();
  const q = useApi<any>(`/reports/${kind}-aging`, { asOf });
  if (!q.data) return <Loading />;
  const a = q.data;
  const buckets: [string, string][] = [['current', t('Not yet due', 'মেয়াদ বাকি')], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90plus', '90+']];
  return (
    <Statement title={kind === 'ar' ? t('Receivables aging', 'পাওনার বয়স বিশ্লেষণ') : t('Payables aging', 'দেনার বয়স বিশ্লেষণ')} period={t(`As of ${fmtDate(a.asOf, lang)} · days overdue`, `${fmtDate(a.asOf, lang)} তারিখে · মেয়াদোত্তীর্ণ দিন`)}
      onCsv={() => downloadCsv(`${kind}-aging_${a.asOf}.csv`, ['Party', ...buckets.map(b => b[1]), 'Total'], a.rows.map((r: any) => [r.party, ...buckets.map(b => r[b[0]]), r.total]))}>
      <table className="table">
        <thead><tr><th>{kind === 'ar' ? t('Customer', 'ক্রেতা') : t('Supplier', 'সরবরাহকারী')}</th>{buckets.map(b => <th key={b[0]} className="num">{b[1]}</th>)}<th className="num">{t('Total', 'মোট')}</th></tr></thead>
        <tbody>
          {a.rows.length ? a.rows.map((r: any) => <tr key={r.partyId}><td>{r.party}</td>{buckets.map(b => <td key={b[0]} className={`num ${b[0] !== 'current' && r[b[0]] ? 'neg' : ''}`}>{r[b[0]] ? <Money v={r[b[0]]} /> : '—'}</td>)}<td className="num"><b><Money v={r.total} /></b></td></tr>)
            : <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>{t('Nothing outstanding.', 'কোনো বকেয়া নেই।')}</td></tr>}
        </tbody>
        <tfoot><tr><td>{t('Total', 'মোট')}</td>{buckets.map(b => <td key={b[0]} className="num"><Money v={a.totals[b[0]]} /></td>)}<td className="num"><Money v={a.totals.total} /></td></tr></tfoot>
      </table>
      {a.documents.length > 0 && (
        <table className="table" style={{ marginTop: 18 }}>
          <thead><tr><th>{t('Document', 'ডকুমেন্ট')}</th><th>{kind === 'ar' ? t('Customer', 'ক্রেতা') : t('Supplier', 'সরবরাহকারী')}</th><th>{t('Date', 'তারিখ')}</th><th>{t('Due', 'শেষ তারিখ')}</th><th className="num">{t('Days overdue', 'মেয়াদোত্তীর্ণ দিন')}</th><th className="num">{t('Open', 'বাকি')}</th></tr></thead>
          <tbody>{a.documents.map((d: any) => <tr key={d.id}><td className="mono">{d.number}</td><td>{d.party}</td><td>{fmtDate(d.date, lang)}</td><td>{fmtDate(d.dueDate, lang)}</td><td className={`num ${d.overdueDays ? 'neg' : ''}`}>{d.overdueDays || '—'}</td><td className="num"><Money v={d.open} /></td></tr>)}</tbody>
        </table>
      )}
    </Statement>
  );
}

function InventoryValuation() {
  const { t, lang } = usePrefs();
  const q = useApi<any>('/reports/inventory');
  if (!q.data) return <Loading />;
  const v = q.data;
  return (
    <Statement title={t('Inventory valuation', 'মজুদ মূল্যায়ন')} period={t(`As of ${fmtDate(ymd(), lang)} · weighted-average cost`, `${fmtDate(ymd(), lang)} তারিখে · ভারিত গড় মূল্য`)}
      onCsv={() => downloadCsv(`inventory_${ymd()}.csv`, ['SKU', 'Item', 'Category', 'Qty', 'Unit', 'Avg cost', 'Value'], v.rows.map((r: any) => [r.sku, r.name, r.category, r.qtyOnHand, r.unit, r.avgCost, r.value]))}>
      <table className="table">
        <thead><tr><th>SKU</th><th>{t('Item', 'পণ্য')}</th><th className="num">{t('On hand', 'হাতে')}</th><th className="num">{t('Avg cost', 'গড় মূল্য')}</th><th className="num">{t('Value', 'মূল্য')}</th></tr></thead>
        <tbody>{v.rows.map((r: any) => <tr key={r.id}><td className="mono">{r.sku}</td><td>{lang === 'bn' && r.nameBn ? r.nameBn : r.name}{!r.valued && <span className="muted small"> · {t('quantity only', 'শুধু পরিমাণ')}</span>}</td><td className="num">{fmtNum(r.qtyOnHand, lang)} {r.unit}</td><td className="num">{r.valued ? <Money v={r.avgCost} decimals={2} /> : '—'}</td><td className="num"><Money v={r.value} /></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4}>{t('Total inventory value', 'মোট মজুদ মূল্য')}</td><td className="num"><Money v={v.totalValue} /></td></tr></tfoot>
      </table>
    </Statement>
  );
}

function ProductionReport({ range }: { range: Range }) {
  const { t, lang } = usePrefs();
  const q = useApi<any>('/reports/production', range);
  if (!q.data) return <Loading />;
  const p = q.data;
  return (
    <>
      <div className="grid g4 no-print">
        {[[t('Eggs collected', 'সংগৃহীত ডিম'), fmtNum(p.totals.eggs, lang)], [t('Avg laying rate', 'গড় ডিম পাড়ার হার'), fmtPct(p.avgLayingRate, lang)], [t('Mortality', 'মৃত্যু'), fmtNum(p.totals.mortality, lang)], [t('Feed cost / egg', 'প্রতি ডিমে খাদ্য খরচ'), p.feedCostPerEgg === null ? '—' : fmtMoney(p.feedCostPerEgg, lang, { decimals: 2 })]].map(([l, v]) => (
          <div key={l} className="card kpi"><div className="kpi-label">{l}</div><div className="kpi-value">{v}</div></div>
        ))}
      </div>
      <Statement title={t('Production performance', 'উৎপাদন কার্যকারিতা')} period={`${fmtDate(p.from, lang)} – ${fmtDate(p.to, lang)}`}
        onCsv={() => downloadCsv(`production_${p.from}_${p.to}.csv`, ['Date', 'Eggs', 'Broken', 'Mortality', 'Feed qty', 'Feed cost', 'Laying rate %'], p.days.map((d: any) => [d.date, d.eggs, d.broken, d.mortality, d.feedQty, d.feedCost, d.layingRate ?? '']))}>
        <table className="table">
          <thead><tr><th>{t('Date', 'তারিখ')}</th><th className="num">{t('Eggs', 'ডিম')}</th><th className="num">{t('Broken', 'ভাঙা')}</th><th className="num">{t('Mortality', 'মৃত্যু')}</th><th className="num">{t('Feed used', 'ব্যবহৃত খাদ্য')}</th><th className="num">{t('Feed cost', 'খাদ্য খরচ')}</th><th className="num">{t('Laying rate', 'ডিম পাড়ার হার')}</th></tr></thead>
          <tbody>{p.days.length ? p.days.map((d: any) => <tr key={d.date}><td>{fmtDate(d.date, lang)}</td><td className="num">{fmtNum(d.eggs, lang)}</td><td className="num">{fmtNum(d.broken, lang)}</td><td className="num">{fmtNum(d.mortality, lang)}</td><td className="num">{fmtNum(d.feedQty, lang)}</td><td className="num"><Money v={d.feedCost} /></td><td className="num">{fmtPct(d.layingRate, lang)}</td></tr>) : <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>{t('No production in this period.', 'এই সময়ে উৎপাদন নেই।')}</td></tr>}</tbody>
          <tfoot><tr><td>{t('Total', 'মোট')}</td><td className="num">{fmtNum(p.totals.eggs, lang)}</td><td className="num">{fmtNum(p.totals.broken, lang)}</td><td className="num">{fmtNum(p.totals.mortality, lang)}</td><td className="num">{fmtNum(p.totals.feedQty, lang)}</td><td className="num"><Money v={p.totals.feedCost} /></td><td className="num">{fmtPct(p.avgLayingRate, lang)}</td></tr></tfoot>
        </table>
      </Statement>
    </>
  );
}

