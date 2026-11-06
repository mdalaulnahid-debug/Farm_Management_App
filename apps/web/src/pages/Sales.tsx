import { useState } from 'react';
import { AlertCircle, Download, FileText, Plus, Printer, QrCode, Receipt, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi, useSave } from '../lib/hooks';
import { downloadCsv, fmtDate } from '../lib/format';
import { Card, DataTable, Drawer, Kpi, PageHeader, RangePicker, SearchBox, Segmented, StatusBadge, thisMonth, VoidDialog, type Column } from '../components/ui';
import { salesMarket } from '../assets/photos';
import { AllocationsTable, DocLinesTable, InvoiceDrawer, Money, PaymentDrawer } from '../components/forms';
import { DocPaper, docQr, docStatus } from '../components/DocPaper';


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
    { key: 'number', label: t('Invoice', 'চালান'), render: r => <b className="mono">{r.number}</b> },
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
      <PageHeader photo={salesMarket.full} photoSmall={salesMarket.small} photoPos="center 55%" crumb={t('Sales', 'বিক্রয়')} title={t('Sales invoices', 'বিক্রয় চালান')} subtitle={t('Every sale posts revenue, updates receivables and reduces stock automatically.', 'প্রতিটি বিক্রয় স্বয়ংক্রিয়ভাবে আয় পোস্ট করে, পাওনা হালনাগাদ করে এবং মজুদ কমায়।')}
        actions={<>
          <button className="btn" onClick={exportCsv}><Download size={16} />{t('Export', 'ডাউনলোড')}</button>
          {can('sales.create') && <Link className="btn" to="/sell/stickers"><QrCode size={16} />{t('QR stickers', 'কিউআর স্টিকার')}</Link>}
          {can('sales.create') && <button className="btn" onClick={() => setReceiving(true)}><Receipt size={16} />{t('Receive payment', 'টাকা আদায়')}</button>}
          {can('sales.create') && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />{t('New invoice', 'নতুন চালান')}</button>}
        </>} />

      <div className="grid g4">
        <Kpi icon={FileText} label={t('Invoiced (period)', 'চালান (সময়কাল)')} value={<Money v={list.data?.totals.total} />} sub={t(`${list.data?.total ?? 0} invoices`, `${list.data?.total ?? 0}টি চালান`)} />
        <Kpi icon={Wallet} label={t('Collected on these', 'এগুলোর আদায়')} value={<Money v={list.data?.totals.paid} />} />
        <Kpi icon={Receipt} tone="amber" label={t('Total receivable', 'মোট পাওনা')} value={<Money v={aging.data?.totals.total} />} sub={t(`${aging.data?.rows.length ?? 0} customers owe`, `${aging.data?.rows.length ?? 0} জন ক্রেতার কাছে বাকি`)} />
        <Kpi icon={AlertCircle} tone="red" label={t('Overdue', 'মেয়াদোত্তীর্ণ')} value={<Money v={(aging.data?.totals.total ?? 0) - (aging.data?.totals.current ?? 0)} />} sub={t('Past due date', 'শেষ তারিখ পার')} />
      </div>

      <Card title={t('Invoices', 'চালান')} actions={<>
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
  const voidIt = useSave<{ reason: string }>('post', `/invoices/${id}/void`, t('Invoice voided.', 'চালান বাতিল হয়েছে।'));
  const d = inv.data;
  const balance = d ? d.total - d.amountPaid : 0;
  return (
    <Drawer title={d ? `${t('Invoice', 'চালান')} ${d.number}` : t('Invoice', 'চালান')} subtitle={d?.customer.name} onClose={onClose}
      footer={d && <>
        <div className="left"><StatusBadge status={d.status} /></div>
        <button className="btn" onClick={() => window.print()}><Printer size={16} />{t('Print', 'প্রিন্ট')}</button>
        {can('sales.void') && d.status !== 'VOID' && <button className="btn" onClick={() => setVoiding(true)}>{t('Void', 'বাতিল')}</button>}
        {can('sales.create') && balance > 0.005 && d.status !== 'VOID' && <button className="btn primary" onClick={() => setReceiving(true)}>{t('Receive payment', 'টাকা আদায়')}</button>}
      </>}>
      {!d ? null : (
        <DocPaper kind={t('Invoice', 'চালান')} number={d.number} status={docStatus(t, d.status)}
          party={{ label: t('Bill to', 'ক্রেতা'), name: d.customer.name, lines: [d.customer.phone, d.customer.address] }}
          meta={[[t('Date', 'তারিখ'), fmtDate(d.date, lang)], [t('Due', 'শেষ তারিখ'), fmtDate(d.dueDate, lang)], ...(d.reference ? [[t('Reference', 'রেফারেন্স'), d.reference] as [string, string]] : [])]}
          qr={docQr(me?.organization.name, 'Invoice', d.number, d.date, d.total, balance, d.status)}>
          <DocLinesTable lines={d.lines} />
          <div className="totals">
            <span className="muted">{t('Subtotal', 'উপমোট')}</span><Money v={d.subtotal} />
            {d.discount > 0 && <><span className="muted">{t('Discount', 'ছাড়')}</span><Money v={-d.discount} /></>}
            <span className="grand">{t('Total', 'মোট')}</span><span className="grand num"><Money v={d.total} /></span>
            <span className="muted">{t('Paid', 'পরিশোধিত')}</span><Money v={d.amountPaid} />
            <span className="due">{t('Balance due', 'বাকি')}</span><span className="due num"><Money v={d.status === 'VOID' ? 0 : balance} /></span>
          </div>
          <AllocationsTable allocations={d.allocations} />
          {d.notes && <div className="doc-notes">{d.notes}</div>}
        </DocPaper>
      )}
      {voiding && <VoidDialog what={t('invoice', 'চালান')} busy={voidIt.isPending} onClose={() => setVoiding(false)} onConfirm={reason => voidIt.mutate({ reason }, { onSuccess: () => { setVoiding(false); onClose(); } })} />}
      {receiving && d && <PaymentDrawer direction="IN" partyId={d.customerId} onClose={() => setReceiving(false)} />}
    </Drawer>
  );
}
