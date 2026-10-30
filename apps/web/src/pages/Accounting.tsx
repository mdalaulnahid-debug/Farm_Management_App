import { Fragment, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Download, Lock, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { accountTypeLabel, usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useAccounts, useApi, useParties, useSave } from '../lib/hooks';
import type { Account, List } from '../lib/api';
import { downloadCsv, fmtDate, fmtMoney, round2, ymd } from '../lib/format';
import { Alert, Badge, Card, Drawer, Empty, Field, Input, Loading, PageHeader, RangePicker, SearchBox, Segmented, Select, StatusBadge, Tabs, thisMonth, VoidDialog, type Range } from '../components/ui';
import { accountOptions, Money } from '../components/forms';

type T = (en: string, bn: string) => string;

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
const SUBTYPES: Record<string, string[]> = {
  ASSET: ['CASH', 'BANK', 'RECEIVABLE', 'INVENTORY', 'CURRENT_ASSET', 'FIXED_ASSET', 'BIOLOGICAL_ASSET'],
  LIABILITY: ['PAYABLE', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'],
  EQUITY: ['EQUITY'],
  INCOME: ['SALES', 'OTHER_INCOME'],
  EXPENSE: ['COGS', 'OPERATING_EXPENSE', 'OTHER_EXPENSE'],
};
const CODE_HINT: Record<string, string> = { ASSET: '1xxx', LIABILITY: '2xxx', EQUITY: '3xxx', INCOME: '4xxx', EXPENSE: '5xxx–6xxx' };
const SOURCE_TYPES = ['MANUAL', 'OPENING', 'INVOICE', 'BILL', 'PAYMENT', 'TRANSFER', 'PRODUCTION', 'ADJUSTMENT', 'REVERSAL'] as const;
const VOIDABLE = ['MANUAL', 'OPENING', 'TRANSFER'];

const subtypeLabel = (t: T, s: string) => ({
  CASH: t('Cash', 'নগদ'), BANK: t('Bank / mobile wallet', 'ব্যাংক / মোবাইল ওয়ালেট'), RECEIVABLE: t('Receivable', 'পাওনা'), INVENTORY: t('Inventory', 'মজুদ'),
  CURRENT_ASSET: t('Other current asset', 'অন্যান্য চলতি সম্পদ'), FIXED_ASSET: t('Fixed asset', 'স্থায়ী সম্পদ'), BIOLOGICAL_ASSET: t('Livestock (biological asset)', 'পশুপাখি (জৈব সম্পদ)'),
  PAYABLE: t('Payable', 'দেনা'), CURRENT_LIABILITY: t('Current liability', 'চলতি দায়'), LONG_TERM_LIABILITY: t('Long-term liability', 'দীর্ঘমেয়াদি দায়'),
  EQUITY: t('Equity', 'মূলধন'), SALES: t('Sales', 'বিক্রয়'), OTHER_INCOME: t('Other income', 'অন্যান্য আয়'),
  COGS: t('Cost of goods sold', 'বিক্রীত পণ্যের ব্যয়'), OPERATING_EXPENSE: t('Operating expense', 'পরিচালন ব্যয়'), OTHER_EXPENSE: t('Other expense', 'অন্যান্য ব্যয়'),
} as Record<string, string>)[s] ?? s;

const cashFlowLabel = (t: T, s: string) => ({ OPERATING: t('Operating', 'পরিচালন'), INVESTING: t('Investing', 'বিনিয়োগ'), FINANCING: t('Financing', 'অর্থায়ন') } as Record<string, string>)[s] ?? s;

const sourceLabel = (t: T, s: string) => ({
  MANUAL: t('Manual', 'ম্যানুয়াল'), OPENING: t('Opening balance', 'প্রারম্ভিক স্থিতি'), INVOICE: t('Sales invoice', 'বিক্রয় ইনভয়েস'), BILL: t('Purchase bill', 'ক্রয় বিল'),
  PAYMENT: t('Payment', 'পরিশোধ'), TRANSFER: t('Transfer', 'স্থানান্তর'), PRODUCTION: t('Production', 'উৎপাদন'), ADJUSTMENT: t('Stock adjustment', 'মজুদ সমন্বয়'), REVERSAL: t('Reversal', 'বিপরীত এন্ট্রি'),
} as Record<string, string>)[s] ?? s;

const defaultCashFlow = (subtype: string) => (['FIXED_ASSET', 'BIOLOGICAL_ASSET'].includes(subtype) ? 'INVESTING' : ['LONG_TERM_LIABILITY', 'EQUITY'].includes(subtype) ? 'FINANCING' : 'OPERATING');

type AccountRow = Account & { balance: number };

export default function Accounting() {
  const { t } = usePrefs();
  const { can } = useAuth();
  const [tab, setTab] = useState<'coa' | 'journals'>('coa');
  const [editing, setEditing] = useState<AccountRow | 'new' | null>(null);
  const [journal, setJournal] = useState(false);
  const manage = can('accounting.manage');

  return (
    <>
      <PageHeader crumb={t('Accounting', 'হিসাবরক্ষণ')} title={t('Ledger & journals', 'খতিয়ান ও জার্নাল')}
        subtitle={t('The chart of accounts and every double-entry posting behind your reports.', 'হিসাবের তালিকা এবং আপনার রিপোর্টের পেছনের প্রতিটি দ্বৈত-দাখিলা এন্ট্রি।')}
        actions={manage && <>
          <button className="btn" onClick={() => setEditing('new')}><Plus size={16} />{t('New account', 'নতুন হিসাব')}</button>
          <button className="btn primary" onClick={() => setJournal(true)}><Plus size={16} />{t('New journal entry', 'নতুন জার্নাল এন্ট্রি')}</button>
        </>} />
      <Tabs value={tab} onChange={setTab} options={[{ value: 'coa', label: t('Chart of accounts', 'হিসাবের তালিকা') }, { value: 'journals', label: t('Journal entries', 'জার্নাল এন্ট্রি') }]} />
      {tab === 'coa' ? <ChartOfAccounts onEdit={a => setEditing(a)} /> : <Journals />}
      {editing && <AccountDrawer account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {journal && <JournalDrawer onClose={() => setJournal(false)} />}
    </>
  );
}

// ───────────── Chart of accounts ─────────────
function ChartOfAccounts({ onEdit }: { onEdit: (a: AccountRow) => void }) {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const list = useApi<List<AccountRow>>('/accounts', { withBalance: 1 });
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'active' | 'all'>('active');
  const [ledger, setLedger] = useState<AccountRow | null>(null);
  const manage = can('accounting.manage');

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (list.data?.data ?? []).filter(a => (show === 'all' || a.active) && (!s || a.code.includes(s) || a.name.toLowerCase().includes(s) || (a.nameBn ?? '').includes(s)));
  }, [list.data, search, show]);

  const exportCsv = () => downloadCsv('chart_of_accounts.csv', ['Code', 'Name', 'Name (Bangla)', 'Type', 'Subtype', 'Cash flow', 'System', 'Active', 'Balance'],
    rows.map(a => [a.code, a.name, a.nameBn ?? '', a.type, a.subtype, a.cashFlow, a.system ? 'Yes' : 'No', a.active ? 'Yes' : 'No', a.balance]));

  return (
    <Card title={t('Chart of accounts', 'হিসাবের তালিকা')} subtitle={t('Balances are all-time, shown on each account’s normal side. Click an account to open its ledger.', 'স্থিতি শুরু থেকে আজ পর্যন্ত, প্রতিটি হিসাবের স্বাভাবিক দিকে দেখানো। খতিয়ান দেখতে হিসাবে ক্লিক করুন।')}
      actions={<>
        <Segmented value={show} onChange={setShow} options={[{ value: 'active', label: t('Active', 'সক্রিয়') }, { value: 'all', label: t('All', 'সব') }]} />
        <SearchBox value={search} onChange={setSearch} placeholder={t('Code or name…', 'কোড বা নাম…')} />
        <button className="btn" onClick={exportCsv} disabled={!rows.length}><Download size={16} />{t('Export', 'রপ্তানি')}</button>
      </>}>
      {!list.data ? <Loading /> : !rows.length ? <Empty>{t('No accounts match your search.', 'আপনার খোঁজের সাথে কোনো হিসাব মেলেনি।')}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th style={{ width: 90 }}>{t('Code', 'কোড')}</th><th>{t('Account', 'হিসাব')}</th><th className="hide-sm">{t('Subtype', 'উপধরন')}</th>
              <th className="hide-sm">{t('Cash flow', 'নগদ প্রবাহ')}</th><th className="num">{t('Balance', 'স্থিতি')}</th>{manage && <th style={{ width: 50 }} />}
            </tr></thead>
            <tbody>
              {TYPES.map(type => {
                const group = rows.filter(a => a.type === type);
                if (!group.length) return null;
                const total = round2(group.reduce((s, a) => s + (a.balance ?? 0), 0));
                return (
                  <Fragment key={type}>
                    <tr className="subtotal"><td colSpan={manage ? 6 : 5}>{accountTypeLabel(t, type)} <span className="muted small">· {t(`${group.length} accounts`, `${group.length}টি হিসাব`)}</span></td></tr>
                    {group.map(a => (
                      <tr key={a.id} className="clickable indent" onClick={() => setLedger(a)}>
                        <td className="mono">{a.code}</td>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <span style={{ fontWeight: 550 }}>{lang === 'bn' && a.nameBn ? a.nameBn : a.name}</span>
                            {a.system && <Badge><Lock size={11} />{t('System', 'সিস্টেম')}</Badge>}
                            {!a.active && <Badge tone="red">{t('Inactive', 'নিষ্ক্রিয়')}</Badge>}
                          </div>
                          {a.description && <div className="muted small">{a.description}</div>}
                        </td>
                        <td className="hide-sm muted">{subtypeLabel(t, a.subtype)}</td>
                        <td className="hide-sm muted">{cashFlowLabel(t, a.cashFlow)}</td>
                        <td className="num"><Money v={a.balance} /></td>
                        {manage && <td><button className="btn ghost sm icon" aria-label={t('Edit account', 'হিসাব সম্পাদনা')} title={t('Edit account', 'হিসাব সম্পাদনা')} onClick={e => { e.stopPropagation(); onEdit(a); }}><Pencil size={15} /></button></td>}
                      </tr>
                    ))}
                    <tr className="subtotal"><td colSpan={4} style={{ textAlign: 'right' }}>{t(`Total ${accountTypeLabel(t, type).toLowerCase()}`, `মোট ${accountTypeLabel(t, type)}`)}</td><td className="num"><Money v={total} /></td>{manage && <td />}</tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {ledger && <LedgerDrawer account={ledger} onClose={() => setLedger(null)} />}
    </Card>
  );
}

// ───────────── Account create / edit ─────────────
function AccountDrawer({ account, onClose }: { account: AccountRow | null; onClose: () => void }) {
  const { t } = usePrefs();
  const all = useAccounts();
  const isNew = !account;
  const locked = !!account?.system;
  const [f, setF] = useState({
    code: account?.code ?? '', name: account?.name ?? '', nameBn: account?.nameBn ?? '', type: account?.type ?? 'EXPENSE',
    subtype: account?.subtype ?? 'OPERATING_EXPENSE', cashFlow: account?.cashFlow ?? 'OPERATING', description: account?.description ?? '', active: account?.active ?? true,
  });
  const save = useSave<typeof f>(isNew ? 'post' : 'put', isNew ? '/accounts' : `/accounts/${account!.id}`, isNew ? t('Account created.', 'হিসাব তৈরি হয়েছে।') : t('Account updated.', 'হিসাব হালনাগাদ হয়েছে।'));

  const codeOk = /^\d{3,6}$/.test(f.code.trim());
  const duplicate = (all.data?.data ?? []).some(a => a.code === f.code.trim() && a.id !== account?.id);
  const nameOk = f.name.trim().length >= 2;
  const valid = codeOk && !duplicate && nameOk && SUBTYPES[f.type].includes(f.subtype);

  const setType = (type: string) => { const subtype = SUBTYPES[type][0]; setF({ ...f, type, subtype, cashFlow: defaultCashFlow(subtype) }); };
  const setSubtype = (subtype: string) => setF({ ...f, subtype, cashFlow: isNew ? defaultCashFlow(subtype) : f.cashFlow });

  const submit = () => save.mutate({ ...f, code: f.code.trim(), name: f.name.trim(), nameBn: f.nameBn.trim(), description: f.description.trim() }, { onSuccess: onClose });

  return (
    <Drawer narrow title={isNew ? t('New account', 'নতুন হিসাব') : t(`Edit account ${account!.code}`, `হিসাব ${account!.code} সম্পাদনা`)}
      subtitle={t('Accounts are where every transaction is classified on the books.', 'প্রতিটি লেনদেন খাতায় যে শ্রেণিতে লেখা হয় সেটিই হিসাব।')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={!valid || save.isPending} onClick={submit}>{t('Save account', 'হিসাব সংরক্ষণ')}</button></>}>
      {locked && <Alert><b>{t('System account.', 'সিস্টেম হিসাব।')}</b> {t('Automatic postings depend on it, so its code, type and subtype are fixed and it cannot be deactivated. You can still rename it.', 'স্বয়ংক্রিয় পোস্টিং এর উপর নির্ভর করে, তাই এর কোড, ধরন ও উপধরন বদলানো বা নিষ্ক্রিয় করা যায় না। নাম বদলানো যায়।')}</Alert>}
      <div className="form-grid">
        <Field label={t('Account type', 'হিসাবের ধরন')}>
          <Select value={f.type} disabled={locked} onChange={e => setType(e.target.value)} options={TYPES.map(x => ({ value: x, label: accountTypeLabel(t, x) }))} />
        </Field>
        <Field label={t('Subtype', 'উপধরন')} hint={t('Decides where it appears on statements.', 'বিবরণীতে কোথায় দেখাবে তা ঠিক করে।')}>
          <Select value={f.subtype} disabled={locked} onChange={e => setSubtype(e.target.value)} options={SUBTYPES[f.type].map(x => ({ value: x, label: subtypeLabel(t, x) }))} />
        </Field>
        <Field label={t('Code', 'কোড')} error={f.code && !codeOk ? t('Use 3–6 digits.', '৩–৬ অঙ্ক দিন।') : duplicate ? t('This code is already used.', 'এই কোড আগেই ব্যবহৃত।') : undefined}
          hint={t(`3–6 digits. ${accountTypeLabel(t, f.type)} accounts usually use ${CODE_HINT[f.type]}.`, `৩–৬ অঙ্ক। ${accountTypeLabel(t, f.type)} হিসাব সাধারণত ${CODE_HINT[f.type]}।`)}>
          <Input className="mono" inputMode="numeric" maxLength={6} value={f.code} disabled={locked} onChange={e => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} autoFocus={isNew} />
        </Field>
        <Field label={t('Cash flow section', 'নগদ প্রবাহ অংশ')} hint={t('Used by the cash flow statement.', 'নগদ প্রবাহ বিবরণীতে ব্যবহৃত।')}>
          <Select value={f.cashFlow} onChange={e => setF({ ...f, cashFlow: e.target.value })} options={['OPERATING', 'INVESTING', 'FINANCING'].map(x => ({ value: x, label: cashFlowLabel(t, x) }))} />
        </Field>
        <Field label={t('Name (English)', 'নাম (ইংরেজি)')} className="full" error={f.name && !nameOk ? t('At least 2 characters.', 'কমপক্ষে ২ অক্ষর।') : undefined}>
          <Input value={f.name} maxLength={100} onChange={e => setF({ ...f, name: e.target.value })} autoFocus={!isNew} />
        </Field>
        <Field label={t('Name (Bangla)', 'নাম (বাংলা)')} className="full" hint={t('Optional — shown when the app is in Bangla.', 'ঐচ্ছিক — অ্যাপ বাংলায় থাকলে দেখাবে।')}>
          <Input value={f.nameBn} maxLength={100} onChange={e => setF({ ...f, nameBn: e.target.value })} />
        </Field>
        <Field label={t('Description', 'বিবরণ')} className="full"><textarea className="textarea" maxLength={300} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.active} disabled={locked} onChange={e => setF({ ...f, active: e.target.checked })} />{t('Active — available for new transactions', 'সক্রিয় — নতুন লেনদেনে ব্যবহারযোগ্য')}</label>
    </Drawer>
  );
}

// ───────────── General ledger ─────────────
interface GLLine { id: string; date: string; number: string; memo: string; party: string | null; sourceType: string; debit: number; credit: number; balance: number }
interface GL { account: Account; opening: number; closing: number; lines: GLLine[] }

function LedgerDrawer({ account, onClose }: { account: AccountRow; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const [range, setRange] = useState<Range>(thisMonth());
  const gl = useApi<GL>(`/reports/general-ledger/${account.id}`, range);
  const d = gl.data;
  const dr = round2((d?.lines ?? []).reduce((s, l) => s + l.debit, 0));
  const cr = round2((d?.lines ?? []).reduce((s, l) => s + l.credit, 0));
  const name = lang === 'bn' && account.nameBn ? account.nameBn : account.name;
  const exportCsv = () => d && downloadCsv(`ledger_${account.code}_${range.from}_${range.to}.csv`, ['Date', 'Entry', 'Source', 'Memo', 'Party', 'Debit', 'Credit', 'Balance'], [
    [range.from, '', '', 'Opening balance', '', '', '', d.opening],
    ...d.lines.map(l => [l.date, l.number, l.sourceType, l.memo, l.party ?? '', l.debit || '', l.credit || '', l.balance]),
    [range.to, '', '', 'Closing balance', '', dr, cr, d.closing],
  ]);
  const cell = { padding: '8px 10px' };
  return (
    <Drawer title={`${account.code} · ${name}`} subtitle={`${accountTypeLabel(t, account.type)} · ${subtypeLabel(t, account.subtype)} — ${t('General ledger', 'সাধারণ খতিয়ান')}`} onClose={onClose}
      footer={<><div className="left">{t('Closing balance', 'সমাপনী স্থিতি')}: <b><Money v={d?.closing} /></b></div><button className="btn" disabled={!d} onClick={exportCsv}><Download size={16} />{t('Export CSV', 'CSV রপ্তানি')}</button></>}>
      <RangePicker value={range} onChange={setRange} />
      {!d ? <Loading /> : (
        <div className="lines">
          <table>
            <thead><tr><th>{t('Date', 'তারিখ')}</th><th>{t('Entry', 'এন্ট্রি')}</th><th>{t('Details', 'বিবরণ')}</th><th className="num">{t('Debit', 'ডেবিট')}</th><th className="num">{t('Credit', 'ক্রেডিট')}</th><th className="num">{t('Balance', 'স্থিতি')}</th></tr></thead>
            <tbody>
              <tr style={{ background: 'var(--surface-2)' }}><td style={cell}>{fmtDate(range.from, lang)}</td><td style={cell} colSpan={4}><b>{t('Opening balance', 'প্রারম্ভিক স্থিতি')}</b></td><td style={cell} className="num"><b><Money v={d.opening} /></b></td></tr>
              {d.lines.length === 0 && <tr><td colSpan={6} style={cell} className="muted">{t('No postings to this account in the selected period.', 'নির্বাচিত সময়ে এই হিসাবে কোনো পোস্টিং নেই।')}</td></tr>}
              {d.lines.map(l => (
                <tr key={l.id}>
                  <td style={cell} className="nowrap">{fmtDate(l.date, lang)}</td>
                  <td style={cell}><span className="mono">{l.number}</span><div className="muted small">{sourceLabel(t, l.sourceType)}</div></td>
                  <td style={cell}>{l.memo}{l.party && <div className="muted small">{l.party}</div>}</td>
                  <td style={cell} className="num">{l.debit ? <Money v={l.debit} /> : ''}</td>
                  <td style={cell} className="num">{l.credit ? <Money v={l.credit} /> : ''}</td>
                  <td style={cell} className="num"><Money v={l.balance} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: 'var(--brand-soft)', fontWeight: 700 }}><td>{fmtDate(range.to, lang)}</td><td colSpan={2}>{t('Closing balance', 'সমাপনী স্থিতি')}</td><td className="num"><Money v={dr} /></td><td className="num"><Money v={cr} /></td><td className="num"><Money v={d.closing} /></td></tr></tfoot>
          </table>
        </div>
      )}
    </Drawer>
  );
}

// ───────────── Journal entries ─────────────
interface JLine { id?: string; accountId: string; debit: number; credit: number; memo?: string | null; account: { code: string; name: string }; party: { name: string } | null }
interface Journal { id: string; number: string; date: string; memo: string; sourceType: string; status: string; lines: JLine[] }

function Journals() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const [range, setRange] = useState<Range>(thisMonth());
  const [search, setSearch] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [voiding, setVoiding] = useState<Journal | null>(null);
  const pageSize = 50;
  const list = useApi<{ data: Journal[]; total: number }>('/journals', { ...range, search, sourceType, page, pageSize });
  const voidIt = useSave<{ id: string; reason: string }>('post', b => `/journals/${b.id}/void`, t('Journal entry voided and reversed.', 'জার্নাল এন্ট্রি বাতিল ও বিপরীত করা হয়েছে।'));
  const rows = list.data?.data;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / pageSize)) : 1;
  const sum = (j: Journal) => round2(j.lines.reduce((s, l) => s + Number(l.debit), 0));

  const exportCsv = () => downloadCsv(`journals_${range.from}_${range.to}.csv`, ['Entry', 'Date', 'Source', 'Status', 'Memo', 'Account code', 'Account', 'Party', 'Line memo', 'Debit', 'Credit'],
    (rows ?? []).flatMap(j => j.lines.map(l => [j.number, j.date.slice(0, 10), j.sourceType, j.status, j.memo, l.account.code, l.account.name, l.party?.name ?? '', l.memo ?? '', l.debit || '', l.credit || ''])));

  return (
    <Card title={t('Journal entries', 'জার্নাল এন্ট্রি')} subtitle={t('Every posting, including those created automatically by invoices, bills and payments.', 'সব পোস্টিং, ইনভয়েস, বিল ও পরিশোধ থেকে স্বয়ংক্রিয়ভাবে তৈরি এন্ট্রিসহ।')}
      actions={<>
        <Select style={{ width: 'auto' }} value={sourceType} onChange={e => { setSourceType(e.target.value); setPage(1); }} placeholder={t('All sources', 'সব উৎস')} options={SOURCE_TYPES.map(s => ({ value: s, label: sourceLabel(t, s) }))} aria-label={t('Source', 'উৎস')} />
        <SearchBox value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder={t('Entry no. or memo…', 'এন্ট্রি নং বা মেমো…')} />
        <RangePicker value={range} onChange={r => { setRange(r); setPage(1); }} />
        <button className="btn" onClick={exportCsv} disabled={!rows?.length}><Download size={16} />{t('Export', 'রপ্তানি')}</button>
      </>}>
      {!rows ? <Loading /> : !rows.length ? <Empty icon={BookOpen}>{t('No journal entries match these filters.', 'এই ফিল্টারে কোনো জার্নাল এন্ট্রি নেই।')}</Empty> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 36 }} /><th>{t('Entry', 'এন্ট্রি')}</th><th>{t('Date', 'তারিখ')}</th><th>{t('Memo', 'মেমো')}</th><th className="hide-sm">{t('Source', 'উৎস')}</th><th>{t('Status', 'অবস্থা')}</th><th className="num">{t('Amount', 'টাকা')}</th></tr></thead>
              <tbody>
                {rows.map(j => {
                  const expanded = !!open[j.id];
                  return (
                    <Fragment key={j.id}>
                      <tr className={`clickable ${j.status === 'VOID' ? 'void' : ''}`} onClick={() => setOpen(o => ({ ...o, [j.id]: !expanded }))} aria-expanded={expanded}>
                        <td>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                        <td><b className="mono">{j.number}</b></td>
                        <td className="nowrap">{fmtDate(j.date, lang)}</td>
                        <td>{j.memo}</td>
                        <td className="hide-sm"><Badge tone={j.sourceType === 'MANUAL' || j.sourceType === 'OPENING' ? 'blue' : undefined}>{sourceLabel(t, j.sourceType)}</Badge></td>
                        <td>{j.status === 'VOID' ? <StatusBadge status="VOID" /> : <Badge tone="green">{t('Posted', 'পোস্টকৃত')}</Badge>}</td>
                        <td className="num"><Money v={sum(j)} /></td>
                      </tr>
                      {expanded && (
                        <tr><td colSpan={7} style={{ background: 'var(--surface-2)', padding: '10px 14px 14px 50px', height: 'auto' }}>
                          <div className="lines" style={{ background: 'var(--surface)' }}>
                            <table>
                              <thead><tr><th>{t('Account', 'হিসাব')}</th><th>{t('Party', 'পক্ষ')}</th><th>{t('Line memo', 'লাইন মেমো')}</th><th className="num">{t('Debit', 'ডেবিট')}</th><th className="num">{t('Credit', 'ক্রেডিট')}</th></tr></thead>
                              <tbody>
                                {j.lines.map((l, i) => (
                                  <tr key={l.id ?? i}>
                                    <td style={{ padding: '8px 10px' }}><span className="mono">{l.account.code}</span> · {l.account.name}</td>
                                    <td style={{ padding: '8px 10px' }} className="muted">{l.party?.name ?? '—'}</td>
                                    <td style={{ padding: '8px 10px' }} className="muted">{l.memo || '—'}</td>
                                    <td style={{ padding: '8px 10px' }} className="num">{Number(l.debit) ? <Money v={l.debit} /> : ''}</td>
                                    <td style={{ padding: '8px 10px' }} className="num">{Number(l.credit) ? <Money v={l.credit} /> : ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot><tr><td colSpan={3}><b>{t('Total', 'মোট')}</b></td><td className="num"><b><Money v={sum(j)} /></b></td><td className="num"><b><Money v={round2(j.lines.reduce((s, l) => s + Number(l.credit), 0))} /></b></td></tr></tfoot>
                            </table>
                          </div>
                          <div className="row between" style={{ marginTop: 10 }}>
                            <span className="muted small">
                              {VOIDABLE.includes(j.sourceType)
                                ? t('Voiding posts a reversing entry on the same date; the original stays for audit.', 'বাতিল করলে একই তারিখে বিপরীত এন্ট্রি হয়; মূল এন্ট্রি অডিটের জন্য থাকে।')
                                : j.sourceType === 'REVERSAL' ? t('This entry reverses a voided entry.', 'এই এন্ট্রি একটি বাতিল এন্ট্রিকে বিপরীত করে।')
                                : t('Created automatically. To correct it, void the source document instead.', 'স্বয়ংক্রিয়ভাবে তৈরি। সংশোধন করতে মূল ডকুমেন্টটি বাতিল করুন।')}
                            </span>
                            {can('accounting.manage') && VOIDABLE.includes(j.sourceType) && j.status !== 'VOID' && (
                              <button className="btn sm" onClick={e => { e.stopPropagation(); setVoiding(j); }}>{t('Void entry', 'এন্ট্রি বাতিল')}</button>
                            )}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="pager">
              <span>{t(`Page ${page} of ${pages} · ${list.data!.total} entries`, `পৃষ্ঠা ${page} / ${pages} · ${list.data!.total}টি এন্ট্রি`)}</span>
              <div className="row">
                <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('Previous', 'আগের')}</button>
                <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('Next', 'পরের')}</button>
              </div>
            </div>
          )}
        </>
      )}
      {voiding && <VoidDialog what={t(`journal ${voiding.number}`, `জার্নাল ${voiding.number}`)} busy={voidIt.isPending} onClose={() => setVoiding(null)}
        onConfirm={reason => voidIt.mutate({ id: voiding.id, reason }, { onSuccess: () => setVoiding(null) })} />}
    </Card>
  );
}

// ───────────── New manual journal ─────────────
interface DraftLine { accountId: string; partyId: string; memo: string; debit: string; credit: string }
const blankLine = (): DraftLine => ({ accountId: '', partyId: '', memo: '', debit: '', credit: '' });
const amt = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? round2(n) : 0; };

function JournalDrawer({ onClose }: { onClose: () => void }) {
  const { t, lang } = usePrefs();
  const { me } = useAuth();
  const accounts = useAccounts();
  const parties = useParties();
  const [form, setForm] = useState({ date: ymd(), memo: '', opening: false });
  const [lines, setLines] = useState<DraftLine[]>([blankLine(), blankLine()]);
  const save = useSave('post', '/journals', t('Journal entry posted.', 'জার্নাল এন্ট্রি পোস্ট হয়েছে।'));

  useEffect(() => { if (form.opening && !form.memo) setForm(f => ({ ...f, memo: t('Opening balances', 'প্রারম্ভিক স্থিতি') })); }, [form.opening]); // eslint-disable-line react-hooks/exhaustive-deps

  const acctOpts = accountOptions(accounts.data?.data, lang);
  const partyOpts = (parties.data?.data ?? []).filter(p => p.active).map(p => ({ value: p.id, label: p.name }));
  const set = (i: number, p: Partial<DraftLine>) => setLines(ls => ls.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const dr = round2(lines.reduce((s, l) => s + amt(l.debit), 0));
  const cr = round2(lines.reduce((s, l) => s + amt(l.credit), 0));
  const diff = round2(dr - cr);
  const used = lines.filter(l => amt(l.debit) > 0 || amt(l.credit) > 0);
  const missingAccount = used.some(l => !l.accountId);
  const bothSides = used.some(l => amt(l.debit) > 0 && amt(l.credit) > 0);
  const lockDate = me?.organization.lockDate?.slice(0, 10) ?? null;
  const locked = !!lockDate && form.date <= lockDate;
  const valid = used.length >= 2 && !missingAccount && !bothSides && diff === 0 && dr > 0 && form.memo.trim().length >= 3 && !!form.date && !locked;

  // Puts the remaining difference on the given line, on whichever side balances the entry.
  const balanceOn = (i: number) => {
    const l = lines[i];
    const others = round2(dr - amt(l.debit) - (cr - amt(l.credit)));
    set(i, others > 0 ? { credit: String(others), debit: '' } : { debit: String(-others), credit: '' });
  };

  const submit = () => save.mutate({
    date: form.date, memo: form.memo.trim(), opening: form.opening,
    lines: used.map(l => ({ accountId: l.accountId, debit: amt(l.debit), credit: amt(l.credit), partyId: l.partyId || null, memo: l.memo.trim() || null })),
  }, { onSuccess: onClose });

  return (
    <Drawer title={t('New journal entry', 'নতুন জার্নাল এন্ট্রি')} subtitle={t('For corrections, accruals, depreciation and opening balances that no other screen records.', 'সংশোধন, বকেয়া, অবচয় ও প্রারম্ভিক স্থিতির জন্য, যা অন্য কোনো পাতায় লেখা যায় না।')} onClose={onClose}
      footer={<>
        <div className="left">
          {diff === 0 && dr > 0
            ? <Badge tone="green"><Scale size={12} />{t('Balanced', 'সমান')}</Badge>
            : <Badge tone={dr === 0 && cr === 0 ? undefined : 'red'}><Scale size={12} />{t('Difference', 'পার্থক্য')} {fmtMoney(Math.abs(diff), lang)}</Badge>}
        </div>
        <button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button>
        <button className="btn primary" disabled={!valid || save.isPending} onClick={submit}>{t('Post entry', 'এন্ট্রি পোস্ট')}</button>
      </>}>
      <Alert>
        {t('Every entry must balance: total debits equal total credits. In plain words — a debit increases what you own (cash, stock, receivables) or what you spend (expenses); a credit increases what you owe (payables, loans), owner’s capital, or what you earn (income).',
          'প্রতিটি এন্ট্রি সমান হতে হবে: মোট ডেবিট = মোট ক্রেডিট। সহজ কথায় — ডেবিট বাড়ায় আপনার যা আছে (নগদ, মজুদ, পাওনা) বা যা খরচ করেন (ব্যয়); ক্রেডিট বাড়ায় আপনার যা দেনা (দেনা, ঋণ), মালিকের মূলধন বা যা আয় করেন (আয়)।')}
      </Alert>
      <div className="form-grid three">
        <Field label={t('Date', 'তারিখ')} error={locked ? t(`Books are closed up to ${lockDate}.`, `${lockDate} পর্যন্ত বই বন্ধ।`) : undefined}>
          <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label={t('Memo', 'মেমো')} className="span2" hint={t('Explain why this entry is needed (min. 3 characters).', 'এই এন্ট্রি কেন প্রয়োজন লিখুন (কমপক্ষে ৩ অক্ষর)।')}>
          <Input value={form.memo} maxLength={300} onChange={e => setForm({ ...form, memo: e.target.value })} placeholder={t('e.g. Depreciation of shed for June', 'যেমন: জুন মাসের শেডের অবচয়')} autoFocus />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={form.opening} onChange={e => setForm({ ...form, opening: e.target.checked })} />
        <span>{t('Opening balance entry', 'প্রারম্ভিক স্থিতি এন্ট্রি')} <span className="muted small">— {t('use when bringing balances over from your old books; the balancing side usually goes to Opening Balance Equity (3900).', 'পুরোনো খাতা থেকে স্থিতি আনার সময় ব্যবহার করুন; সমতার দিকটি সাধারণত প্রারম্ভিক স্থিতি মূলধনে (৩৯০০) যায়।')}</span></span>
      </label>
      <div className="lines stack-sm journal">
        <table>
          <thead><tr>
            <th style={{ width: '32%' }}>{t('Account', 'হিসাব')}</th><th style={{ width: '20%' }}>{t('Party (optional)', 'পক্ষ (ঐচ্ছিক)')}</th><th>{t('Line memo', 'লাইন মেমো')}</th>
            <th style={{ width: 110 }} className="num">{t('Debit', 'ডেবিট')}</th><th style={{ width: 110 }} className="num">{t('Credit', 'ক্রেডিট')}</th><th style={{ width: 40 }} />
          </tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const both = amt(l.debit) > 0 && amt(l.credit) > 0;
              const noAcct = !l.accountId && (amt(l.debit) > 0 || amt(l.credit) > 0);
              return (
                <tr key={i}>
                  <td>
                    <Select value={l.accountId} onChange={e => set(i, { accountId: e.target.value })} placeholder={t('Choose account…', 'হিসাব বাছাই…')} options={acctOpts} style={noAcct ? { borderColor: 'var(--danger)' } : undefined} />
                    {both && <small className="neg">{t('Enter either a debit or a credit, not both.', 'ডেবিট বা ক্রেডিট যেকোনো একটি দিন।')}</small>}
                  </td>
                  <td data-label={t('Party (optional)', 'পক্ষ (ঐচ্ছিক)')}><Select value={l.partyId} onChange={e => set(i, { partyId: e.target.value })} placeholder="—" options={partyOpts} /></td>
                  <td data-label={t('Line memo', 'লাইন মেমো')}><Input value={l.memo} maxLength={200} onChange={e => set(i, { memo: e.target.value })} /></td>
                  <td data-label={t('Debit', 'ডেবিট')}><Input type="number" min="0" step="0.01" value={l.debit} onChange={e => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                  <td data-label={t('Credit', 'ক্রেডিট')}><Input type="number" min="0" step="0.01" value={l.credit} onChange={e => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                  <td><button className="btn ghost sm icon" disabled={lines.length <= 2} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label={t('Remove line', 'লাইন মুছুন')}><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <div className="row">
                  <button className="btn sm" onClick={() => setLines(ls => [...ls, blankLine()])}><Plus size={14} />{t('Add line', 'লাইন যোগ')}</button>
                  {diff !== 0 && lines.length > 0 && <button className="btn sm ghost" onClick={() => balanceOn(lines.length - 1)}><Scale size={14} />{t('Balance on last line', 'শেষ লাইনে সমান করুন')}</button>}
                </div>
              </td>
              <td className="num"><b><Money v={dr} /></b></td>
              <td className="num"><b><Money v={cr} /></b></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="totals">
        <span className="muted">{t('Total debits', 'মোট ডেবিট')}</span><Money v={dr} />
        <span className="muted">{t('Total credits', 'মোট ক্রেডিট')}</span><Money v={cr} />
        <span className="grand">{t('Difference', 'পার্থক্য')}</span>
        <span className={`grand num ${diff === 0 ? 'pos' : 'neg'}`}>{diff === 0 ? (dr > 0 ? t('✓ Balanced', '✓ সমান') : '—') : `${fmtMoney(Math.abs(diff), lang)} ${diff > 0 ? t('more debit', 'ডেবিট বেশি') : t('more credit', 'ক্রেডিট বেশি')}`}</span>
      </div>
      {used.length < 2 && <small className="muted">{t('Fill in at least two lines with an amount.', 'কমপক্ষে দুটি লাইনে টাকা দিন।')}</small>}
      {missingAccount && <small className="neg">{t('Choose an account for every line with an amount.', 'টাকা দেওয়া প্রতিটি লাইনে হিসাব বাছাই করুন।')}</small>}
    </Drawer>
  );
}
