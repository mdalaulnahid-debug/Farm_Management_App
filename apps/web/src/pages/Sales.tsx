import { useState } from 'react';
import { AlertCircle, Download, FileText, Plus, Printer, Receipt, Wallet } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi, useSave } from '../lib/hooks';
import { downloadCsv, fmtDate, fmtNum } from '../lib/format';
import { Card, DataTable, Drawer, Kpi, PageHeader, RangePicker, SearchBox, Segmented, StatusBadge, thisMonth, VoidDialog, type Column } from '../components/ui';
import { InvoiceDrawer, Money, PaymentDrawer } from '../components/forms';


interface Invoice { id: string; number: string; date: string; dueDate: string; status: string; subtotal: number; discount: number; total: number; amountPaid: number; reference?: string; notes?: string; customer: { id: string; name: string } }

export default function Sales() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const [range, setRange] = useState(thisMonth());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'open' | 'PAID' | 'VOID'>('all');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const statusParam = status === 'all' ? undefined : status === 'open' ? 'POSTED,PARTIAL' : status;
  const list = useApi<{ data: Invoice[]; total: number; totals: { total: number; paid: number } }>('/invoices', { ...range, search, status: statusParam, page, pageSize: 50 });
  const aging = useApi<any>('/reports/ar-aging');

  const columns: Column<Invoice>[] = [
    { key: 'number', label: t('Invoice', 'ইনভয়েস'), render: r => <b className="mono">{r.number}</b> },
    { key: 'date', label: t('Date', 'তারিখ'), render: r => fmtDate(r.date, lang) },
    { key: 'customer', label: t('Customer', 'ক্রেতা'), render: r => r.customer.name },
    { key: 'due', label: t('Due', 'শেষ তারিখ'), render: r => fmtDate(r.dueDate, lang), hideSm: true },
    { key: 'status', label: t('Status', 'অবস্থা'), render: r => <StatusBadge status={r.status} /> },
    { key: 'total', label: t('Total', 'মোট'), num: true, render: r => <Money v={r.total} /> },
    { key: 'balance', label: t('Balance due', 'বাকি'), num: true, render: r => (r.status === 'VOID' ? '—' : <Money v={r.total - r.amountPaid} />) },
  ];

  const exportCsv = () => downloadCsv(`invoices_${range.from}_${range.to}.csv`,
    ['Invoice', 'Date', 'Customer', 'Due date', 'Status', 'Subtotal', 'Discount', 'Total', 'Paid', 'Balance'],
    (list.data?.data ?? []).map(r => [r.number, r.date.slice(0, 10), r.customer.name, r.dueDate.slice(0, 10), r.status, r.subtotal, r.discount, r.total, r.amountPaid, r.total - r.amountPaid]));

  return (
    <>
      <PageHeader crumb={t('Sales', 'বিক্রয়')} title={t('Sales invoices', 'বিক্রয় ইনভয়েস')} subtitle={t('Every sale posts revenue, updates receivables and reduces stock automatically.', 'প্রতিটি বিক্রয় স্বয়ংক্রিয়ভাবে আয় পোস্ট করে, পাওনা হালনাগাদ করে এবং মজুদ কমায়।')}
        actions={<>
          <button className="btn" onClick={exportCsv}><Download size={16} />{t('Export', 'রপ্তানি')}</button>
          {can('sales.create') && <button className="btn" onClick={() => setReceiving(true)}><Receipt size={16} />{t('Receive payment', 'টাকা আদায়')}</button>}
          {can('sales.create') && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />{t('New invoice', 'নতুন ইনভয়েস')}</button>}
        </>} />

      <div className="grid g4">
        <Kpi icon={FileText} label={t('Invoiced (period)', 'ইনভয়েস (সময়কাল)')} value={<Money v={list.data?.totals.total} />} sub={t(`${list.data?.total ?? 0} invoices`, `${list.data?.total ?? 0}টি ইনভয়েস`)} />
        <Kpi icon={Wallet} label={t('Collected on these', 'এগুলোর আদায়')} value={<Money v={list.data?.totals.paid} />} />
        <Kpi icon={Receipt} tone="amber" label={t('Total receivable', 'মোট পাওনা')} value={<Money v={aging.data?.totals.total} />} sub={t(`${aging.data?.rows.length ?? 0} customers owe`, `${aging.data?.rows.length ?? 0} জন ক্রেতার কাছে বাকি`)} />
        <Kpi icon={AlertCircle} tone="red" label={t('Overdue', 'মেয়াদোত্তীর্ণ')} value={<Money v={(aging.data?.totals.total ?? 0) - (aging.data?.totals.current ?? 0)} />} sub={t('Past due date', 'শেষ তারিখ পার')} />
      </div>

      <Card title={t('Invoices', 'ইনভয়েস')} actions={<>
        <Segmented value={status} onChange={v => { setStatus(v); setPage(1); }} options={[{ value: 'all', label: t('All', 'সব') }, { value: 'open', label: t('Unpaid', 'বাকি') }, { value: 'PAID', label: t('Paid', 'পরিশোধিত') }, { value: 'VOID', label: t('Void', 'বাতিল') }]} />
        <SearchBox value={search} onChange={v => { setSearch(v); setPage(1); }} />
        <RangePicker value={range} onChange={r => { setRange(r); setPage(1); }} />
      </>}>
        <DataTable rows={list.data?.data} columns={columns} onRow={r => setOpenId(r.id)} page={page} pageSize={50} total={list.data?.total} onPage={setPage} />
      </Card>

      {creating && <InvoiceDrawer onClose={() => setCreating(false)} />}
      {receiving && <PaymentDrawer direction="IN" onClose={() => setReceiving(false)} />}
      {openId && <InvoiceDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function InvoiceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const { can, me } = useAuth();
  const inv = useApi<any>(`/invoices/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const voidIt = useSave<{ reason: string }>('post', `/invoices/${id}/void`, t('Invoice voided.', 'ইনভয়েস বাতিল হয়েছে।'));
  const d = inv.data;
  const balance = d ? d.total - d.amountPaid : 0;
  return (
    <Drawer title={d ? `${t('Invoice', 'ইনভয়েস')} ${d.number}` : t('Invoice', 'ইনভয়েস')} subtitle={d?.customer.name} onClose={onClose}
      footer={d && <>
        <div className="left"><StatusBadge status={d.status} /></div>
        <button className="btn" onClick={() => window.print()}><Printer size={16} />{t('Print', 'প্রিন্ট')}</button>
        {can('sales.void') && d.status !== 'VOID' && <button className="btn" onClick={() => setVoiding(true)}>{t('Void', 'বাতিল')}</button>}
        {can('sales.create') && balance > 0.005 && d.status !== 'VOID' && <button className="btn primary" onClick={() => setReceiving(true)}>{t('Receive payment', 'টাকা আদায়')}</button>}
      </>}>
      {!d ? null : <>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><h2>{me?.organization.name}</h2><div className="muted small">{[me?.organization.address, me?.organization.phone].filter(Boolean).join(' · ')}</div></div>
          <dl className="desc-list">
            <dt>{t('Date', 'তারিখ')}</dt><dd>{fmtDate(d.date, lang)}</dd>
            <dt>{t('Due', 'শেষ তারিখ')}</dt><dd>{fmtDate(d.dueDate, lang)}</dd>
            {d.reference && <><dt>{t('Reference', 'রেফারেন্স')}</dt><dd>{d.reference}</dd></>}
          </dl>
        </div>
        <div><div className="muted small">{t('Bill to', 'ক্রেতা')}</div><b>{d.customer.name}</b>{d.customer.phone && <div className="small">{d.customer.phone}</div>}</div>
        <div className="lines">
          <table>
            <thead><tr><th>{t('Description', 'বিবরণ')}</th><th className="num">{t('Qty', 'পরিমাণ')}</th><th className="num">{t('Rate', 'দর')}</th><th className="num">{t('Amount', 'টাকা')}</th></tr></thead>
            <tbody>{d.lines.map((l: any) => <tr key={l.id}><td style={{ padding: '10px' }}>{l.description}</td><td className="num" style={{ padding: 10 }}>{fmtNum(l.quantity, lang)}</td><td className="num" style={{ padding: 10 }}><Money v={l.unitPrice} decimals={2} /></td><td className="num" style={{ padding: 10 }}><Money v={l.amount} /></td></tr>)}</tbody>
          </table>
        </div>
        <div className="totals">
          <span className="muted">{t('Subtotal', 'উপমোট')}</span><Money v={d.subtotal} />
          {d.discount > 0 && <><span className="muted">{t('Discount', 'ছাড়')}</span><Money v={-d.discount} /></>}
          <span className="grand">{t('Total', 'মোট')}</span><span className="grand num"><Money v={d.total} /></span>
          <span className="muted">{t('Paid', 'পরিশোধিত')}</span><Money v={d.amountPaid} />
          <span><b>{t('Balance due', 'বাকি')}</b></span><b className="num"><Money v={balance} /></b>
        </div>
        {d.allocations.length > 0 && (
          <div>
            <h3 style={{ marginBottom: 8 }}>{t('Payments applied', 'প্রয়োগকৃত পরিশোধ')}</h3>
            <div className="lines"><table><tbody>{d.allocations.map((a: any) => <tr key={a.id} className={a.payment.status === 'VOID' ? 'void' : ''}><td style={{ padding: 10 }} className="mono">{a.payment.number}</td><td style={{ padding: 10 }}>{fmtDate(a.payment.date, lang)}</td><td style={{ padding: 10 }}>{a.payment.status === 'VOID' ? <StatusBadge status="VOID" /> : a.payment.method}</td><td className="num" style={{ padding: 10 }}><Money v={a.amount} /></td></tr>)}</tbody></table></div>
          </div>
        )}
        {d.notes && <div className="muted small">{d.notes}</div>}
        {me?.organization.invoiceFooter && <div className="muted small" style={{ textAlign: 'center' }}>{me.organization.invoiceFooter}</div>}
      </>}
      {voiding && <VoidDialog what={t('invoice', 'ইনভয়েস')} busy={voidIt.isPending} onClose={() => setVoiding(false)} onConfirm={reason => voidIt.mutate({ reason }, { onSuccess: () => { setVoiding(false); onClose(); } })} />}
      {receiving && d && <PaymentDrawer direction="IN" partyId={d.customerId} onClose={() => setReceiving(false)} />}
    </Drawer>
  );
}
