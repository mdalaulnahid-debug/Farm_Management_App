import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Calculator, Download, HandCoins, Landmark, Receipt, Smartphone, Wallet } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useAccounts, useApi, useCashAccounts, useSave } from '../lib/hooks';
import { downloadCsv, fmtDate, fmtMoney, round2, ymd } from '../lib/format';
import { Alert, Badge, Card, DataTable, Empty, Field, Input, Kpi, Loading, PageHeader, RangePicker, SearchBox, Segmented, Select, StatusBadge, Tabs, thisMonth, VoidDialog, type Column } from '../components/ui';
import { accountOptions, CashAccountSelect, Money, PaymentDrawer } from '../components/forms';

type Tab = 'accounts' | 'register' | 'transfer' | 'other' | 'count';
interface Payment {
  id: string; number: string; date: string; direction: 'IN' | 'OUT'; party: { id: string; name: string } | null; partyId?: string | null;
  amount: number; method: string; reference?: string | null; notes?: string | null; status: string; cashAccountId: string; counterAccountId?: string;
}
interface CashCount { id: string; date: string; accountId: string; bookBalance: number; counted: number; variance: number; notes?: string | null }

const COUNTER_SUBTYPES = ['EQUITY', 'OTHER_INCOME', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'FIXED_ASSET'];

function useMethodLabel() {
  const { t } = usePrefs();
  return (m: string) => ({ CASH: t('Cash', 'নগদ'), BANK: t('Bank transfer', 'ব্যাংক ট্রান্সফার'), MOBILE: t('bKash / Nagad', 'বিকাশ / নগদ'), CHEQUE: t('Cheque', 'চেক') } as Record<string, string>)[m] ?? m;
}
function useMethodOptions() {
  const label = useMethodLabel();
  return ['CASH', 'BANK', 'MOBILE', 'CHEQUE'].map(v => ({ value: v, label: label(v) }));
}
/** Map of cash/bank account id → display name. */
function useCashNames() {
  const { lang } = usePrefs();
  const cash = useCashAccounts();
  return useMemo(() => new Map((cash.data?.data ?? []).map(a => [a.id, lang === 'bn' && a.nameBn ? a.nameBn : a.name])), [cash.data, lang]);
}

export default function Banking() {
  const { t } = usePrefs();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('accounts');
  const [receiving, setReceiving] = useState<null | 'IN' | 'OUT'>(null);
  const manage = can('banking.manage');

  return (
    <>
      <PageHeader crumb={t('Banking', 'ব্যাংকিং')} title={t('Cash & bank', 'নগদ ও ব্যাংক')}
        subtitle={t('Balances, every receipt and payment, transfers between accounts, owner money and cash counts.', 'স্থিতি, প্রতিটি আদায় ও পরিশোধ, হিসাবের মধ্যে স্থানান্তর, মালিকের টাকা এবং নগদ গণনা।')}
        actions={<>
          {can('sales.create') && <button className="btn" onClick={() => setReceiving('IN')}><Receipt size={16} />{t('Receive payment', 'টাকা আদায়')}</button>}
          {can('purchases.create') && <button className="btn" onClick={() => setReceiving('OUT')}><HandCoins size={16} />{t('Pay supplier', 'সরবরাহকারীকে পরিশোধ')}</button>}
          {manage && <button className="btn primary" onClick={() => setTab('transfer')}><ArrowLeftRight size={16} />{t('Transfer', 'স্থানান্তর')}</button>}
        </>} />

      <Tabs value={tab} onChange={setTab} options={[
        { value: 'accounts', label: t('Accounts', 'হিসাবসমূহ') },
        { value: 'register', label: t('Receipts & payments', 'আদায় ও পরিশোধ') },
        { value: 'transfer', label: t('Transfers', 'স্থানান্তর') },
        { value: 'other', label: t('Owner & other money', 'মালিক ও অন্যান্য টাকা') },
        { value: 'count', label: t('Cash count', 'নগদ গণনা') },
      ]} />

      {tab === 'accounts' && <AccountsTab onGo={setTab} />}
      {tab === 'register' && <RegisterTab />}
      {tab === 'transfer' && <TransferTab />}
      {tab === 'other' && <OtherMoneyTab />}
      {tab === 'count' && <CashCountTab />}

      {receiving && <PaymentDrawer direction={receiving} onClose={() => setReceiving(null)} />}
    </>
  );
}

