// Users & settings → Import past data: the preview of a filled-in past records template. It lists every
// problem by sheet, row and column, the totals per sheet and the books after the import; nothing is saved
// until the owner presses Import.
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useSave } from '../lib/hooks';
import { fmtDate, fmtMoney, fmtNum } from '../lib/format';
import { Alert, Badge, DataTable, type Column } from '../components/ui';
import { Money } from '../components/forms';

interface Issue { sheet: string; row: number | null; column: string | null; message: string }
interface Totals {
  start: { cash: number; bank: number; mobile: number };
  parties: { rows: number; added: number; owesUs: number; weOwe: number };
  items: { rows: number; added: number; stockValue: number };
  flocks: { rows: number; added: number; birds: number };
  daily: { rows: number; eggsCollected: number; sold: number; sales: number; received: number; given: number; wasted: number };
  purchases: { rows: number; amount: number; paid: number };
  payments: { rows: number; moneyIn: number; moneyOut: number };
  grants: { rows: number; amount: number };
}
export interface TemplatePreviewData {
  kind: 'TEMPLATE'; period: { from: string | null; to: string | null }; rows: Record<string, number>;
  issues: Issue[]; issueCount: number; warnings: Issue[]; totals: Totals;
  position: { cash: number; bank: number; mobile: number; receivable: number; payable: number; openingEquity: number; eggsInStore: number };
  duplicateOf: string | null;
  overlap: { from: string; to: string; existing: Record<string, number>; total: number; openingBalances: number; imports: string[] } | null;
}

