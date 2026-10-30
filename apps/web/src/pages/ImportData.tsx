// Admin → Import past data. Upload a monthly workbook, check the preview, then post it as one undoable batch.
import { useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, History, Undo2, Upload, XCircle } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { api } from '../lib/api';
import { useApi, useFlocks, useSave } from '../lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../lib/format';
import { Alert, Badge, Card, DataTable, Dialog, Field, Kpi, Loading, Select, StatusBadge, type Column } from '../components/ui';
import { Money } from '../components/forms';

interface Row { date: string; sourceDate: string; produced: number; cashEggs: number; creditEggs: number; discount: number; feed: number; snails: number; other: number; medicine: number; donated: number; waste: number; note?: string }
interface Preview {
  sheetName: string; period: { from: string; to: string }; rows: Row[]; warnings: string[]; errors: string[]; blockers: string[];
  params: { openingCash: number; price: number; openingReceivable: number; contribution: number; feedStock: number | null; otherMonthly: number; oldCollection: number; expectedClosingCash: number | null };
  totals: { days: number; produced: number; soldCash: number; soldCredit: number; donated: number; waste: number; netSales: number; cashSales: number; creditSales: number; totalExpenses: number; closingCash: number; expectedClosingCash: number | null; cashMatches: boolean | null; closingReceivable: number };
  existing: Record<string, number>; hasExisting: boolean;
}
interface Batch { id: string; number: string; fileName: string | null; periodFrom: string; periodTo: string; status: string; createdAt: string; summary: { days: number; netSales: number; totalExpenses: number; closingCash: number } }

const toBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});

