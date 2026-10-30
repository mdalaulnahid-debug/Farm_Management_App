import { useMemo, useState } from 'react';
import { Bird, Download, Egg, HeartPulse, Pencil, Plus, Wheat, Percent, Ban } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi, useFlocks, useSave } from '../lib/hooks';
import { downloadCsv, fmtDate, fmtMoney, fmtNum, fmtPct, iso10, ymd } from '../lib/format';
import type { Flock } from '../lib/api';
import { Alert, Badge, Card, DataTable, Dialog, Drawer, Empty, Field, Input, Kpi, Loading, PageHeader, RangePicker, Segmented, Select, StatusBadge, Tabs, thisMonth, VoidDialog, type Column } from '../components/ui';
import { Money, ProductionDrawer } from '../components/forms';

interface ProductionLog {
  id: string; date: string; flock: { code: string; name: string }; eggsCollected: number; eggsBroken: number; mortality: number; culled: number;
  feedQty: number; feedCost: number; notes?: string | null; status: string;
}
interface ProductionReport {
  days: { date: string; eggs: number; broken: number; mortality: number; feedQty: number; feedCost: number; birds: number; layingRate: number | null }[];
  totals: { eggs: number; broken: number; mortality: number; feedQty: number; feedCost: number };
  birds: number; activeFlocks: number; avgLayingRate: number | null; feedPerEgg: number | null; feedCostPerEgg: number | null;
}
interface Site { id: string; name: string; kind: string }

type Tab = 'log' | 'flocks';

