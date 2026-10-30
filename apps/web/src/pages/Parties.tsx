import { useMemo, useState } from 'react';
import { Download, HandCoins, Pencil, Plus, Receipt } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi, useSave } from '../lib/hooks';
import type { Party } from '../lib/api';
import { downloadCsv, fmtDate, fmtMoney } from '../lib/format';
import { Alert, Badge, Card, DataTable, Drawer, Empty, Field, Input, Loading, PageHeader, SearchBox, Segmented, Select, StatusBadge, type Column } from '../components/ui';
import { Money, PaymentDrawer } from '../components/forms';

type Kind = 'CUSTOMER' | 'SUPPLIER';
type PartyRow = Party & { receivable: number; payable: number };

export default function Parties({ kind }: { kind: Kind }) {
  const { t } = usePrefs();
  const { can } = useAuth();
  const isCust = kind === 'CUSTOMER';
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'active' | 'owing' | 'inactive' | 'all'>('active');
  const [editing, setEditing] = useState<PartyRow | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const list = useApi<{ data: PartyRow[] }>('/parties', { kind, withBalance: 1, search: search || undefined });
  const agingPerm = isCust ? 'sales.view' : 'purchases.view';
  const aging = useApi<any>(can(agingPerm) ? (isCust ? '/reports/ar-aging' : '/reports/ap-aging') : null);

  const bal = (p: PartyRow) => Number(isCust ? p.receivable : p.payable) || 0;
  const rows = useMemo(() => (list.data?.data ?? []).filter(p =>
    show === 'all' ? true : show === 'inactive' ? !p.active : show === 'owing' ? bal(p) > 0.005 : p.active,
  ), [list.data, show]); // eslint-disable-line react-hooks/exhaustive-deps

  const terms = (d: number) => (d > 0 ? t(`Net ${d} days`, `${d} দিন`) : t('Due on receipt', 'তাৎক্ষণিক'));
  const columns: Column<PartyRow>[] = [
    { key: 'name', label: t('Name', 'নাম'), render: r => <div><b>{r.name}</b>{r.kind === 'BOTH' && <> <Badge tone="blue">{t('Customer & supplier', 'ক্রেতা ও সরবরাহকারী')}</Badge></>}{r.email && <div className="muted small">{r.email}</div>}</div> },
    { key: 'phone', label: t('Phone', 'ফোন'), render: r => r.phone || <span className="muted">—</span> },
    { key: 'terms', label: t('Terms', 'শর্ত'), hideSm: true, render: r => terms(r.paymentTerms) },
    {
      key: 'balance', label: isCust ? t('Receivable', 'পাওনা') : t('Payable', 'দেনা'), num: true, render: r => <>
        <Money v={bal(r)} />
        {isCust && r.creditLimit != null && Number(r.creditLimit) > 0 && bal(r) > Number(r.creditLimit) && <div><Badge tone="red">{t('Over credit limit', 'বাকির সীমা পার')}</Badge></div>}
      </>,
    },
    { key: 'status', label: t('Status', 'অবস্থা'), render: r => (r.active ? <Badge tone="green">{t('Active', 'সক্রিয়')}</Badge> : <Badge>{t('Inactive', 'নিষ্ক্রিয়')}</Badge>) },
  ];

  const exportCsv = () => downloadCsv(`${isCust ? 'customers' : 'suppliers'}.csv`,
    ['Name', 'Kind', 'Phone', 'Email', 'Address', 'Tax ID', 'Payment terms (days)', 'Credit limit', isCust ? 'Receivable' : 'Payable', 'Active'],
    rows.map(r => [r.name, r.kind, r.phone ?? '', r.email ?? '', r.address ?? '', r.taxId ?? '', r.paymentTerms, r.creditLimit ?? '', bal(r), r.active ? 'Yes' : 'No']));

  const totalBal = rows.reduce((a, r) => a + bal(r), 0);
  const B = aging.data?.totals;

  return (
    <>
      <PageHeader crumb={isCust ? t('Sales', 'বিক্রয়') : t('Purchases', 'ক্রয়')} title={isCust ? t('Customers', 'ক্রেতা') : t('Suppliers', 'সরবরাহকারী')}
        subtitle={isCust ? t('Everyone you sell to, what they owe you and their full history.', 'যাদের কাছে বিক্রি করেন, তাদের কাছে পাওনা ও সম্পূর্ণ লেনদেনের ইতিহাস।') : t('Everyone you buy from, what you owe them and their full history.', 'যাদের কাছ থেকে কেনেন, তাদের কাছে দেনা ও সম্পূর্ণ লেনদেনের ইতিহাস।')}
        actions={<>
          <button className="btn" onClick={exportCsv} disabled={!rows.length}><Download size={16} />{t('Export', 'রপ্তানি')}</button>
          {isCust && can('sales.create') && <button className="btn" onClick={() => setPaying(true)}><Receipt size={16} />{t('Receive payment', 'টাকা আদায়')}</button>}
          {!isCust && can('purchases.create') && <button className="btn" onClick={() => setPaying(true)}><HandCoins size={16} />{t('Pay supplier', 'সরবরাহকারীকে পরিশোধ')}</button>}
          {can('parties.manage') && <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} />{isCust ? t('New customer', 'নতুন ক্রেতা') : t('New supplier', 'নতুন সরবরাহকারী')}</button>}
        </>} />

      {can(agingPerm) && (
        <Card title={isCust ? t('Receivables ageing', 'পাওনার বয়স বিশ্লেষণ') : t('Payables ageing', 'দেনার বয়স বিশ্লেষণ')}
          subtitle={isCust ? t('Unpaid invoices by days past due date', 'শেষ তারিখ পার হওয়ার দিন অনুযায়ী অপরিশোধিত ইনভয়েস') : t('Unpaid bills by days past due date', 'শেষ তারিখ পার হওয়ার দিন অনুযায়ী অপরিশোধিত বিল')}>
          {!B ? <Loading /> : (
            <div className="card-body">
              <div className="grid g3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                {([
                  ['current', t('Not yet due', 'মেয়াদ বাকি')],
                  ['d1_30', t('1–30 days', '১–৩০ দিন')],
                  ['d31_60', t('31–60 days', '৩১–৬০ দিন')],
                  ['d61_90', t('61–90 days', '৬১–৯০ দিন')],
                  ['d90plus', t('Over 90 days', '৯০ দিনের বেশি')],
                  ['total', t('Total outstanding', 'মোট বকেয়া')],
                ] as const).map(([k, label]) => (
                  <div key={k} className="stack" style={{ gap: 2 }}>
                    <span className="muted small">{label}</span>
                    <b className={k === 'd90plus' && B[k] > 0 ? 'neg' : ''} style={{ fontSize: k === 'total' ? '1.25em' : undefined }}><Money v={B[k]} /></b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card title={<>{isCust ? t('Customer list', 'ক্রেতার তালিকা') : t('Supplier list', 'সরবরাহকারীর তালিকা')} <span className="muted small">· {rows.length}</span></>}
        actions={<>
          <Segmented value={show} onChange={setShow} options={[
            { value: 'active', label: t('Active', 'সক্রিয়') },
            { value: 'owing', label: isCust ? t('Owe us', 'বাকি আছে') : t('We owe', 'দেনা আছে') },
            { value: 'inactive', label: t('Inactive', 'নিষ্ক্রিয়') },
            { value: 'all', label: t('All', 'সব') },
          ]} />
          <SearchBox value={search} onChange={setSearch} placeholder={t('Name or phone…', 'নাম বা ফোন…')} />
        </>}>
        <DataTable rows={list.data ? rows : undefined} columns={columns} onRow={r => setOpenId(r.id)}
          empty={search || show !== 'active'
            ? t('No contacts match these filters.', 'এই ফিল্টারে কোনো যোগাযোগ নেই।')
            : isCust ? t('No customers yet. Add your first customer to start selling on credit.', 'এখনো কোনো ক্রেতা নেই। বাকিতে বিক্রি শুরু করতে প্রথম ক্রেতা যোগ করুন।') : t('No suppliers yet. Add the feed mills, hatcheries and shops you buy from.', 'এখনো কোনো সরবরাহকারী নেই। যে ফিড মিল, হ্যাচারি ও দোকান থেকে কেনেন সেগুলো যোগ করুন।')}
          footer={rows.length > 1 ? <tr><td colSpan={3}><b>{t('Total', 'মোট')}</b></td><td className="num"><b><Money v={totalBal} /></b></td><td /></tr> : undefined} />
      </Card>

      {editing && <PartyForm kind={kind} party={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {paying && <PaymentDrawer direction={isCust ? 'IN' : 'OUT'} onClose={() => setPaying(false)} />}
      {openId && <PartyDetail id={openId} kind={kind} onClose={() => setOpenId(null)} onEdit={p => setEditing(p)} />}
    </>
  );
}

// ───── Create / edit ─────
function PartyForm({ kind, party, onClose }: { kind: Kind; party: Party | null; onClose: () => void }) {
  const { t } = usePrefs();
  const [f, setF] = useState({
    kind: party?.kind ?? kind, name: party?.name ?? '', phone: party?.phone ?? '', email: party?.email ?? '', address: party?.address ?? '',
    taxId: party?.taxId ?? '', creditLimit: party?.creditLimit != null ? String(party.creditLimit) : '', paymentTerms: String(party?.paymentTerms ?? 0),
    notes: party?.notes ?? '', active: party?.active ?? true,
  });
  const m = useSave(party ? 'put' : 'post', party ? `/parties/${party.id}` : '/parties', party ? t('Contact updated.', 'যোগাযোগ হালনাগাদ হয়েছে।') : t('Contact created.', 'যোগাযোগ তৈরি হয়েছে।'));
  const terms = Number(f.paymentTerms);
  const termsOk = f.paymentTerms !== '' && Number.isInteger(terms) && terms >= 0 && terms <= 365;
  const limitOk = f.creditLimit === '' || Number(f.creditLimit) >= 0;
  const emailOk = !f.email || /^\S+@\S+\.\S+$/.test(f.email);
  const valid = f.name.trim().length >= 2 && termsOk && limitOk && emailOk;
  const opt = (s: string) => (s.trim() ? s.trim() : null);
  const submit = () => m.mutate({
    kind: f.kind, name: f.name.trim(), phone: opt(f.phone), email: opt(f.email), address: opt(f.address), taxId: opt(f.taxId),
    creditLimit: f.creditLimit === '' ? null : Number(f.creditLimit), paymentTerms: terms, notes: opt(f.notes), active: f.active,
  }, { onSuccess: onClose });

  return (
    <Drawer narrow title={party ? t('Edit contact', 'যোগাযোগ সম্পাদনা') : kind === 'CUSTOMER' ? t('New customer', 'নতুন ক্রেতা') : t('New supplier', 'নতুন সরবরাহকারী')} subtitle={party?.name} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={!valid || m.isPending} onClick={submit}>{t('Save', 'সংরক্ষণ')}</button></>}>
      <div className="form-grid">
        <Field label={t('Name', 'নাম')} className="full" error={f.name && f.name.trim().length < 2 ? t('At least 2 characters', 'কমপক্ষে ২ অক্ষর') : undefined}><Input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('Type', 'ধরন')}><Select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} options={[
          { value: 'CUSTOMER', label: t('Customer', 'ক্রেতা') }, { value: 'SUPPLIER', label: t('Supplier', 'সরবরাহকারী') },
          { value: 'BOTH', label: t('Customer & supplier', 'ক্রেতা ও সরবরাহকারী') }, { value: 'EMPLOYEE', label: t('Employee', 'কর্মচারী') },
        ]} /></Field>
        <Field label={t('Phone', 'ফোন')}><Input type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
        <Field label={t('Email', 'ইমেইল')} error={!emailOk ? t('Enter a valid email', 'সঠিক ইমেইল দিন') : undefined}><Input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t('Tax ID / BIN', 'কর শনাক্তকরণ / বিআইএন')}><Input value={f.taxId} onChange={e => setF({ ...f, taxId: e.target.value })} /></Field>
        <Field label={t('Payment terms (days)', 'পরিশোধের সময় (দিন)')} hint={t('0 = due on receipt', '০ = তাৎক্ষণিক')} error={!termsOk ? t('Whole days, 0–365', 'পূর্ণ দিন, ০–৩৬৫') : undefined}><Input type="number" min="0" max="365" step="1" value={f.paymentTerms} onChange={e => setF({ ...f, paymentTerms: e.target.value })} /></Field>
        <Field label={t('Credit limit', 'বাকির সীমা')} hint={t('Blank = no limit', 'খালি = সীমা নেই')} error={!limitOk ? t('Cannot be negative', 'ঋণাত্মক হতে পারে না') : undefined}><Input type="number" min="0" value={f.creditLimit} onChange={e => setF({ ...f, creditLimit: e.target.value })} /></Field>
        <Field label={t('Address', 'ঠিকানা')} className="full"><textarea className="textarea" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={t('Notes', 'নোট')} className="full"><textarea className="textarea" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />{t('Active (shown in pick lists)', 'সক্রিয় (তালিকায় দেখাবে)')}</label>
    </Drawer>
  );
}

// ───── Detail & statement ─────
interface StmtRow { id: string; date: string; type: string; number: string; status: string; charge: number; credit: number; balance: number; isPayment: boolean }

function PartyDetail({ id, kind, onClose, onEdit }: { id: string; kind: Kind; onClose: () => void; onEdit: (p: PartyRow) => void }) {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const isCust = kind === 'CUSTOMER';
  const q = useApi<{ party: Party; invoices: any[]; bills: any[]; payments: any[] }>(`/parties/${id}`);
  const [paying, setPaying] = useState<null | 'IN' | 'OUT'>(null);
  const d = q.data;
  const p = d?.party;
  const isCustomerLike = p && (p.kind === 'CUSTOMER' || p.kind === 'BOTH');
  const isSupplierLike = p && (p.kind === 'SUPPLIER' || p.kind === 'BOTH');

  // Statement from this page's perspective: on a customer page invoices raise what they owe us and
  // receipts reduce it; on a supplier page bills raise what we owe and payments reduce it.
  const stmt = useMemo<StmtRow[]>(() => {
    if (!d) return [];
    const docs = (isCust ? d.invoices : d.bills).map(x => ({ id: x.id, date: x.date, type: isCust ? t('Invoice', 'ইনভয়েস') : t('Bill', 'বিল'), number: x.number, status: x.status, charge: Number(x.total), credit: 0, isPayment: false }));
    const pays = d.payments.map(x => {
      const reduces = isCust ? x.direction === 'IN' : x.direction === 'OUT';
      return {
        id: x.id, date: x.date, number: x.number, status: x.status, isPayment: true,
        type: x.direction === 'IN' ? (isCust ? t('Receipt', 'আদায়') : t('Refund received', 'ফেরত প্রাপ্তি')) : (isCust ? t('Refund paid', 'ফেরত প্রদান') : t('Payment', 'পরিশোধ')),
        charge: reduces ? 0 : Number(x.amount), credit: reduces ? Number(x.amount) : 0,
      };
    });
    let running = 0;
    return [...docs, ...pays]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.isPayment ? 1 : 0) - (b.isPayment ? 1 : 0))
      .map(r => { if (r.status !== 'VOID') running += r.charge - r.credit; return { ...r, balance: running }; })
      .reverse();
  }, [d, isCust, t]);

  const openDocs = (isCust ? d?.invoices : d?.bills)?.filter(x => x.status === 'POSTED' || x.status === 'PARTIAL') ?? [];
  const outstanding = openDocs.reduce((a, x) => a + Number(x.total) - Number(x.amountPaid), 0);
  const now = Date.now();
  const overdue = openDocs.filter(x => x.dueDate && new Date(x.dueDate).getTime() < now).reduce((a, x) => a + Number(x.total) - Number(x.amountPaid), 0);
  const truncated = d && ((isCust ? d.invoices : d.bills).length >= 100 || d.payments.length >= 100);

  return (
    <Drawer title={p?.name ?? (isCust ? t('Customer', 'ক্রেতা') : t('Supplier', 'সরবরাহকারী'))} subtitle={p ? [p.phone, p.email].filter(Boolean).join(' · ') || undefined : undefined} onClose={onClose}
      footer={p && <>
        <div className="left">{p.active ? <Badge tone="green">{t('Active', 'সক্রিয়')}</Badge> : <Badge>{t('Inactive', 'নিষ্ক্রিয়')}</Badge>}</div>
        {can('parties.manage') && <button className="btn" onClick={() => { onEdit(p as PartyRow); onClose(); }}><Pencil size={16} />{t('Edit', 'সম্পাদনা')}</button>}
        {isCustomerLike && can('sales.create') && <button className={`btn ${isCust ? 'primary' : ''}`} onClick={() => setPaying('IN')}><Receipt size={16} />{t('Receive payment', 'টাকা আদায়')}</button>}
        {isSupplierLike && can('purchases.create') && <button className={`btn ${!isCust ? 'primary' : ''}`} onClick={() => setPaying('OUT')}><HandCoins size={16} />{t('Pay', 'পরিশোধ')}</button>}
      </>}>
      {q.isLoading ? <Loading /> : q.isError ? <Alert tone="error">{(q.error as Error).message}</Alert> : !d || !p ? null : <>
        <div className="grid g3">
          <div className="card card-pad stack" style={{ gap: 2 }}><span className="muted small">{isCust ? t('Owes you', 'আপনার পাওনা') : t('You owe', 'আপনার দেনা')}</span><b style={{ fontSize: '1.3em' }}><Money v={outstanding} /></b><span className="muted small">{t(`${openDocs.length} open`, `${openDocs.length}টি খোলা`)}</span></div>
          <div className="card card-pad stack" style={{ gap: 2 }}><span className="muted small">{t('Overdue', 'মেয়াদোত্তীর্ণ')}</span><b style={{ fontSize: '1.3em' }} className={overdue > 0 ? 'neg' : ''}><Money v={overdue} /></b></div>
          <div className="card card-pad stack" style={{ gap: 2 }}>
            <span className="muted small">{t('Terms', 'শর্ত')}</span>
            <b>{p.paymentTerms > 0 ? t(`Net ${p.paymentTerms} days`, `${p.paymentTerms} দিন`) : t('Due on receipt', 'তাৎক্ষণিক')}</b>
            {p.creditLimit != null && <span className="muted small">{t('Credit limit', 'বাকির সীমা')}: {fmtMoney(p.creditLimit, lang)}</span>}
          </div>
        </div>
        {isCust && p.creditLimit != null && Number(p.creditLimit) > 0 && outstanding > Number(p.creditLimit) && (
          <Alert tone="warn">{t(`Balance is ${fmtMoney(outstanding - Number(p.creditLimit), lang)} over the credit limit.`, `বাকি সীমার চেয়ে ${fmtMoney(outstanding - Number(p.creditLimit), lang)} বেশি।`)}</Alert>
        )}
        {(p.address || p.taxId || p.notes) && (
          <dl className="desc-list">
            {p.address && <><dt>{t('Address', 'ঠিকানা')}</dt><dd>{p.address}</dd></>}
            {p.taxId && <><dt>{t('Tax ID', 'কর শনাক্তকরণ')}</dt><dd>{p.taxId}</dd></>}
            {p.notes && <><dt>{t('Notes', 'নোট')}</dt><dd>{p.notes}</dd></>}
          </dl>
        )}
        <div>
          <h3 style={{ marginBottom: 8 }}>{t('Statement', 'হিসাব বিবরণী')}</h3>
          {!stmt.length ? <Empty>{t('No transactions with this contact yet.', 'এই যোগাযোগের সাথে এখনো কোনো লেনদেন নেই।')}</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>{t('Date', 'তারিখ')}</th><th>{t('Type', 'ধরন')}</th><th>{t('No.', 'নং')}</th><th>{t('Status', 'অবস্থা')}</th>
                  <th className="num">{isCust ? t('Charged', 'বিক্রি') : t('Billed', 'বিল')}</th><th className="num">{isCust ? t('Received', 'আদায়') : t('Paid', 'পরিশোধ')}</th><th className="num hide-sm">{t('Balance', 'স্থিতি')}</th>
                </tr></thead>
                <tbody>
                  {stmt.map(r => (
                    <tr key={`${r.isPayment ? 'p' : 'd'}${r.id}`} className={r.status === 'VOID' ? 'void' : ''}>
                      <td className="nowrap">{fmtDate(r.date, lang)}</td>
                      <td>{r.type}</td>
                      <td className="mono">{r.number}</td>
                      <td>{r.isPayment ? (r.status === 'VOID' ? <StatusBadge status="VOID" /> : <Badge tone="green">{t('Posted', 'পোস্ট হয়েছে')}</Badge>) : <StatusBadge status={r.status} />}</td>
                      <td className="num">{r.charge ? <Money v={r.charge} /> : ''}</td>
                      <td className="num">{r.credit ? <Money v={r.credit} /> : ''}</td>
                      <td className="num hide-sm"><Money v={r.balance} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <small className="muted">
            {t('Balance is the running total of the transactions shown; void entries are excluded. Unapplied payments are kept as advances.', 'স্থিতি হলো দেখানো লেনদেনের চলমান মোট; বাতিল এন্ট্রি বাদ। অপ্রয়োগকৃত টাকা অগ্রিম হিসেবে থাকে।')}
            {truncated && ' ' + t('Only the latest 100 of each type are shown.', 'প্রতিটি ধরনের সর্বশেষ ১০০টি দেখানো হয়েছে।')}
          </small>
        </div>
      </>}
      {paying && p && <PaymentDrawer direction={paying} partyId={p.id} onClose={() => setPaying(null)} />}
    </Drawer>
  );
}