export default function ImportData() {
  const { t, lang } = usePrefs();
  const flocks = useFlocks();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [replace, setReplace] = useState(false);
  const [flockId, setFlockId] = useState('');
  const doImport = useSave('post', '/import/workbook', t('Workbook imported. Reports now include this period.', 'ওয়ার্কবুক ইমপোর্ট হয়েছে। রিপোর্টে এখন এই সময়ের হিসাব আছে।'));

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setLoading(true); setError(''); setPreview(null); setReplace(false);
    try {
      const b64 = await toBase64(f);
      setFile({ name: f.name, b64 });
      setPreview(await api.post<Preview>('/import/workbook/preview', { fileName: f.name, fileBase64: b64 }));
    } catch (e: any) { setError(e.message); } finally { setLoading(false); if (input.current) input.current.value = ''; }
  };
  const run = () => file && doImport.mutate({ fileName: file.name, fileBase64: file.b64, replaceExisting: replace, flockId: flockId || null }, {
    onSuccess: () => { setPreview(null); setFile(null); },
  });

  const p = preview;
  const kindLabel = (k: string) => ({ invoices: t('invoices', 'চালান'), bills: t('bills/expenses', 'বিল/খরচ'), payments: t('payments', 'পরিশোধ/আদায়'), production: t('production logs', 'উৎপাদন'), adjustments: t('stock adjustments', 'মজুদ সমন্বয়'), journals: t('journals', 'জার্নাল') } as Record<string, string>)[k] ?? k;
  const activeFlocks = (flocks.data?.data ?? []).filter(f => f.status === 'ACTIVE');
  const existingTotal = p ? Object.values(p.existing).reduce((a, b) => a + b, 0) : 0;
  const canImport = !!p && !p.errors.length && !p.blockers.length && (!p.hasExisting || replace) && !doImport.isPending;

  const cols: Column<Row & { id: string }>[] = [
    { key: 'date', label: t('Date', 'তারিখ'), render: r => <div>{fmtDate(r.date, lang)}{r.note && <div className="small" style={{ color: 'var(--warning)' }}>{t('Sheet', 'শিটে')}: {r.sourceDate}</div>}</div> },
    { key: 'produced', label: t('Produced', 'উৎপাদন'), num: true, render: r => fmtNum(r.produced, lang) },
    { key: 'cash', label: t('Sold cash', 'নগদ বিক্রি'), num: true, render: r => fmtNum(r.cashEggs, lang) },
    { key: 'credit', label: t('Sold credit', 'বাকি বিক্রি'), num: true, render: r => fmtNum(r.creditEggs, lang) },
    { key: 'gift', label: t('Donated / waste', 'অনুদান / নষ্ট'), num: true, hideSm: true, render: r => `${fmtNum(r.donated, lang)} / ${fmtNum(r.waste, lang)}` },
    { key: 'disc', label: t('Discount', 'ছাড়'), num: true, hideSm: true, render: r => <Money v={r.discount} /> },
    { key: 'exp', label: t('Expenses', 'খরচ'), num: true, render: r => <Money v={r.feed + r.snails + r.other + r.medicine} /> },
  ];

  return (
    <>
      <Card title={<span className="row" style={{ gap: 8 }}><FileSpreadsheet size={18} />{t('Import past data (backlog)', 'পুরোনো হিসাব ইমপোর্ট (ব্যাকলগ)')}</span>}
        subtitle={t('Upload a monthly workbook in the same layout as the October sheet. One month per file.', 'অক্টোবরের শিটের মতো একই ছকের মাসিক ওয়ার্কবুক আপলোড করুন। প্রতি ফাইলে এক মাস।')}
        actions={<>
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e => choose(e.target.files?.[0])} />
          <button className="btn primary" disabled={loading} onClick={() => input.current?.click()}><Upload size={16} />{file ? t('Choose another file', 'অন্য ফাইল বাছুন') : t('Choose .xlsx file', '.xlsx ফাইল বাছুন')}</button>
        </>}>
        <div className="card-body stack">
          {!p && !loading && !error && (
            <ol className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>{t('Fill the month in your usual workbook: monthly figures at the top (last month’s balance, egg price, previous dues, grant, other monthly cost, dues collected) and one row per day.', 'নিয়মিত ওয়ার্কবুকে মাসটি পূরণ করুন: উপরে মাসিক তথ্য (গত মাসের ব্যালেন্স, ডিমের দাম, গত মাসের বকেয়া, অনুদান, অন্যান্য মাসিক খরচ, বকেয়া আদায়) এবং প্রতিদিনের জন্য একটি সারি।')}</li>
              <li>{t('Upload it here. Nothing is saved until you press Import — first you see a preview and a cash check against the sheet.', 'এখানে আপলোড করুন। ইমপোর্ট চাপার আগে কিছুই সংরক্ষণ হবে না — আগে প্রিভিউ ও শিটের সাথে নগদ মিলিয়ে দেখাবে।')}</li>
              <li>{t('Each day becomes production, sales, collections and expenses in the books. An import can be undone in one step.', 'প্রতিটি দিন খাতায় উৎপাদন, বিক্রয়, আদায় ও খরচ হিসেবে বসবে। একটি ইমপোর্ট এক ক্লিকে ফেরত নেওয়া যায়।')}</li>
            </ol>
          )}
          {loading && <Loading />}
          {error && <Alert tone="error">{error}</Alert>}
          {p && <>
            <div className="row between">
              <div><b>{file?.name}</b><div className="muted small">{t('Sheet', 'শিট')}: {p.sheetName} · {t('Period', 'সময়কাল')}: {fmtDate(p.period.from, lang)} – {fmtDate(p.period.to, lang)} · {t(`${p.totals.days} days`, `${p.totals.days} দিন`)}</div></div>
              {p.totals.cashMatches === true && <Badge tone="green"><CheckCircle2 size={12} />{t('Closing cash matches the sheet', 'সমাপনী নগদ শিটের সাথে মিলেছে')}</Badge>}
              {p.totals.cashMatches === false && <Badge tone="red"><XCircle size={12} />{t('Closing cash differs from the sheet', 'সমাপনী নগদ শিটের সাথে মেলেনি')}</Badge>}
            </div>
            {p.errors.map(e => <Alert key={e} tone="error">{e}</Alert>)}
            {p.blockers.length > 0 && <Alert tone="error">{t('Later payments settle records in this period. Void them first:', 'পরের তারিখের পরিশোধ এই সময়ের রেকর্ড মেটায়। আগে এগুলো বাতিল করুন:')} {p.blockers.join('; ')}</Alert>}
            {p.warnings.length > 0 && <Alert tone="warn"><ul style={{ margin: 0, paddingLeft: 18 }}>{p.warnings.map(w => <li key={w}>{w}</li>)}</ul></Alert>}

            <div className="grid g4">
              <Kpi icon={FileSpreadsheet} label={t('Eggs produced', 'উৎপাদিত ডিম')} value={fmtNum(p.totals.produced, lang)} sub={t(`${fmtNum(p.totals.soldCash + p.totals.soldCredit, lang)} sold · ${fmtNum(p.totals.donated, lang)} donated`, `${fmtNum(p.totals.soldCash + p.totals.soldCredit, lang)}টি বিক্রি · ${fmtNum(p.totals.donated, lang)}টি অনুদান`)} />
              <Kpi icon={FileSpreadsheet} label={t('Net sales', 'নিট বিক্রয়')} value={<Money v={p.totals.netSales} />} sub={t(`Cash ${fmtMoney(p.totals.cashSales, lang)} · credit ${fmtMoney(p.totals.creditSales, lang)}`, `নগদ ${fmtMoney(p.totals.cashSales, lang)} · বাকি ${fmtMoney(p.totals.creditSales, lang)}`)} />
              <Kpi icon={FileSpreadsheet} tone="amber" label={t('Expenses', 'খরচ')} value={<Money v={p.totals.totalExpenses} />} sub={t(`incl. monthly ${fmtMoney(p.params.otherMonthly, lang)}`, `মাসিক ${fmtMoney(p.params.otherMonthly, lang)} সহ`)} />
              <Kpi icon={FileSpreadsheet} tone={p.totals.cashMatches === false ? 'red' : 'blue'} label={t('Closing cash', 'সমাপনী নগদ')} value={<Money v={p.totals.closingCash} />}
                sub={p.params.expectedClosingCash === null ? t('Sheet has no closing cash', 'শিটে সমাপনী নগদ নেই') : t(`Sheet says ${fmtMoney(p.params.expectedClosingCash, lang)}`, `শিটে আছে ${fmtMoney(p.params.expectedClosingCash, lang)}`)} />
            </div>

            <div className="grid g2">
              <div className="card card-pad">
                <h3 style={{ marginBottom: 10 }}>{t('Monthly figures', 'মাসিক তথ্য')}</h3>
                <dl className="desc-list">
                  <dt>{t('Opening cash (last month’s balance)', 'প্রারম্ভিক নগদ (গত মাসের ব্যালেন্স)')}</dt><dd><Money v={p.params.openingCash} /></dd>
                  <dt>{t('Egg price', 'ডিমের দাম')}</dt><dd><Money v={p.params.price} decimals={2} /></dd>
                  <dt>{t('Previous dues (receivable)', 'গত মাসের বকেয়া')}</dt><dd><Money v={p.params.openingReceivable} /></dd>
                  <dt>{t('Dues collected', 'বকেয়া আদায়')}</dt><dd><Money v={p.params.oldCollection} /></dd>
                  <dt>{t('Cash grant / contribution', 'নগদ অনুদান')}</dt><dd><Money v={p.params.contribution} /></dd>
                  <dt>{t('Other monthly costs', 'অন্যান্য মাসিক খরচ')}</dt><dd><Money v={p.params.otherMonthly} /></dd>
                  <dt>{t('Closing receivable (computed)', 'সমাপনী বকেয়া (হিসাবকৃত)')}</dt><dd><Money v={p.totals.closingReceivable} /></dd>
                </dl>
              </div>
              <div className="card card-pad stack">
                <h3>{t('Before importing', 'ইমপোর্টের আগে')}</h3>
                <Field label={t('Flock for egg production', 'ডিম উৎপাদনের ঝাঁক')}>
                  <Select value={flockId} onChange={e => setFlockId(e.target.value)} placeholder={t('First active flock', 'প্রথম সক্রিয় ঝাঁক')} options={activeFlocks.map(f => ({ value: f.id, label: `${f.code} · ${f.name}` }))} />
                </Field>
                {p.hasExisting ? <>
                  <Alert tone="warn">{t(`This period already has ${existingTotal} posted record(s)`, `এই সময়ে ইতিমধ্যে ${existingTotal}টি রেকর্ড আছে`)} ({Object.entries(p.existing).filter(([, v]) => v).map(([k, v]) => `${kindLabel(k)}: ${v}`).join(', ')}). {t('To avoid counting twice, they must be replaced. They are voided, not deleted, and stay in the audit trail.', 'দুবার গণনা এড়াতে এগুলো প্রতিস্থাপন করতে হবে। এগুলো বাতিল হবে, মুছে যাবে না, এবং অডিট ট্রেইলে থাকবে।')}</Alert>
                  <label className="check"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />{t(`Replace existing records from ${fmtDate(p.period.from, lang)} to ${fmtDate(p.period.to, lang)}`, `${fmtDate(p.period.from, lang)} থেকে ${fmtDate(p.period.to, lang)} পর্যন্ত বিদ্যমান রেকর্ড প্রতিস্থাপন করুন`)}</label>
                </> : <Alert>{t('No records exist in this period yet.', 'এই সময়ে এখনো কোনো রেকর্ড নেই।')}</Alert>}
                <button className="btn primary" disabled={!canImport} onClick={run}><Upload size={16} />{doImport.isPending ? t('Importing…', 'ইমপোর্ট হচ্ছে…') : t(`Import ${p.totals.days} days`, `${p.totals.days} দিন ইমপোর্ট করুন`)}</button>
              </div>
            </div>

            <div className="card"><DataTable rows={p.rows.map((r, i) => ({ ...r, id: `${r.date}-${i}` }))} columns={cols} /></div>
          </>}
        </div>
      </Card>
      <ImportHistory />
    </>
  );
}