export function TemplatePreview({ p, file, onDone }: { p: TemplatePreviewData; file: { name: string; b64: string }; onDone: () => void }) {
  const { t, lang } = usePrefs();
  const [confirm, setConfirm] = useState(false);
  const doImport = useSave('post', '/import/template', t('Past records imported. Reports now include them.', 'পুরোনো হিসাব ইমপোর্ট হয়েছে। রিপোর্টে এখন এগুলো আছে।'));
  const m = (v: number) => fmtMoney(v, lang);
  const n = (v: number) => fmtNum(v, lang);
  const T = p.totals;
  const sheets: { id: string; name: string; rows: number; what: string }[] = [
    { id: 'start', name: t('Start', 'শুরু'), rows: p.rows.start, what: `${t('Cash', 'নগদ')} ${m(T.start.cash)} · ${t('Bank', 'ব্যাংক')} ${m(T.start.bank)} · ${t('Mobile', 'মোবাইল')} ${m(T.start.mobile)}` },
    { id: 'parties', name: t('Customers & suppliers', 'ক্রেতা ও সরবরাহকারী'), rows: p.rows.parties, what: `${t(`${n(T.parties.added)} new`, `${n(T.parties.added)} জন নতুন`)} · ${t('owed to us', 'আমাদের পাওনা')} ${m(T.parties.owesUs)} · ${t('we owe', 'আমাদের দেনা')} ${m(T.parties.weOwe)}` },
    { id: 'items', name: t('Items & stock', 'পণ্য ও মজুদ'), rows: p.rows.items, what: `${t(`${n(T.items.added)} new`, `${n(T.items.added)}টি নতুন`)} · ${t('stock value', 'মজুদের মূল্য')} ${m(T.items.stockValue)}` },
    { id: 'flocks', name: t('Flocks', 'ঝাঁক'), rows: p.rows.flocks, what: `${t(`${n(T.flocks.added)} new`, `${n(T.flocks.added)}টি নতুন`)} · ${t(`${n(T.flocks.birds)} birds`, `${n(T.flocks.birds)}টি পাখি`)}` },
    { id: 'daily', name: t('Daily eggs & sales', 'দৈনিক ডিম ও বিক্রি'), rows: p.rows.daily, what: `${t(`${n(T.daily.eggsCollected)} eggs collected`, `${n(T.daily.eggsCollected)}টি ডিম সংগ্রহ`)} · ${t('sales', 'বিক্রি')} ${m(T.daily.sales)} · ${t('received', 'আদায়')} ${m(T.daily.received)}` },
    { id: 'purchases', name: t('Purchases & expenses', 'ক্রয় ও খরচ'), rows: p.rows.purchases, what: `${t('total', 'মোট')} ${m(T.purchases.amount)} · ${t('paid', 'পরিশোধ')} ${m(T.purchases.paid)}` },
    { id: 'payments', name: t('Payments', 'আদায় ও পরিশোধ'), rows: p.rows.payments, what: `${t('in', 'আয়')} ${m(T.payments.moneyIn)} · ${t('out', 'ব্যয়')} ${m(T.payments.moneyOut)}` },
    { id: 'grants', name: t('Grants', 'অনুদান'), rows: p.rows.grants, what: m(T.grants.amount) },
  ];
  const sheetCols: Column<(typeof sheets)[number]>[] = [
    { key: 's', label: t('Sheet', 'শিট'), render: s => <b>{s.name}</b> },
    { key: 'r', label: t('Rows', 'সারি'), num: true, render: s => n(s.rows) },
    { key: 'w', label: t('Totals', 'মোট'), render: s => <span className="small">{s.what}</span> },
  ];
  const issueCols: Column<Issue & { id: string }>[] = [
    { key: 's', label: t('Sheet', 'শিট'), render: i => i.sheet },
    { key: 'r', label: t('Row', 'সারি'), num: true, render: i => (i.row === null ? '—' : i.row) },
    { key: 'c', label: t('Column', 'কলাম'), render: i => i.column ?? '—' },
    { key: 'm', label: t('Problem', 'সমস্যা'), render: i => i.message },
  ];
  const ok = !p.issueCount && !p.duplicateOf;
  const canImport = ok && (!p.overlap || confirm) && !doImport.isPending;
  const run = () => doImport.mutate({ fileName: file.name, fileBase64: file.b64, confirmOverlap: confirm }, { onSuccess: onDone });

  return (
    <>
      <div className="row between">
        <div><b>{file.name}</b><div className="muted small">{t('Past records template', 'পুরোনো হিসাবের টেমপ্লেট')}{p.period.from && <> · {fmtDate(p.period.from, lang)} – {fmtDate(p.period.to!, lang)}</>}</div></div>
        {ok ? <Badge tone="green"><CheckCircle2 size={12} />{t('No problems found', 'কোনো সমস্যা নেই')}</Badge>
          : <Badge tone="red"><AlertTriangle size={12} />{t(`${p.issueCount} problem(s)`, `${p.issueCount}টি সমস্যা`)}</Badge>}
      </div>
      {p.duplicateOf && <Alert tone="error">{t(`These records were already imported as ${p.duplicateOf}. Undo that import below first if you want to import them again.`, `এই হিসাব আগেই ${p.duplicateOf} হিসেবে ইমপোর্ট হয়েছে। আবার ইমপোর্ট করতে চাইলে আগে নিচে সেটি ফেরত নিন।`)}</Alert>}
      {p.issueCount > 0 && <>
        <Alert tone="error">{t('Correct these rows in the file and upload it again. Nothing has been saved.', 'ফাইলে এই সারিগুলো ঠিক করে আবার আপলোড করুন। কিছুই সংরক্ষণ হয়নি।')}{p.issueCount > p.issues.length && ` ${t(`The first ${p.issues.length} are shown.`, `প্রথম ${p.issues.length}টি দেখানো হলো।`)}`}</Alert>
        <div className="card"><DataTable rows={p.issues.map((i, k) => ({ ...i, id: String(k) }))} columns={issueCols} /></div>
      </>}
      {p.warnings.length > 0 && <Alert tone="warn"><ul style={{ margin: 0, paddingLeft: 18 }}>{p.warnings.map((w, k) => <li key={k}>{w.sheet}{w.row !== null && `, ${t('row', 'সারি')} ${w.row}`}: {w.message}</li>)}</ul></Alert>}

      <div className="grid g2">
        <div className="card"><DataTable rows={sheets} columns={sheetCols} /></div>
        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>{t('The books after this import', 'ইমপোর্টের পর খাতা')}</h3>
          <dl className="desc-list">
            <dt>{t('Cash in hand', 'হাতে নগদ')}</dt><dd><Money v={p.position.cash} /></dd>
            <dt>{t('Bank', 'ব্যাংক')}</dt><dd><Money v={p.position.bank} /></dd>
            <dt>{t('Mobile banking', 'মোবাইল ব্যাংকিং')}</dt><dd><Money v={p.position.mobile} /></dd>
            <dt>{t('Owed to the farm', 'খামারের পাওনা')}</dt><dd><Money v={p.position.receivable} /></dd>
            <dt>{t('The farm owes', 'খামারের দেনা')}</dt><dd><Money v={p.position.payable} /></dd>
            <dt>{t('Opening balance equity', 'প্রারম্ভিক স্থিতি মূলধন')}</dt><dd><Money v={p.position.openingEquity} /></dd>
            <dt>{t('Eggs in store', 'মজুদ ডিম')}</dt><dd>{n(p.position.eggsInStore)}</dd>
          </dl>
        </div>
      </div>

      {p.overlap && <>
        <Alert tone="warn">
          {p.overlap.total > 0 && t(`The books already have ${p.overlap.total} record(s) between ${fmtDate(p.overlap.from, lang)} and ${fmtDate(p.overlap.to, lang)}.`, `${fmtDate(p.overlap.from, lang)} থেকে ${fmtDate(p.overlap.to, lang)} এর মধ্যে খাতায় ইতিমধ্যে ${p.overlap.total}টি রেকর্ড আছে।`)}{' '}
          {p.overlap.openingBalances > 0 && t('Opening balances are already in the books, so cash and dues could be counted twice.', 'খাতায় প্রারম্ভিক স্থিতি আগেই আছে, তাই নগদ ও বকেয়া দুবার গণনা হতে পারে।')}{' '}
          {p.overlap.imports.length > 0 && t(`Earlier imports in these dates: ${p.overlap.imports.join(', ')}. Undo them below if this file replaces them.`, `এই সময়ের আগের ইমপোর্ট: ${p.overlap.imports.join(', ')}। এই ফাইল সেগুলোর বদলে হলে নিচে ফেরত নিন।`)}
        </Alert>
        <label className="check"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />{t('I have checked: these records are not already in the books.', 'আমি দেখেছি: এই হিসাব খাতায় আগে থেকে নেই।')}</label>
      </>}
      <div className="row"><button className="btn primary" disabled={!canImport} onClick={run}><Upload size={16} />{doImport.isPending ? t('Importing…', 'ইমপোর্ট হচ্ছে…') : t('Import past records', 'পুরোনো হিসাব ইমপোর্ট করুন')}</button></div>
    </>
  );
}