// ───── (a) Accounts overview ─────
function AccountsTab({ onGo }: { onGo: (t: Tab) => void }) {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const cash = useCashAccounts();
  const range = thisMonth();
  const pay = useApi<{ data: Payment[]; total: number }>('/payments', { ...range, status: 'POSTED', pageSize: 500 });
  const rows = cash.data?.data ?? [];
  const total = rows.reduce((a, r) => a + Number(r.balance), 0);
  const cashOnHand = rows.filter(r => r.subtype === 'CASH').reduce((a, r) => a + Number(r.balance), 0);
  const inflow = (pay.data?.data ?? []).filter(p => p.direction === 'IN').reduce((a, p) => a + Number(p.amount), 0);
  const outflow = (pay.data?.data ?? []).filter(p => p.direction === 'OUT').reduce((a, p) => a + Number(p.amount), 0);
  const icon = (a: { subtype: string; code: string; name: string }) => (a.subtype === 'BANK' ? Landmark : /bkash|nagad|mobile|rocket/i.test(a.name) || a.code === '1030' ? Smartphone : Banknote);

  if (cash.isLoading) return <Loading />;
  return (
    <>
      <div className="grid g4">
        <Kpi icon={Wallet} label={t('Total cash & bank', 'মোট নগদ ও ব্যাংক')} value={<Money v={total} />} sub={t(`${rows.length} accounts`, `${rows.length}টি হিসাব`)} />
        <Kpi icon={Banknote} tone="blue" label={t('Cash in hand', 'হাতে নগদ')} value={<Money v={cashOnHand} />} />
        <Kpi icon={ArrowDownLeft} label={t('Money in (this month)', 'আয় (এই মাস)')} value={<Money v={inflow} />} sub={t('Receipts & other money in', 'আদায় ও অন্যান্য প্রাপ্তি')} />
        <Kpi icon={ArrowUpRight} tone="red" label={t('Money out (this month)', 'ব্যয় (এই মাস)')} value={<Money v={outflow} />} sub={t('Payments & other money out', 'পরিশোধ ও অন্যান্য প্রদান')} />
      </div>
      <Card title={t('Cash & bank accounts', 'নগদ ও ব্যাংক হিসাব')} subtitle={t('Balances include every posted receipt, payment, transfer and journal.', 'স্থিতিতে প্রতিটি পোস্ট করা আদায়, পরিশোধ, স্থানান্তর ও জার্নাল অন্তর্ভুক্ত।')}
        actions={can('banking.manage') ? <>
          <button className="btn sm" onClick={() => onGo('count')}><Calculator size={14} />{t('Count cash', 'নগদ গণনা')}</button>
          <button className="btn sm" onClick={() => onGo('transfer')}><ArrowLeftRight size={14} />{t('Transfer', 'স্থানান্তর')}</button>
        </> : undefined}>
        {!rows.length ? <Empty>{t('No cash or bank accounts. Add one under Accounting → Chart of accounts (subtype Cash or Bank).', 'কোনো নগদ বা ব্যাংক হিসাব নেই। হিসাবরক্ষণ → হিসাবের তালিকায় একটি যোগ করুন (উপধরন নগদ বা ব্যাংক)।')}</Empty> : (
          <div className="card-body">
            <div className="grid g3">
              {rows.map(a => {
                const Icon = icon(a);
                return (
                  <div key={a.id} className="card card-pad stack" style={{ gap: 6 }}>
                    <div className="row between">
                      <div className="row" style={{ gap: 8 }}><span className="kpi-icon"><Icon size={16} /></span><b>{lang === 'bn' && a.nameBn ? a.nameBn : a.name}</b></div>
                      <Badge tone={a.subtype === 'BANK' ? 'blue' : undefined}>{a.subtype === 'BANK' ? t('Bank', 'ব্যাংক') : t('Cash', 'নগদ')}</Badge>
                    </div>
                    <div style={{ fontSize: '1.5em', fontWeight: 600 }}><Money v={a.balance} /></div>
                    <div className="muted small mono">{a.code}</div>
                    {Number(a.balance) < 0 && <small className="neg">{t('Negative balance — check for missing receipts.', 'ঋণাত্মক স্থিতি — বাদ পড়া আদায় যাচাই করুন।')}</small>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

// ───── (b) Register ─────
function RegisterTab() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const methodLabel = useMethodLabel();
  const names = useCashNames();
  const [range, setRange] = useState(thisMonth());
  const [search, setSearch] = useState('');
  const [dir, setDir] = useState<'all' | 'IN' | 'OUT'>('all');
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const list = useApi<{ data: Payment[]; total: number }>('/payments', { ...range, search, direction: dir === 'all' ? undefined : dir, page, pageSize: 50 });
  const voidIt = useSave<{ id: string; reason: string }>('post', b => `/payments/${b.id}/void`, t('Payment voided.', 'লেনদেন বাতিল হয়েছে।'));
  const live = (list.data?.data ?? []).filter(p => p.status !== 'VOID');
  const pageIn = live.filter(p => p.direction === 'IN').reduce((a, p) => a + Number(p.amount), 0);
  const pageOut = live.filter(p => p.direction === 'OUT').reduce((a, p) => a + Number(p.amount), 0);

  const columns: Column<Payment>[] = [
    { key: 'number', label: t('No.', 'নং'), render: r => <b className="mono">{r.number}</b> },
    { key: 'date', label: t('Date', 'তারিখ'), render: r => fmtDate(r.date, lang) },
    { key: 'dir', label: t('Type', 'ধরন'), render: r => (r.direction === 'IN' ? <Badge tone="green">{t('Money in', 'প্রাপ্তি')}</Badge> : <Badge tone="amber">{t('Money out', 'প্রদান')}</Badge>) },
    { key: 'party', label: t('From / to', 'কার কাছ থেকে / কাকে'), render: r => r.party?.name ?? <span className="muted">{r.notes || t('Other money', 'অন্যান্য টাকা')}</span> },
    { key: 'acct', label: t('Account', 'হিসাব'), hideSm: true, render: r => names.get(r.cashAccountId) ?? '—' },
    { key: 'method', label: t('Method', 'মাধ্যম'), hideSm: true, render: r => <>{methodLabel(r.method)}{r.reference && <div className="muted small">{r.reference}</div>}</> },
    { key: 'status', label: t('Status', 'অবস্থা'), render: r => (r.status === 'VOID' ? <StatusBadge status="VOID" /> : <Badge tone="green">{t('Posted', 'পোস্ট হয়েছে')}</Badge>) },
    { key: 'amount', label: t('Amount', 'টাকা'), num: true, render: r => <Money v={r.direction === 'OUT' ? -r.amount : r.amount} /> },
    ...(can('banking.manage') ? [{
      key: 'act', label: '', render: (r: Payment) => (r.status !== 'VOID'
        ? <button className="btn ghost sm" onClick={e => { e.stopPropagation(); setVoiding(r); }}>{t('Void', 'বাতিল')}</button>
        : null),
    }] : []),
  ];

  const exportCsv = () => downloadCsv(`payments_${range.from}_${range.to}.csv`,
    ['Number', 'Date', 'Direction', 'Party', 'Account', 'Method', 'Reference', 'Notes', 'Status', 'Amount'],
    (list.data?.data ?? []).map(r => [r.number, r.date.slice(0, 10), r.direction, r.party?.name ?? '', names.get(r.cashAccountId) ?? '', r.method, r.reference ?? '', r.notes ?? '', r.status, r.direction === 'OUT' ? -r.amount : r.amount]));

  return (
    <Card title={t('Receipts & payments register', 'আদায় ও পরিশোধের খাতা')}
      subtitle={list.data ? t(`This page: in ${fmtMoney(pageIn, lang)} · out ${fmtMoney(pageOut, lang)}`, `এই পৃষ্ঠা: প্রাপ্তি ${fmtMoney(pageIn, lang)} · প্রদান ${fmtMoney(pageOut, lang)}`) : undefined}
      actions={<>
        <Segmented value={dir} onChange={v => { setDir(v); setPage(1); }} options={[{ value: 'all', label: t('All', 'সব') }, { value: 'IN', label: t('Money in', 'প্রাপ্তি') }, { value: 'OUT', label: t('Money out', 'প্রদান') }]} />
        <SearchBox value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder={t('No., party, reference…', 'নং, নাম, রেফারেন্স…')} />
        <RangePicker value={range} onChange={r => { setRange(r); setPage(1); }} />
        <button className="btn" onClick={exportCsv} disabled={!list.data?.data.length}><Download size={16} />{t('Export', 'রপ্তানি')}</button>
      </>}>
      <DataTable rows={list.data?.data} columns={columns} page={page} pageSize={50} total={list.data?.total} onPage={setPage}
        empty={search || dir !== 'all' ? t('No transactions match these filters.', 'এই ফিল্টারে কোনো লেনদেন নেই।') : t('No receipts or payments in this period.', 'এই সময়ে কোনো আদায় বা পরিশোধ নেই।')} />
      {voiding && <VoidDialog what={t('payment', 'লেনদেন')} busy={voidIt.isPending} onClose={() => setVoiding(null)}
        onConfirm={reason => voidIt.mutate({ id: voiding.id, reason }, { onSuccess: () => setVoiding(null) })} />}
    </Card>
  );
}

// ───── (c) Transfers ─────
function TransferTab() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const cash = useCashAccounts();
  const accounts = cash.data?.data ?? [];
  const [f, setF] = useState({ date: ymd(), fromAccountId: '', toAccountId: '', amount: '', memo: '' });
  useEffect(() => {
    if (accounts.length >= 2 && !f.fromAccountId && !f.toAccountId) setF(x => ({ ...x, fromAccountId: accounts[0].id, toAccountId: accounts[1].id }));
  }, [accounts, f.fromAccountId, f.toAccountId]);
  const save = useSave('post', '/transfers', t('Transfer recorded.', 'স্থানান্তর লেখা হয়েছে।'));
  const from = accounts.find(a => a.id === f.fromAccountId);
  const amount = Number(f.amount);
  const same = f.fromAccountId && f.fromAccountId === f.toAccountId;
  const valid = !!f.date && !!f.fromAccountId && !!f.toAccountId && !same && amount > 0;
  const opts = accounts.map(a => ({ value: a.id, label: `${lang === 'bn' && a.nameBn ? a.nameBn : a.name} — ${fmtMoney(a.balance, lang)}` }));
  const submit = () => save.mutate({ date: f.date, fromAccountId: f.fromAccountId, toAccountId: f.toAccountId, amount: round2(amount), memo: f.memo.trim() || undefined }, { onSuccess: () => setF(x => ({ ...x, amount: '', memo: '' })) });

  if (!can('banking.manage')) return <Alert tone="warn">{t('You do not have permission to move money between accounts.', 'হিসাবের মধ্যে টাকা স্থানান্তরের অনুমতি আপনার নেই।')}</Alert>;
  if (cash.isLoading) return <Loading />;
  return (
    <div className="grid g2">
      <Card title={t('Transfer between accounts', 'হিসাবের মধ্যে স্থানান্তর')} subtitle={t('E.g. cash deposited to bank, bank withdrawal, or bKash cash-out. Not income or expense.', 'যেমন ব্যাংকে নগদ জমা, ব্যাংক থেকে উত্তোলন বা বিকাশ ক্যাশ-আউট। এটি আয় বা ব্যয় নয়।')} pad>
        {accounts.length < 2 ? <Alert tone="warn">{t('You need at least two cash or bank accounts to make a transfer.', 'স্থানান্তরের জন্য কমপক্ষে দুটি নগদ বা ব্যাংক হিসাব লাগবে।')}</Alert> : (
          <div className="stack">
            <div className="form-grid">
              <Field label={t('From', 'থেকে')}><Select value={f.fromAccountId} onChange={e => setF({ ...f, fromAccountId: e.target.value })} options={opts} /></Field>
              <Field label={t('To', 'তে')} error={same ? t('Choose a different account', 'ভিন্ন হিসাব বাছাই করুন') : undefined}><Select value={f.toAccountId} onChange={e => setF({ ...f, toAccountId: e.target.value })} options={opts} /></Field>
              <Field label={t('Date', 'তারিখ')}><Input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
              <Field label={t('Amount', 'টাকা')} hint={from && amount > Number(from.balance) ? t('More than the current balance', 'বর্তমান স্থিতির চেয়ে বেশি') : undefined}><Input type="number" min="0" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
              <Field label={t('Memo', 'বিবরণ')} className="full"><Input value={f.memo} maxLength={200} onChange={e => setF({ ...f, memo: e.target.value })} placeholder={t('Deposit slip / transaction ID', 'জমা স্লিপ / লেনদেন আইডি')} /></Field>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" disabled={!valid || save.isPending} onClick={submit}><ArrowLeftRight size={16} />{t('Record transfer', 'স্থানান্তর লিখুন')}</button>
            </div>
          </div>
        )}
      </Card>
      <Card title={t('Current balances', 'বর্তমান স্থিতি')}>
        <div className="table-wrap">
          <table className="table">
            <tbody>{accounts.map(a => <tr key={a.id}><td>{lang === 'bn' && a.nameBn ? a.nameBn : a.name}<div className="muted small mono">{a.code}</div></td><td className="num"><Money v={a.balance} /></td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ───── (d) Owner & other money ─────
function OtherMoneyTab() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const methodOptions = useMethodOptions();
  const accounts = useAccounts();
  const names = useCashNames();
  const all = accounts.data?.data ?? [];
  const counterOpts = accountOptions(all, lang, a => COUNTER_SUBTYPES.includes(a.subtype));
  const byCode = (code: string) => all.find(a => a.code === code && a.active)?.id ?? '';
  const [f, setF] = useState({ direction: 'IN' as 'IN' | 'OUT', date: ymd(), cashAccountId: '', counterAccountId: '', amount: '', method: 'CASH', notes: '' });
  const save = useSave('post', '/payments', t('Recorded.', 'লেখা হয়েছে।'));
  const recent = useApi<{ data: Payment[] }>('/payments', { pageSize: 200 });
  const others = (recent.data?.data ?? []).filter(p => !p.partyId && !p.party).slice(0, 20);
  const acctName = (id?: string) => { const a = all.find(x => x.id === id); return a ? (lang === 'bn' && a.nameBn ? a.nameBn : a.name) : '—'; };
  const valid = !!f.date && !!f.cashAccountId && !!f.counterAccountId && Number(f.amount) > 0;
  const submit = () => save.mutate({
    direction: f.direction, date: f.date, cashAccountId: f.cashAccountId, counterAccountId: f.counterAccountId,
    amount: round2(Number(f.amount)), method: f.method, notes: f.notes.trim() || null,
  }, { onSuccess: () => setF(x => ({ ...x, amount: '', notes: '' })) });

  const presets: { label: string; direction: 'IN' | 'OUT'; code: string; note: string }[] = [
    { label: t('Owner puts money in', 'মালিকের মূলধন জমা'), direction: 'IN', code: '3010', note: t('Owner capital', 'মালিকের মূলধন') },
    { label: t('Owner takes money out', 'মালিকের উত্তোলন'), direction: 'OUT', code: '3020', note: t('Owner drawings', 'মালিকের উত্তোলন') },
  ];

  if (!can('banking.manage')) return <Alert tone="warn">{t('You do not have permission to record owner or other money movements.', 'মালিক বা অন্যান্য টাকার লেনদেন লেখার অনুমতি আপনার নেই।')}</Alert>;
  return (
    <div className="grid g2">
      <Card title={t('Record other money in or out', 'অন্যান্য টাকা প্রাপ্তি বা প্রদান লিখুন')} subtitle={t('For money that is not a sale or a supplier bill: owner capital, drawings, loans received or repaid, assets bought or sold.', 'বিক্রয় বা সরবরাহকারীর বিল নয় এমন টাকার জন্য: মালিকের মূলধন, উত্তোলন, ঋণ গ্রহণ বা পরিশোধ, সম্পদ ক্রয় বা বিক্রয়।')} pad>
        <div className="stack">
          <div className="row">
            {presets.map(p => <button key={p.code} className="btn sm" disabled={!byCode(p.code)} onClick={() => setF(x => ({ ...x, direction: p.direction, counterAccountId: byCode(p.code), notes: x.notes || p.note }))}>{p.label}</button>)}
          </div>
          <Segmented value={f.direction} onChange={v => setF({ ...f, direction: v })} options={[{ value: 'IN', label: t('Money in', 'টাকা প্রাপ্তি') }, { value: 'OUT', label: t('Money out', 'টাকা প্রদান') }]} />
          <div className="form-grid">
            <Field label={t('Date', 'তারিখ')}><Input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
            <Field label={t('Amount', 'টাকা')}><Input type="number" min="0" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label={f.direction === 'IN' ? t('Received into', 'যে হিসাবে জমা') : t('Paid from', 'যে হিসাব থেকে')}><CashAccountSelect value={f.cashAccountId} onChange={v => setF(x => ({ ...x, cashAccountId: v }))} /></Field>
            <Field label={t('Method', 'মাধ্যম')}><Select value={f.method} onChange={e => setF({ ...f, method: e.target.value })} options={methodOptions} /></Field>
            <Field label={f.direction === 'IN' ? t('Source (what is this money?)', 'উৎস (এই টাকা কিসের?)') : t('Purpose (what is it for?)', 'উদ্দেশ্য (কিসের জন্য?)')} className="full"
              hint={t('Equity, loan, other income or fixed asset account', 'মূলধন, ঋণ, অন্যান্য আয় বা স্থায়ী সম্পদের হিসাব')}>
              <Select value={f.counterAccountId} onChange={e => setF({ ...f, counterAccountId: e.target.value })} placeholder={t('Choose account…', 'হিসাব বাছাই করুন…')} options={counterOpts} />
            </Field>
            <Field label={t('Notes', 'নোট')} className="full"><textarea className="textarea" maxLength={500} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={!valid || save.isPending} onClick={submit}>{f.direction === 'IN' ? t('Record money in', 'প্রাপ্তি লিখুন') : t('Record money out', 'প্রদান লিখুন')}</button>
          </div>
        </div>
      </Card>
      <Card title={t('Recent other money', 'সাম্প্রতিক অন্যান্য লেনদেন')}>
        {!recent.data ? <Loading /> : !others.length ? <Empty>{t('Nothing recorded yet.', 'এখনো কিছু লেখা হয়নি।')}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Date', 'তারিখ')}</th><th>{t('Account', 'হিসাব')}</th><th className="num">{t('Amount', 'টাকা')}</th></tr></thead>
              <tbody>{others.map(p => (
                <tr key={p.id} className={p.status === 'VOID' ? 'void' : ''}>
                  <td className="nowrap">{fmtDate(p.date, lang)}<div className="muted small mono">{p.number}</div></td>
                  <td>{acctName(p.counterAccountId)}<div className="muted small">{names.get(p.cashAccountId)}{p.notes ? ` · ${p.notes}` : ''}</div></td>
                  <td className="num"><Money v={p.direction === 'OUT' ? -p.amount : p.amount} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ───── (e) Cash count / reconciliation ─────
function CashCountTab() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const cash = useCashAccounts();
  const names = useCashNames();
  const counts = useApi<{ data: CashCount[] }>('/cash-counts');
  const [f, setF] = useState({ date: ymd(), accountId: '', counted: '', notes: '', postVariance: true });
  const save = useSave('post', '/cash-counts', t('Cash count saved.', 'নগদ গণনা সংরক্ষিত হয়েছে।'));
  const acct = cash.data?.data.find(a => a.id === f.accountId);
  const isToday = f.date === ymd();
  const preview = acct && f.counted !== '' && isToday ? round2(Number(f.counted) - Number(acct.balance)) : null;
  const valid = !!f.date && !!f.accountId && f.counted !== '' && Number(f.counted) >= 0;
  const submit = () => save.mutate({ date: f.date, accountId: f.accountId, counted: round2(Number(f.counted)), notes: f.notes.trim() || null, postVariance: f.postVariance },
    { onSuccess: () => setF(x => ({ ...x, counted: '', notes: '' })) });

  const columns: Column<CashCount>[] = [
    { key: 'date', label: t('Date', 'তারিখ'), render: r => fmtDate(r.date, lang) },
    { key: 'acct', label: t('Account', 'হিসাব'), render: r => names.get(r.accountId) ?? '—' },
    { key: 'book', label: t('Book balance', 'খাতার স্থিতি'), num: true, render: r => <Money v={r.bookBalance} /> },
    { key: 'counted', label: t('Counted', 'গণনা'), num: true, render: r => <Money v={r.counted} /> },
    { key: 'var', label: t('Difference', 'পার্থক্য'), num: true, render: r => (Math.abs(Number(r.variance)) < 0.01 ? <Badge tone="green">{t('Matched', 'মিলেছে')}</Badge> : <Money v={r.variance} />) },
    { key: 'notes', label: t('Notes', 'নোট'), hideSm: true, render: r => <span className="muted small">{r.notes || ''}</span> },
  ];

  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      {can('banking.manage') ? (
        <Card title={t('Count cash', 'নগদ গণনা করুন')} subtitle={t('Count the money in the box (or check the bank statement) and compare with the books.', 'বাক্সের টাকা গুনুন (বা ব্যাংক স্টেটমেন্ট দেখুন) এবং খাতার সাথে মিলান।')} pad>
          <div className="stack">
            <div className="form-grid">
              <Field label={t('Account', 'হিসাব')}><CashAccountSelect value={f.accountId} onChange={v => setF(x => ({ ...x, accountId: v }))} /></Field>
              <Field label={t('Date', 'তারিখ')}><Input type="date" value={f.date} max={ymd()} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
              <Field label={t('Amount counted', 'গণনাকৃত টাকা')} className="full"
                hint={acct && isToday ? t(`Book balance now: ${fmtMoney(acct.balance, lang)}`, `এখন খাতার স্থিতি: ${fmtMoney(acct.balance, lang)}`) : t('Book balance is worked out as of the chosen date.', 'বাছাই করা তারিখের খাতার স্থিতি হিসাব করা হবে।')}>
                <Input type="number" min="0" autoFocus value={f.counted} onChange={e => setF({ ...f, counted: e.target.value })} />
              </Field>
              <Field label={t('Notes', 'নোট')} className="full"><textarea className="textarea" maxLength={300} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
            </div>
            {preview !== null && (Math.abs(preview) < 0.01
              ? <Alert>{t('Matches the books.', 'খাতার সাথে মিলেছে।')}</Alert>
              : <Alert tone="warn">{preview > 0 ? t(`Cash over by ${fmtMoney(preview, lang)}.`, `নগদ ${fmtMoney(preview, lang)} বেশি।`) : t(`Cash short by ${fmtMoney(-preview, lang)}.`, `নগদ ${fmtMoney(-preview, lang)} কম।`)}</Alert>)}
            <label className="check"><input type="checkbox" checked={f.postVariance} onChange={e => setF({ ...f, postVariance: e.target.checked })} />{t('Post any difference to Cash over / short so the books match the count', 'যেকোনো পার্থক্য নগদ বেশি / কম হিসাবে পোস্ট করুন যাতে খাতা গণনার সাথে মেলে')}</label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" disabled={!valid || save.isPending} onClick={submit}><Calculator size={16} />{t('Save count', 'গণনা সংরক্ষণ')}</button>
            </div>
          </div>
        </Card>
      ) : <Alert>{t('You can view cash counts but not record them.', 'আপনি নগদ গণনা দেখতে পারবেন, কিন্তু লিখতে পারবেন না।')}</Alert>}
      <Card title={t('Count history', 'গণনার ইতিহাস')} subtitle={t('Latest 100 counts', 'সর্বশেষ ১০০টি গণনা')}>
        <DataTable rows={counts.data?.data} columns={columns} empty={t('No cash counts yet. Counting cash regularly catches mistakes early.', 'এখনো কোনো নগদ গণনা নেই। নিয়মিত গণনা করলে ভুল দ্রুত ধরা পড়ে।')} />
      </Card>
    </div>
  );
}