function ImportHistory() {
  const { t, lang } = usePrefs();
  const q = useApi<{ data: Batch[] }>('/import/batches');
  const [undoing, setUndoing] = useState<Batch | null>(null);
  const [reason, setReason] = useState('');
  const undo = useSave<{ reason: string }>('post', () => `/import/batches/${undoing?.id}/undo`, t('Import undone. All its records were voided.', 'ইমপোর্ট ফেরত নেওয়া হয়েছে। এর সব রেকর্ড বাতিল হয়েছে।'));
  const cols: Column<Batch>[] = [
    { key: 'n', label: t('Import', 'ইমপোর্ট'), render: b => <div><b className="mono">{b.number}</b><div className="muted small">{b.fileName ?? '—'}</div></div> },
    { key: 'p', label: t('Period', 'সময়কাল'), render: b => `${fmtDate(b.periodFrom, lang)} – ${fmtDate(b.periodTo, lang)}` },
    { key: 'd', label: t('Days', 'দিন'), num: true, hideSm: true, render: b => fmtNum(b.summary.days, lang) },
    { key: 's', label: t('Net sales', 'নিট বিক্রয়'), num: true, render: b => <Money v={b.summary.netSales} /> },
    { key: 'c', label: t('Imported', 'ইমপোর্টের সময়'), hideSm: true, render: b => fmtDateTime(b.createdAt, lang) },
    { key: 'st', label: t('Status', 'অবস্থা'), render: b => <StatusBadge status={b.status} settled /> },
    { key: 'a', label: '', render: b => b.status === 'POSTED' && <button className="btn sm" onClick={() => { setReason(''); setUndoing(b); }}><Undo2 size={14} />{t('Undo', 'ফেরত নিন')}</button> },
  ];
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><History size={18} />{t('Import history', 'ইমপোর্টের ইতিহাস')}</span>}>
      <DataTable rows={q.data?.data} columns={cols} empty={t('No imports yet.', 'এখনো কোনো ইমপোর্ট হয়নি।')} />
      {undoing && (
        <Dialog title={t(`Undo ${undoing.number}`, `${undoing.number} ফেরত নিন`)} onClose={() => setUndoing(null)} footer={<>
          <button className="btn" onClick={() => setUndoing(null)}>{t('Cancel', 'বাতিল')}</button>
          <button className="btn danger" disabled={reason.trim().length < 3 || undo.isPending} onClick={() => undo.mutate({ reason: reason.trim() }, { onSuccess: () => setUndoing(null) })}>{t('Undo import', 'ইমপোর্ট ফেরত নিন')}</button>
        </>}>
          <Alert tone="warn">{t('Every sale, expense, collection and production record created by this import is voided with a reversing entry. Records you entered by hand are not touched.', 'এই ইমপোর্টে তৈরি প্রতিটি বিক্রয়, খরচ, আদায় ও উৎপাদন রেকর্ড বিপরীত এন্ট্রিসহ বাতিল হবে। হাতে লেখা রেকর্ডে হাত দেওয়া হবে না।')}</Alert>
          <Field label={t('Reason', 'কারণ')}><textarea className="textarea" autoFocus value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </Dialog>
      )}
    </Card>
  );
}