export default function Production() {
  const { t } = usePrefs();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('log');
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState<Flock | 'new' | null>(null);
  const flocks = useFlocks();
  const zeroCount = (flocks.data?.data ?? []).filter(f => f.status === 'ACTIVE' && f.currentCount === 0);
  const manage = can('production.manage');

  return (
    <>
      <PageHeader crumb={t('Farm', 'খামার')} title={t('Production', 'উৎপাদন')}
        subtitle={t('Daily egg collection, mortality and feed use per flock. Eggs go into stock and feed is expensed at average cost.', 'ঝাঁকভিত্তিক দৈনিক ডিম সংগ্রহ, মৃত্যু ও খাদ্য ব্যবহার। ডিম মজুদে যোগ হয় এবং খাদ্য গড় মূল্যে খরচ হয়।')}
        actions={<>
          {manage && tab === 'flocks' && <button className="btn" onClick={() => setEditing('new')}><Plus size={16} />{t('New flock', 'নতুন ঝাঁক')}</button>}
          {manage && <button className="btn primary" onClick={() => setRecording(true)}><Egg size={16} />{t('Record production', 'উৎপাদন লিখুন')}</button>}
        </>} />

      {zeroCount.length > 0 && (
        <Alert tone="warn">
          <div className="row between">
            <span>{t(
              `${zeroCount.map(f => f.code).join(', ')} ${zeroCount.length > 1 ? 'have' : 'has'} no bird count. Set the current number of birds so laying rate can be calculated.`,
              `${zeroCount.map(f => f.code).join(', ')} ঝাঁকে পাখির সংখ্যা দেওয়া নেই। ডিম পাড়ার হার হিসাবের জন্য বর্তমান পাখির সংখ্যা লিখুন।`)}</span>
            {manage && <button className="btn sm" onClick={() => { setTab('flocks'); setEditing(zeroCount[0]); }}>{t('Set bird count', 'পাখির সংখ্যা লিখুন')}</button>}
          </div>
        </Alert>
      )}

      <Tabs value={tab} onChange={setTab} options={[{ value: 'log', label: t('Daily log', 'দৈনিক খাতা') }, { value: 'flocks', label: t('Flocks', 'ঝাঁক') }]} />

      {tab === 'log' ? <DailyLog /> : <Flocks flocks={flocks.data?.data} onEdit={manage ? setEditing : undefined} />}

      {recording && <ProductionDrawer onClose={() => setRecording(false)} />}
      {editing && <FlockDrawer flock={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// ───── Daily log ─────
function DailyLog() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const [range, setRange] = useState(thisMonth());
  const [flockId, setFlockId] = useState('');
  const [page, setPage] = useState(1);
  const [voidId, setVoidId] = useState<string | null>(null);
  const flocks = useFlocks();
  const list = useApi<{ data: ProductionLog[]; total: number }>('/production', { ...range, flockId: flockId || undefined, page, pageSize: 50 });
  const report = useApi<ProductionReport>('/reports/production', range);
  const voidIt = useSave<{ reason: string }>('post', () => `/production/${voidId}/void`, t('Production record voided.', 'উৎপাদন রেকর্ড বাতিল হয়েছে।'));
  const r = report.data;

  const columns: Column<ProductionLog>[] = [
    { key: 'date', label: t('Date', 'তারিখ'), render: x => fmtDate(x.date, lang) },
    { key: 'flock', label: t('Flock', 'ঝাঁক'), render: x => <><b className="mono">{x.flock.code}</b> <span className="muted small">{x.flock.name}</span></> },
    { key: 'eggs', label: t('Eggs', 'ডিম'), num: true, render: x => <b>{fmtNum(x.eggsCollected, lang, 0)}</b> },
    { key: 'broken', label: t('Broken', 'ভাঙা'), num: true, render: x => (x.eggsBroken ? <span className="neg">{fmtNum(x.eggsBroken, lang, 0)}</span> : <span className="muted">0</span>) },
    { key: 'mortality', label: t('Deaths', 'মৃত্যু'), num: true, render: x => (x.mortality ? <span className="neg">{fmtNum(x.mortality, lang, 0)}</span> : <span className="muted">0</span>) },
    { key: 'culled', label: t('Culled', 'বাছাই'), num: true, hideSm: true, render: x => fmtNum(x.culled, lang, 0) },
    { key: 'feedQty', label: t('Feed used', 'ব্যবহৃত খাদ্য'), num: true, hideSm: true, render: x => fmtNum(x.feedQty, lang) },
    { key: 'feedCost', label: t('Feed cost', 'খাদ্য খরচ'), num: true, render: x => <Money v={x.feedCost} /> },
    { key: 'status', label: t('Status', 'অবস্থা'), render: x => (x.status === 'VOID' ? <StatusBadge status="VOID" /> : <Badge tone="green">{t('Posted', 'পোস্টকৃত')}</Badge>) },
    { key: 'notes', label: t('Notes', 'নোট'), hideSm: true, render: x => <span className="muted small">{x.notes || ''}</span> },
    ...(can('production.manage') ? [{
      key: 'act', label: '', render: (x: ProductionLog) => x.status !== 'VOID' && (
        <button className="btn ghost sm" onClick={() => setVoidId(x.id)} title={t('Void this record', 'এই রেকর্ড বাতিল')}><Ban size={14} />{t('Void', 'বাতিল')}</button>
      ),
    }] : []),
  ];

  const exportCsv = () => downloadCsv(`production_${range.from}_${range.to}.csv`,
    ['Date', 'Flock code', 'Flock', 'Eggs collected', 'Broken', 'Mortality', 'Culled', 'Feed qty', 'Feed cost', 'Status', 'Notes'],
    (list.data?.data ?? []).map(x => [iso10(x.date), x.flock.code, x.flock.name, x.eggsCollected, x.eggsBroken, x.mortality, x.culled, x.feedQty, x.feedCost, x.status, x.notes ?? '']));

  const chartData = useMemo(() => (r?.days ?? []).map(d => ({ ...d, label: fmtDate(d.date, lang).replace(/\s?\d{4}$/, '') })), [r, lang]);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Kpi icon={Egg} label={t('Eggs collected', 'সংগৃহীত ডিম')} value={r ? fmtNum(r.totals.eggs, lang, 0) : '—'}
          sub={r ? t(`${fmtNum(r.totals.broken, lang, 0)} broken / rejected`, `${fmtNum(r.totals.broken, lang, 0)}টি ভাঙা / বাতিল`) : undefined} />
        <Kpi icon={Percent} tone="blue" label={t('Avg laying rate', 'গড় ডিম পাড়ার হার')} value={r ? fmtPct(r.avgLayingRate, lang) : '—'}
          sub={t('Eggs ÷ birds, per day', 'ডিম ÷ পাখি, প্রতিদিন')} />
        <Kpi icon={Bird} label={t('Birds alive', 'জীবিত পাখি')} value={r ? fmtNum(r.birds, lang, 0) : '—'}
          sub={r ? t(`${r.activeFlocks} active flock${r.activeFlocks === 1 ? '' : 's'}`, `${r.activeFlocks}টি সক্রিয় ঝাঁক`) : undefined} />
        <Kpi icon={HeartPulse} tone="red" label={t('Mortality & culls', 'মৃত্যু ও বাছাই')} value={r ? fmtNum(r.totals.mortality, lang, 0) : '—'}
          sub={r && r.birds ? t(`≈ ${fmtPct((r.totals.mortality / (r.birds + r.totals.mortality)) * 100, lang)} of birds`, `ঝাঁকের ${fmtPct((r.totals.mortality / (r.birds + r.totals.mortality)) * 100, lang)}`) : undefined} />
        <Kpi icon={Wheat} tone="amber" label={t('Feed cost per egg', 'ডিমপ্রতি খাদ্য খরচ')} value={r?.feedCostPerEgg != null ? fmtMoney(r.feedCostPerEgg, lang, { decimals: 2 }) : '—'}
          sub={r ? t(`Feed cost ${fmtMoney(r.totals.feedCost, lang)}`, `খাদ্য খরচ ${fmtMoney(r.totals.feedCost, lang)}`) : undefined} />
      </div>

      <Card title={t('Daily eggs & laying rate', 'দৈনিক ডিম ও পাড়ার হার')} subtitle={t('Posted records only', 'শুধু পোস্টকৃত রেকর্ড')}
        actions={<div className="legend"><span><i style={{ background: 'var(--chart-1)' }} />{t('Eggs', 'ডিম')}</span><span><i style={{ background: 'var(--chart-2)' }} />{t('Laying rate %', 'পাড়ার হার %')}</span></div>}>
        {!r ? <Loading /> : !chartData.length ? <Empty>{t('No production recorded in this period.', 'এই সময়ে কোনো উৎপাদন লেখা হয়নি।')}</Empty> : (
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={16} />
                <YAxis yAxisId="eggs" tick={{ fill: 'var(--text-3)', fontSize: 12 }} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
                <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} unit="%" tick={{ fill: 'var(--text-3)', fontSize: 12 }} tickLine={false} axisLine={false} width={44} />
                <Tooltip cursor={{ fill: 'var(--surface-3)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                  formatter={(v: any, name: any) => (name === 'layingRate' ? [fmtPct(v, lang), t('Laying rate', 'পাড়ার হার')] : [fmtNum(v, lang, 0), t('Eggs', 'ডিম')])} />
                <Bar yAxisId="eggs" dataKey="eggs" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line yAxisId="rate" dataKey="layingRate" stroke="var(--chart-2)" strokeWidth={2} dot={false} connectNulls type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title={t('Production records', 'উৎপাদন রেকর্ড')} actions={<>
        <Select style={{ width: 'auto' }} value={flockId} onChange={e => { setFlockId(e.target.value); setPage(1); }} placeholder={t('All flocks', 'সব ঝাঁক')}
          options={(flocks.data?.data ?? []).map(f => ({ value: f.id, label: `${f.code} · ${f.name}` }))} />
        <RangePicker value={range} onChange={x => { setRange(x); setPage(1); }} />
        <button className="btn" onClick={exportCsv} disabled={!list.data?.data.length}><Download size={16} />{t('Export', 'ডাউনলোড')}</button>
      </>}>
        <DataTable rows={list.data?.data} columns={columns} page={page} pageSize={50} total={list.data?.total} onPage={setPage}
          empty={t('No production recorded for this period yet.', 'এই সময়ে এখনো কোনো উৎপাদন লেখা হয়নি।')} />
      </Card>

      {voidId && <VoidDialog what={t('production record', 'উৎপাদন রেকর্ড')} busy={voidIt.isPending} onClose={() => setVoidId(null)}
        onConfirm={reason => voidIt.mutate({ reason }, { onSuccess: () => setVoidId(null) })} />}
    </>
  );
}

// ───── Flocks ─────
function Flocks({ flocks, onEdit }: { flocks: Flock[] | undefined; onEdit?: (f: Flock) => void }) {
  const { t, lang } = usePrefs();
  const [status, setStatus] = useState<'ACTIVE' | 'CLOSED' | 'all'>('ACTIVE');
  const rows = flocks?.filter(f => status === 'all' || f.status === status);
  const survival = (f: Flock) => (f.openingCount > 0 ? (f.currentCount / f.openingCount) * 100 : null);

  const columns: Column<Flock>[] = [
    { key: 'code', label: t('Code', 'কোড'), render: f => <b className="mono">{f.code}</b> },
    { key: 'name', label: t('Flock', 'ঝাঁক'), render: f => <>{f.name}<div className="muted small">{[speciesLabel(t, f.species), f.breed].filter(Boolean).join(' · ')}</div></> },
    { key: 'site', label: t('Site', 'স্থান'), hideSm: true, render: f => f.site?.name ?? <span className="muted">—</span> },
    { key: 'start', label: t('Started', 'শুরু'), hideSm: true, render: f => fmtDate(f.startDate, lang) },
    { key: 'opening', label: t('Opening birds', 'শুরুর পাখি'), num: true, hideSm: true, render: f => fmtNum(f.openingCount, lang, 0) },
    { key: 'current', label: t('Current birds', 'বর্তমান পাখি'), num: true, render: f => (f.status === 'ACTIVE' && f.currentCount === 0 ? <Badge tone="amber">{t('Not set', 'দেওয়া নেই')}</Badge> : <b>{fmtNum(f.currentCount, lang, 0)}</b>) },
    {
      key: 'survival', label: t('Survival', 'টিকে থাকা'), num: true, render: f => {
        const s = survival(f);
        return s === null ? <span className="muted">—</span> : <span className={s < 90 ? 'neg' : ''}>{fmtPct(s, lang)}</span>;
      },
    },
    { key: 'status', label: t('Status', 'অবস্থা'), render: f => <StatusBadge status={f.status} /> },
    ...(onEdit ? [{ key: 'act', label: '', render: (f: Flock) => <button className="btn ghost sm icon" aria-label={t('Edit', 'সম্পাদনা')} onClick={e => { e.stopPropagation(); onEdit(f); }}><Pencil size={14} /></button> }] : []),
  ];

  const exportCsv = () => downloadCsv('flocks.csv', ['Code', 'Name', 'Species', 'Breed', 'Site', 'Start date', 'Opening count', 'Current count', 'Survival %', 'Status', 'Notes'],
    (rows ?? []).map(f => [f.code, f.name, f.species, f.breed ?? '', f.site?.name ?? '', iso10(f.startDate), f.openingCount, f.currentCount, survival(f)?.toFixed(1) ?? '', f.status, f.notes ?? '']));

  return (
    <Card title={t('Flocks', 'ঝাঁক')} subtitle={t('Bird counts drive laying rate and mortality figures. Production logs reduce the current count automatically.', 'পাখির সংখ্যা থেকেই ডিম পাড়ার হার ও মৃত্যুহার হিসাব হয়। উৎপাদন খাতায় মৃত্যু লিখলে বর্তমান সংখ্যা নিজে থেকেই কমে।')}
      actions={<>
        <Segmented value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: t('Active', 'সক্রিয়') }, { value: 'CLOSED', label: t('Closed', 'বন্ধ') }, { value: 'all', label: t('All', 'সব') }]} />
        <button className="btn" onClick={exportCsv} disabled={!rows?.length}><Download size={16} />{t('Export', 'ডাউনলোড')}</button>
      </>}>
      <DataTable rows={rows} columns={columns} onRow={onEdit}
        empty={status === 'ACTIVE' ? t('No active flocks. Add a flock to start recording production.', 'কোনো সক্রিয় ঝাঁক নেই। উৎপাদন লিখতে একটি ঝাঁক যোগ করুন।') : t('No flocks to show.', 'দেখানোর মতো কোনো ঝাঁক নেই।')} />
    </Card>
  );
}

const SPECIES = ['DUCK', 'CHICKEN', 'GOOSE', 'QUAIL'];
const speciesLabel = (t: (en: string, bn: string) => string, s: string) => ({
  DUCK: t('Duck', 'হাঁস'), CHICKEN: t('Chicken', 'মুরগি'), GOOSE: t('Goose', 'রাজহাঁস'), QUAIL: t('Quail', 'কোয়েল'),
} as Record<string, string>)[s] ?? s;

const siteKindLabel = (t: (en: string, bn: string) => string, k: string) => ({
  FARM: t('Farm', 'খামার'), SHED: t('Shed', 'শেড'), POND: t('Pond', 'পুকুর'), STORE: t('Store', 'গুদাম'),
} as Record<string, string>)[k] ?? k;

function FlockDrawer({ flock, onClose }: { flock: Flock | null; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const sites = useApi<{ data: Site[] }>('/sites');
  const [addingSite, setAddingSite] = useState(false);
  const [f, setF] = useState({
    code: flock?.code ?? '', name: flock?.name ?? '', species: flock?.species ?? 'DUCK', breed: flock?.breed ?? '', siteId: flock?.siteId ?? '',
    startDate: flock ? iso10(flock.startDate) : ymd(), openingCount: flock ? String(flock.openingCount) : '', currentCount: flock ? String(flock.currentCount) : '',
    status: (flock?.status ?? 'ACTIVE') as 'ACTIVE' | 'CLOSED', notes: flock?.notes ?? '',
  });
  const create = useSave('post', '/flocks', t('Flock created.', 'ঝাঁক তৈরি হয়েছে।'));
  const update = useSave('put', `/flocks/${flock?.id}`, t('Flock updated.', 'ঝাঁক হালনাগাদ হয়েছে।'));
  const busy = create.isPending || update.isPending;
  const count = Number(flock ? f.currentCount : f.openingCount);
  const valid = f.code.trim().length >= 2 && f.name.trim().length >= 2 && !!f.startDate && f.species && (flock ? f.currentCount : f.openingCount) !== '' && Number.isInteger(count) && count >= 0;
  const speciesOptions = [...SPECIES, ...(SPECIES.includes(f.species) ? [] : [f.species])].map(s => ({ value: s, label: speciesLabel(t, s) }));
  const survival = flock && flock.openingCount > 0 && f.currentCount !== '' ? (Number(f.currentCount) / flock.openingCount) * 100 : null;

  const submit = () => {
    const common = { code: f.code.trim(), name: f.name.trim(), species: f.species, breed: f.breed || null, siteId: f.siteId || null, startDate: f.startDate, notes: f.notes || null };
    if (flock) update.mutate({ ...common, status: f.status, currentCount: Number(f.currentCount) }, { onSuccess: onClose });
    else create.mutate({ ...common, openingCount: Number(f.openingCount) }, { onSuccess: onClose });
  };

  return (
    <Drawer narrow title={flock ? t(`Edit flock ${flock.code}`, `ঝাঁক ${flock.code} সম্পাদনা`) : t('New flock', 'নতুন ঝাঁক')}
      subtitle={flock ? `${flock.name}` : t('A batch of birds placed together, tracked from placement to closing.', 'একসাথে রাখা এক দল পাখি — শুরু থেকে বন্ধ পর্যন্ত হিসাব রাখা হয়।')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={!valid || busy} onClick={submit}>{flock ? t('Save changes', 'পরিবর্তন সংরক্ষণ') : t('Create flock', 'ঝাঁক তৈরি')}</button></>}>
      <div className="form-grid">
        <Field label={t('Code', 'কোড')} hint={t('Short unique ID, e.g. D-2026-01', 'ছোট অনন্য আইডি, যেমন D-2026-01')}><Input value={f.code} autoFocus={!flock} maxLength={20} onChange={e => setF({ ...f, code: e.target.value })} /></Field>
        <Field label={t('Name', 'নাম')}><Input value={f.name} maxLength={80} onChange={e => setF({ ...f, name: e.target.value })} placeholder={t('e.g. Khaki Campbell layers', 'যেমন খাকি ক্যাম্পবেল লেয়ার')} /></Field>
        <Field label={t('Species', 'প্রজাতি')}><Select value={f.species} onChange={e => setF({ ...f, species: e.target.value })} options={speciesOptions} /></Field>
        <Field label={t('Breed', 'জাত')}><Input value={f.breed} maxLength={60} onChange={e => setF({ ...f, breed: e.target.value })} /></Field>
        <Field label={t('Site', 'স্থান')} className="full">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Select value={f.siteId} onChange={e => setF({ ...f, siteId: e.target.value })} placeholder={t('— No site —', '— স্থান নেই —')}
              options={(sites.data?.data ?? []).map(s => ({ value: s.id, label: `${s.name} (${siteKindLabel(t, s.kind)})` }))} />
            <button type="button" className="btn" onClick={e => { e.preventDefault(); setAddingSite(true); }}><Plus size={15} />{t('Site', 'স্থান')}</button>
          </div>
        </Field>
        <Field label={t('Start / placement date', 'শুরুর তারিখ')}><Input type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></Field>
        {flock ? (
          <Field label={t('Current bird count', 'বর্তমান পাখির সংখ্যা')} hint={survival !== null ? t(`Opening ${fmtNum(flock.openingCount, lang, 0)} · survival ${fmtPct(survival, lang)}`, `শুরুতে ${fmtNum(flock.openingCount, lang, 0)} · টিকে আছে ${fmtPct(survival, lang)}`) : t('Used for laying rate', 'ডিম পাড়ার হারের জন্য দরকার')}>
            <Input type="number" min="0" step="1" value={f.currentCount} onChange={e => setF({ ...f, currentCount: e.target.value })} />
          </Field>
        ) : (
          <Field label={t('Opening bird count', 'শুরুর পাখির সংখ্যা')} hint={t('Current count starts at this number', 'বর্তমান সংখ্যা এখান থেকে শুরু হবে')}>
            <Input type="number" min="0" step="1" value={f.openingCount} onChange={e => setF({ ...f, openingCount: e.target.value })} />
          </Field>
        )}
        {flock && (
          <Field label={t('Status', 'অবস্থা')} className="full" hint={t('Close a flock when it is sold or retired. Closed flocks no longer appear in the production form.', 'বিক্রি বা অবসরের পর ঝাঁক বন্ধ করুন। বন্ধ ঝাঁক উৎপাদন ফর্মে আর দেখাবে না।')}>
            <Segmented value={f.status} onChange={v => setF({ ...f, status: v })} options={[{ value: 'ACTIVE', label: t('Active', 'সক্রিয়') }, { value: 'CLOSED', label: t('Closed', 'বন্ধ') }]} />
          </Field>
        )}
        <Field label={t('Notes', 'নোট')} className="full"><textarea className="textarea" maxLength={300} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {addingSite && <SiteDialog onClose={() => setAddingSite(false)} onCreated={id => { setF(x => ({ ...x, siteId: id })); setAddingSite(false); }} />}
    </Drawer>
  );
}

function SiteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = usePrefs();
  const [s, setS] = useState({ name: '', kind: 'SHED' as 'FARM' | 'SHED' | 'POND' | 'STORE' });
  const save = useSave<typeof s, Site>('post', '/sites', t('Site added.', 'স্থান যোগ হয়েছে।'));
  const valid = s.name.trim().length >= 2;
  return (
    <Dialog title={t('Add site', 'স্থান যোগ')} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button>
      <button className="btn primary" disabled={!valid || save.isPending} onClick={() => save.mutate({ ...s, name: s.name.trim() }, { onSuccess: site => onCreated(site.id) })}>{t('Add site', 'স্থান যোগ')}</button>
    </>}>
      <Field label={t('Name', 'নাম')}><Input autoFocus value={s.name} maxLength={80} onChange={e => setS({ ...s, name: e.target.value })} placeholder={t('e.g. Shed 2 (pond side)', 'যেমন শেড ২ (পুকুরপাড়)')} /></Field>
      <Field label={t('Kind', 'ধরন')}><Select value={s.kind} onChange={e => setS({ ...s, kind: e.target.value as typeof s.kind })} options={(['FARM', 'SHED', 'POND', 'STORE'] as const).map(k => ({ value: k, label: siteKindLabel(t, k) }))} /></Field>
    </Dialog>
  );
}
