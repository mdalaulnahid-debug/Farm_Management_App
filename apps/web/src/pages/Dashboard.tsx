import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Bird, CircleDollarSign, Egg, Landmark, Package, Receipt, TrendingUp, Truck, Wallet } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtPct } from '../lib/format';
import { Alert, Card, Empty, Kpi, Loading, PageHeader, RangePicker, thisMonth } from '../components/ui';
import { Money } from '../components/forms';

const axis = { fontSize: 12, fill: 'var(--text-3)' };

function ChartTip({ active, payload, label, lang, money = true }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card" style={{ padding: '8px 12px', boxShadow: 'var(--shadow)' }}>
      <div className="small muted" style={{ marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => <div key={p.dataKey} className="small"><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color, marginRight: 6 }} />{p.name}: <b>{money ? fmtMoney(p.value, lang) : fmtNum(p.value, lang, 1)}</b></div>)}
    </div>
  );
}

export default function Dashboard() {
  const { t, lang } = usePrefs();
  const { me, can } = useAuth();
  const [range, setRange] = useState(thisMonth());
  const q = useApi<any>('/dashboard', range);
  const flocks = useApi<any>(can('production.view') ? '/flocks' : null);
  const d = q.data;
  const k = d?.kpis;
  const showMoney = can('reports.view');
  const monthLabel = (m: string) => new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  const noBirds = (flocks.data?.data ?? []).some((f: any) => f.status === 'ACTIVE' && f.currentCount === 0);
  const maxExpense = Math.max(1, ...(d?.expenseBreakdown ?? []).map((e: any) => e.amount));

  return (
    <>
      <PageHeader title={t(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${me?.user.name.split(' ')[0]}`, `স্বাগতম, ${me?.user.name.split(' ')[0]}`)}
        subtitle={t(`${me?.organization.name} — business overview from the posted ledger.`, `${me?.organization.name} — পোস্ট করা খাতা থেকে ব্যবসার সারসংক্ষেপ।`)}
        actions={<RangePicker value={range} onChange={setRange} />} />

      {(noBirds || (k?.overdueCount ?? 0) > 0 || (d?.lowStock?.length ?? 0) > 0) && (
        <div className="stack">
          {noBirds && <Alert tone="warn">{t('An active flock has 0 birds recorded. Set the bird count in Production → Flocks so laying rate and mortality % can be calculated.', 'একটি সক্রিয় ঝাঁকে ০টি পাখি লেখা আছে। ডিম পাড়ার হার হিসাবের জন্য উৎপাদন → ঝাঁক-এ পাখির সংখ্যা দিন।')} <Link to="/production">{t('Open flocks', 'ঝাঁক খুলুন')}</Link></Alert>}
          {(k?.overdueCount ?? 0) > 0 && <Alert tone="warn">{t(`${k.overdueCount} invoice(s) are overdue, totalling ${fmtMoney(k.overdueAmount, lang)}.`, `${k.overdueCount}টি চালান মেয়াদোত্তীর্ণ, মোট ${fmtMoney(k.overdueAmount, lang)}।`)} <Link to="/customers">{t('Review receivables', 'পাওনা দেখুন')}</Link></Alert>}
          {(d?.lowStock?.length ?? 0) > 0 && <Alert tone="warn">{t('Low stock: ', 'মজুদ কম: ')}{d.lowStock.map((i: any) => `${i.name} (${fmtNum(i.qtyOnHand, lang)} ${i.unit})`).join(', ')}</Alert>}
        </div>
      )}

      {!d ? <Loading /> : <>
        {showMoney && (
          <div className="grid g4">
            <Kpi icon={TrendingUp} label={t('Sales revenue', 'বিক্রয় আয়')} value={<Money v={k.revenue} />} sub={k.totalIncome !== k.revenue ? t(`Total income ${fmtMoney(k.totalIncome, lang)}`, `মোট আয় ${fmtMoney(k.totalIncome, lang)}`) : t('Net of discounts', 'ছাড় বাদে')} />
            <Kpi icon={Receipt} tone="amber" label={t('Expenses', 'খরচ')} value={<Money v={k.expenses} />} sub={t('Costs incurred in the period', 'সময়কালে সংঘটিত খরচ')} />
            <Kpi icon={k.netProfit >= 0 ? ArrowUpRight : ArrowDownRight} tone={k.netProfit >= 0 ? undefined : 'red'} label={t('Net profit', 'নিট মুনাফা')} value={<Money v={k.netProfit} />} sub={t(`Net margin ${fmtPct(k.netMargin, lang)}`, `নিট মার্জিন ${fmtPct(k.netMargin, lang)}`)} />
            <Kpi icon={Wallet} tone="blue" label={t('Cash & bank', 'নগদ ও ব্যাংক')} value={<Money v={k.cash + k.bank} />} sub={t(`Cash ${fmtMoney(k.cash, lang)} · Bank ${fmtMoney(k.bank, lang)}`, `নগদ ${fmtMoney(k.cash, lang)} · ব্যাংক ${fmtMoney(k.bank, lang)}`)} />
          </div>
        )}
        <div className="grid g4">
          <Kpi icon={Egg} label={t('Eggs collected', 'সংগৃহীত ডিম')} value={fmtNum(k.eggsProduced, lang)} sub={t(`${fmtNum(k.eggsSold, lang)} sold`, `${fmtNum(k.eggsSold, lang)}টি বিক্রি`)} />
          <Kpi icon={Bird} tone="amber" label={t('Laying rate', 'ডিম পাড়ার হার')} value={fmtPct(k.avgLayingRate, lang)} sub={t(`${fmtNum(k.birds, lang)} birds · ${fmtNum(k.mortality, lang)} lost`, `${fmtNum(k.birds, lang)}টি পাখি · ${fmtNum(k.mortality, lang)}টি মৃত`)} />
          {showMoney ? <>
            <Kpi icon={CircleDollarSign} tone="blue" label={t('Receivables', 'পাওনা')} value={<Money v={k.receivables} />} sub={k.overdueCount ? t(`${fmtMoney(k.overdueAmount, lang)} overdue`, `${fmtMoney(k.overdueAmount, lang)} মেয়াদোত্তীর্ণ`) : t('Nothing overdue', 'মেয়াদোত্তীর্ণ নেই')} />
            <Kpi icon={Truck} tone="red" label={t('Payables', 'দেনা')} value={<Money v={k.payables} />} sub={t(`Stock value ${fmtMoney(k.inventoryValue, lang)}`, `মজুদ মূল্য ${fmtMoney(k.inventoryValue, lang)}`)} />
          </> : <Kpi icon={Package} label={t('Feed cost / egg', 'প্রতি ডিমে খাদ্য খরচ')} value={k.feedCostPerEgg === null ? '—' : fmtMoney(k.feedCostPerEgg, lang, { decimals: 2 })} />}
        </div>

        {showMoney && (
          <div className="grid g3">
            <Card className="span2" title={t('Income vs expenses — last 12 months', 'আয় বনাম খরচ — গত ১২ মাস')} actions={<div className="legend"><span><i style={{ background: 'var(--chart-1)' }} />{t('Income', 'আয়')}</span><span><i style={{ background: 'var(--chart-2)' }} />{t('Expenses', 'খরচ')}</span><span><i style={{ background: 'var(--chart-3)' }} />{t('Profit', 'মুনাফা')}</span></div>}>
              <div className="chart-box">
                <ResponsiveContainer>
                  <ComposedChart data={d.trend.map((m: any) => ({ ...m, label: monthLabel(m.month) }))} margin={{ left: 8, right: 8, top: 12 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                    <YAxis tick={axis} axisLine={false} tickLine={false} width={64} tickFormatter={v => fmtMoney(v, lang).replace('৳', '')} />
                    <Tooltip content={<ChartTip lang={lang} />} cursor={{ fill: 'var(--surface-3)' }} />
                    <Bar dataKey="income" name={t('Income', 'আয়')} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                    <Bar dataKey="expenses" name={t('Expenses', 'খরচ')} fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                    <Line dataKey="profit" name={t('Profit', 'মুনাফা')} stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={t('Where the money went', 'টাকা কোথায় খরচ হলো')} subtitle={fmtDate(d.from, lang) + ' – ' + fmtDate(d.to, lang)}>
              <div className="card-body">
                {d.expenseBreakdown.length ? <div className="bar-list">{d.expenseBreakdown.map((e: any) => (
                  <div key={e.id} className="bar-row"><span>{lang === 'bn' && e.nameBn ? e.nameBn : e.name}</span><b className="num">{fmtMoney(e.amount, lang)}</b><div className="bar"><i style={{ width: `${(e.amount / maxExpense) * 100}%` }} /></div></div>
                ))}</div> : <Empty>{t('No expenses in this period.', 'এই সময়ে কোনো খরচ নেই।')}</Empty>}
              </div>
            </Card>
          </div>
        )}

        <div className="grid g3">
          <Card className="span2" title={t('Daily egg collection', 'দৈনিক ডিম সংগ্রহ')} actions={<Link to="/production" className="small">{t('Production log →', 'উৎপাদন খাতা →')}</Link>}>
            {d.production.length ? (
              <div className="chart-box">
                <ResponsiveContainer>
                  <ComposedChart data={d.production.map((p: any) => ({ ...p, label: fmtDate(p.date, lang).slice(0, 6) }))} margin={{ left: 8, right: 8, top: 12 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                    <YAxis tick={axis} axisLine={false} tickLine={false} width={48} />
                    <Tooltip content={<ChartTip lang={lang} money={false} />} cursor={{ fill: 'var(--surface-3)' }} />
                    <Area dataKey="eggs" name={t('Eggs', 'ডিম')} stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
                    <Bar dataKey="broken" name={t('Broken', 'ভাঙা')} fill="var(--chart-5)" maxBarSize={12} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty icon={Egg}>{t('No production recorded in this period.', 'এই সময়ে উৎপাদন লেখা হয়নি।')}</Empty>}
          </Card>
          <Card title={t('Stock on hand', 'হাতে মজুদ')} actions={<Link to="/inventory" className="small">{t('Inventory →', 'মজুদ →')}</Link>}>
            {d.stock.length ? <table className="table"><tbody>{d.stock.map((s: any) => (
              <tr key={s.id}><td>{lang === 'bn' && s.nameBn ? s.nameBn : s.name}{s.low && <span className="badge red" style={{ marginLeft: 6 }}>{t('Low', 'কম')}</span>}</td><td className="num">{fmtNum(s.qtyOnHand, lang)} <span className="muted small">{s.unit}</span></td></tr>
            ))}</tbody></table> : <Empty icon={Package}>{t('No stocked items yet.', 'এখনো কোনো মজুদ পণ্য নেই।')}</Empty>}
          </Card>
        </div>

        <div className="grid g2">
          {showMoney && (
            <Card title={t('Top customers', 'শীর্ষ ক্রেতা')} subtitle={t('By invoiced amount in the period', 'সময়কালে চালানের পরিমাণ অনুযায়ী')}>
              {d.topCustomers.length ? <table className="table"><tbody>{d.topCustomers.map((c: any, i: number) => <tr key={i}><td>{c.name}</td><td className="num"><Money v={c.total} /></td></tr>)}</tbody></table> : <Empty icon={Landmark}>{t('No sales in this period.', 'এই সময়ে বিক্রি নেই।')}</Empty>}
            </Card>
          )}
          <Card title={t('Recent activity', 'সাম্প্রতিক কার্যক্রম')}>
            {d.recent.length ? <div className="activity">{d.recent.map((r: any) => (
              <div key={r.id}><span className={`dot ${r.action === 'void' ? 'red' : ''}`} /><div><div>{r.summary}</div><div className="muted small">{r.user} · {fmtDateTime(r.at, lang)}</div></div></div>
            ))}</div> : <Empty icon={AlertTriangle}>{t('No activity yet.', 'এখনো কোনো কার্যক্রম নেই।')}</Empty>}
          </Card>
        </div>
      </>}
    </>
  );
}
