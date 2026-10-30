import { useState } from 'react';
import { AlertCircle, Download, HandCoins, Plus, Printer, Receipt, ShoppingCart, Wallet } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi, useSave } from '../lib/hooks';
import { downloadCsv, fmtDate, fmtMoney, fmtNum } from '../lib/format';
import { Card, DataTable, Drawer, Kpi, Loading, PageHeader, RangePicker, SearchBox, Segmented, StatusBadge, thisMonth, VoidDialog, type Column } from '../components/ui';
import { BillDrawer, Money, PaymentDrawer } from '../components/forms';

interface Bill {
  id: string; number: string; date: string; dueDate: string | null; status: string; total: number; amountPaid: number;
  reference?: string | null; notes?: string | null; supplier: { id: string; name: string } | null;
  lines: { description: string | null; accountId: string | null }[];
}

const summary = (b: Bill) => b.lines.map(l => l.description).filter(Boolean).join(', ') || b.notes || '';

export default function Purchases() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const [range, setRange] = useState(thisMonth());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'open' | 'PAID' | 'VOID'>('all');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<null | 'bill' | 'expense'>(null);
  const [paying, setPaying] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const statusParam = status === 'all' ? undefined : status === 'open' ? 'POSTED,PARTIAL' : status;
  const list = useApi<{ data: Bill[]; total: number; totals: { total: number; paid: number } }>('/bills', { ...range, search, status: statusParam, page, pageSize: 50 });
  const aging = useApi<any>('/reports/ap-aging');
  const unpaid = (list.data?.totals.total ?? 0) - (list.data?.totals.paid ?? 0);
  const overdue = (aging.data?.totals.total ?? 0) - (aging.data?.totals.current ?? 0);

  const columns: Column<Bill>[] = [
    { key: 'number', label: t('Bill', 'বিল'), render: r => <b className="mono">{r.number}</b> },
    { key: 'date', label: t('Date', 'তারিখ'), render: r => fmtDate(r.date, lang) },
    { key: 'supplier', label: t('Supplier', 'সরবরাহকারী'), render: r => r.supplier?.name ?? <span className="muted">{t('Cash expense', 'নগদ খরচ')}</span> },
    { key: 'desc', label: t('Description', 'বিবরণ'), hideSm: true, render: r => <span className="muted small" title={summary(r)}>{summary(r).length > 48 ? `${summary(r).slice(0, 48)}…` : summary(r) || '—'}</span> },
    { key: 'due', label: t('Due', 'শেষ তারিখ'), render: r => fmtDate(r.dueDate, lang), hideSm: true },
    { key: 'status', label: t('Status', 'অবস্থা'), render: r => <StatusBadge status={r.status} /> },
    { key: 'total', label: t('Total', 'মোট'), num: true, render: r => <Money v={r.total} /> },
    { key: 'balance', label: t('Balance due', 'বাকি'), num: true, render: r => (r.status === 'VOID' ? '—' : <Money v={r.total - r.amountPaid} />) },
  ];

  const exportCsv = () => downloadCsv(`bills_${range.from}_${range.to}.csv`,
    ['Bill', 'Date', 'Supplier', 'Supplier ref', 'Description', 'Due date', 'Status', 'Total', 'Paid', 'Balance'],
    (list.data?.data ?? []).map(r => [r.number, r.date.slice(0, 10), r.supplier?.name ?? '', r.reference ?? '', summary(r), r.dueDate?.slice(0, 10) ?? '', r.status, r.total, r.amountPaid, r.status === 'VOID' ? 0 : r.total - r.amountPaid]));

  return (
    <>
      <PageHeader crumb={t('Purchases', 'ক্রয়')} title={t('Bills & expenses', 'বিল ও খরচ')}
        subtitle={t('Supplier bills and day-to-day expenses. Stocked items go to inventory; everything else is expensed and payables are tracked.', 'সরবরাহকারীর বিল ও দৈনন্দিন খরচ। মজুদযোগ্য পণ্য মজুদে যায়; বাকি সব খরচ হিসেবে লেখা হয় এবং দেনা ট্র্যাক হয়।')}
        actions={<>
          <button className="btn" onClick={exportCsv} disabled={!list.data?.data.length}><Download size={16} />{t('Export', 'ডাউনলোড')}</button>
          {can('purchases.create') && <button className="btn" onClick={() => setPaying(true)}><HandCoins size={16} />{t('Pay supplier', 'সরবরাহকারীকে পরিশোধ')}</button>}
          {can('purchases.create') && <button className="btn" onClick={() => setCreating('expense')}><Receipt size={16} />{t('Record expense', 'খরচ লিখুন')}</button>}
          {can('purchases.create') && <button className="btn primary" onClick={() => setCreating('bill')}><Plus size={16} />{t('New bill', 'নতুন বিল')}</button>}
        </>} />

      <div className="grid g4">
        <Kpi icon={ShoppingCart} label={t('Spent (period)', 'খরচ (সময়কাল)')} value={<Money v={list.data?.totals.total} />} sub={t(`${list.data?.total ?? 0} bills & expenses`, `${list.data?.total ?? 0}টি বিল ও খরচ`)} />
        <Kpi icon={Wallet} label={t('Paid on these', 'এগুলোর পরিশোধ')} value={<Money v={list.data?.totals.paid} />} sub={t(`Still unpaid: ${fmtMoney(unpaid, lang)}`, `এখনো বাকি: ${fmtMoney(unpaid, lang)}`)} />
        <Kpi icon={Receipt} tone="amber" label={t('Total payable', 'মোট দেনা')} value={<Money v={aging.data?.totals.total} />} sub={t(`Owed to ${aging.data?.rows.length ?? 0} suppliers`, `${aging.data?.rows.length ?? 0} জন সরবরাহকারীর কাছে দেনা`)} />
        <Kpi icon={AlertCircle} tone="red" label={t('Overdue', 'মেয়াদোত্তীর্ণ')} value={<Money v={overdue} />} sub={t('Past due date', 'শেষ তারিখ পার')} />
      </div>

      <Card title={t('Bills & expenses', 'বিল ও খরচ')} actions={<>
        <Segmented value={status} onChange={v => { setStatus(v); setPage(1); }} options={[{ value: 'all', label: t('All', 'সব') }, { value: 'open', label: t('Unpaid', 'বাকি') }, { value: 'PAID', label: t('Paid', 'পরিশোধিত') }, { value: 'VOID', label: t('Void', 'বাতিল') }]} />
        <SearchBox value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder={t('Bill no., supplier, note…', 'বিল নং, সরবরাহকারী, নোট…')} />
        <RangePicker value={range} onChange={r => { setRange(r); setPage(1); }} />
      </>}>
        <DataTable rows={list.data?.data} columns={columns} onRow={r => setOpenId(r.id)} page={page} pageSize={50} total={list.data?.total} onPage={setPage}
          empty={search || status !== 'all' ? t('No bills match these filters.', 'এই ফিল্টারে কোনো বিল নেই।') : t('No bills or expenses in this period yet. Use “Record expense” for cash spending or “New bill” for supplier credit.', 'এই সময়ে এখনো কোনো বিল বা খরচ নেই। নগদ খরচের জন্য “খরচ লিখুন” আর বাকিতে কেনার জন্য “নতুন বিল” ব্যবহার করুন।')} />
      </Card>

      {creating && <BillDrawer expense={creating === 'expense'} onClose={() => setCreating(null)} />}
      {paying && <PaymentDrawer direction="OUT" onClose={() => setPaying(false)} />}
      {openId && <BillDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function BillDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const { can, me } = useAuth();
  const bill = useApi<any>(`/bills/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [paying, setPaying] = useState(false);
  const voidIt = useSave<{ reason: string }>('post', `/bills/${id}/void`, t('Bill voided.', 'বিল বাতিল হয়েছে।'));
  const d = bill.data;
  const balance = d ? Number(d.total) - Number(d.amountPaid) : 0;
  return (
    <Drawer title={d ? `${t('Bill', 'বিল')} ${d.number}` : t('Bill', 'বিল')} subtitle={d ? (d.supplier?.name ?? t('Cash expense', 'নগদ খরচ')) : undefined} onClose={onClose}
      footer={d && <>
        <div className="left"><StatusBadge status={d.status} /></div>
        <button className="btn" onClick={() => window.print()}><Printer size={16} />{t('Print', 'প্রিন্ট')}</button>
        {can('purchases.void') && d.status !== 'VOID' && <button className="btn" onClick={() => setVoiding(true)}>{t('Void', 'বাতিল')}</button>}
        {can('purchases.create') && balance > 0.005 && d.status !== 'VOID' && d.supplierId && <button className="btn primary" onClick={() => setPaying(true)}><HandCoins size={16} />{t('Pay', 'পরিশোধ')}</button>}
      </>}>
      {bill.isLoading ? <Loading /> : !d ? null : <>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><h2>{me?.organization.name}</h2><div className="muted small">{t('Purchase bill', 'ক্রয় বিল')}</div></div>
          <dl className="desc-list">
            <dt>{t('Date', 'তারিখ')}</dt><dd>{fmtDate(d.date, lang)}</dd>
            <dt>{t('Due', 'শেষ তারিখ')}</dt><dd>{fmtDate(d.dueDate, lang)}</dd>
            {d.reference && <><dt>{t('Supplier ref.', 'সরবরাহকারীর বিল নং')}</dt><dd>{d.reference}</dd></>}
          </dl>
        </div>
        <div>
          <div className="muted small">{t('Supplier', 'সরবরাহকারী')}</div>
          {d.supplier ? <><b>{d.supplier.name}</b>{d.supplier.phone && <div className="small">{d.supplier.phone}</div>}</> : <span className="muted">{t('No supplier (paid in cash)', 'সরবরাহকারী নেই (নগদে পরিশোধ)')}</span>}
        </div>
        <div className="lines">
          <table>
            <thead><tr><th>{t('Description', 'বিবরণ')}</th><th className="num">{t('Qty', 'পরিমাণ')}</th><th className="num">{t('Rate', 'দর')}</th><th className="num">{t('Amount', 'টাকা')}</th></tr></thead>
            <tbody>{d.lines.map((l: any) => <tr key={l.id}><td style={{ padding: 10 }}>{l.description || '—'}</td><td className="num" style={{ padding: 10 }}>{fmtNum(l.quantity, lang)}</td><td className="num" style={{ padding: 10 }}><Money v={l.unitPrice} decimals={2} /></td><td className="num" style={{ padding: 10 }}><Money v={l.amount} /></td></tr>)}</tbody>
          </table>
        </div>
        <div className="totals">
          <span className="grand">{t('Total', 'মোট')}</span><span className="grand num"><Money v={d.total} /></span>
          <span className="muted">{t('Paid', 'পরিশোধিত')}</span><Money v={d.amountPaid} />
          <span><b>{t('Balance due', 'বাকি')}</b></span><b className="num"><Money v={d.status === 'VOID' ? 0 : balance} /></b>
        </div>
        {d.allocations.length > 0 && (
          <div>
            <h3 style={{ marginBottom: 8 }}>{t('Payments applied', 'প্রয়োগকৃত পরিশোধ')}</h3>
            <div className="lines"><table><tbody>{d.allocations.map((a: any) => <tr key={a.id} className={a.payment.status === 'VOID' ? 'void' : ''}><td style={{ padding: 10 }} className="mono">{a.payment.number}</td><td style={{ padding: 10 }}>{fmtDate(a.payment.date, lang)}</td><td style={{ padding: 10 }}>{a.payment.status === 'VOID' ? <StatusBadge status="VOID" /> : a.payment.method}</td><td className="num" style={{ padding: 10 }}><Money v={a.amount} /></td></tr>)}</tbody></table></div>
          </div>
        )}
        {d.notes && <div className="muted small">{d.notes}</div>}
      </>}
      {voiding && <VoidDialog what={t('bill', 'বিল')} busy={voidIt.isPending} onClose={() => setVoiding(false)} onConfirm={reason => voidIt.mutate({ reason }, { onSuccess: () => { setVoiding(false); onClose(); } })} />}
      {paying && d && <PaymentDrawer direction="OUT" partyId={d.supplierId} onClose={() => setPaying(false)} />}
    </Drawer>
  );
}
