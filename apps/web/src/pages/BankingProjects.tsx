// Cash & bank → Grants received, Side projects. Also the "Grant received" quick form used by the + New menu.
import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Gift, Pencil, Plus, Tractor } from 'lucide-react';
import { nameOf, usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi, useSave } from '../lib/hooks';
import { fmtDate, fmtMoney, ymd } from '../lib/format';
import { Alert, Badge, Card, DataTable, Drawer, Empty, Field, Input, Kpi, Segmented, Select, StatusBadge, VoidDialog, type Column } from '../components/ui';
import { CashAccountSelect, Money, methodOptions } from '../components/forms';

interface Project { id: string; code: string; name: string; nameBn?: string | null; kind: string; isMain: boolean; active: boolean; notes?: string | null }
interface ProjectSum extends Project { sent: number; returned: number; held: number; income: number; expenses: number; profit: number }
interface Grant { id: string; number: string; date: string; amount: number; method: string; reference?: string | null; notes?: string | null; status: string; party?: { id: string; name: string; phone?: string | null } | null }
interface Transfer { id: string; number: string; date: string; memo: string; status: string; direction: 'IN' | 'OUT'; amount: number; project: Project }

export const projectName = (lang: string, p?: Pick<Project, 'name' | 'nameBn'> | null) => (!p ? '—' : nameOf(p, lang));
export const useProjects = () => useApi<{ data: Project[] }>('/projects');

// ───── Grant received ─────
export function GrantDrawer({ onClose }: { onClose: () => void }) {
  const { t, lang } = usePrefs();
  const projects = useProjects();
  const [f, setF] = useState({ date: ymd(), name: '', phone: '', amount: '', cashAccountId: '', method: 'CASH', reference: '', notes: '', projectId: '' });
  const save = useSave('post', '/grants', t('Grant recorded as grant income.', 'অনুদান প্রাপ্তি হিসেবে লেখা হয়েছে।'));
  const valid = (f.name.trim().length >= 2 || f.phone.trim().length >= 6) && Number(f.amount) > 0 && !!f.cashAccountId;
  const submit = () => save.mutate({
    date: f.date, donor: { name: f.name.trim() || null, phone: f.phone.trim() || null }, amount: Number(f.amount), cashAccountId: f.cashAccountId,
    method: f.method, reference: f.reference.trim() || null, notes: f.notes.trim() || null, projectId: f.projectId || null,
  }, { onSuccess: onClose });
  return (
    <Drawer narrow title={t('Grant received', 'অনুদান প্রাপ্তি')} subtitle={t('Money given to the farm by a person or organisation. Booked as grant income — not sales, not owner’s capital.', 'কোনো ব্যক্তি বা প্রতিষ্ঠানের দেওয়া টাকা। অনুদান আয় হিসেবে লেখা হয় — বিক্রয় বা মালিকের মূলধন নয়।')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={!valid || save.isPending} onClick={submit}>{t('Save', 'সংরক্ষণ')}</button></>}>
      <div className="form-grid">
        <Field label={t('Given by (name)', 'অনুদানদাতার নাম')}><Input value={f.name} autoFocus onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('Mobile number', 'মোবাইল নম্বর')} hint={t('Recognises the same person next time.', 'পরের বার একই ব্যক্তিকে চিনবে।')}><Input type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
        <Field label={t('Date', 'তারিখ')}><Input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t('Amount', 'টাকা')}><Input type="number" min="0" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t('Received into', 'যে হিসাবে জমা')}><CashAccountSelect value={f.cashAccountId} onChange={v => setF(x => ({ ...x, cashAccountId: v }))} /></Field>
        <Field label={t('Paid by', 'মাধ্যম')}><Select value={f.method} onChange={e => setF({ ...f, method: e.target.value })} options={methodOptions(t)} /></Field>
        <Field label={t('For project', 'কোন প্রকল্পের জন্য')}><Select value={f.projectId} onChange={e => setF({ ...f, projectId: e.target.value })} placeholder={t('Main farm (duck)', 'মূল খামার (হাঁস)')} options={(projects.data?.data ?? []).filter(p => p.active && !p.isMain).map(p => ({ value: p.id, label: projectName(lang, p) }))} /></Field>
        <Field label={t('Reference', 'রেফারেন্স')}><Input value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} placeholder={t('Transaction ID / cheque no.', 'লেনদেন আইডি / চেক নং')} /></Field>
        <Field label={t('Purpose / notes', 'উদ্দেশ্য / নোট')} className="full"><textarea className="textarea" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}

export function GrantsTab() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const q = useApi<{ data: Grant[]; total: number }>('/grants');
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState<Grant | null>(null);
  const voidIt = useSave<{ reason: string }>('post', () => `/payments/${voiding?.id}/void`, t('Grant voided.', 'অনুদান বাতিল হয়েছে।'));
  const live = (q.data?.data ?? []).filter(g => g.status !== 'VOID');
  const donors = new Set(live.map(g => g.party?.id ?? 'none')).size;
  const cols: Column<Grant>[] = [
    { key: 'date', label: t('Date', 'তারিখ'), render: g => fmtDate(g.date, lang) },
    { key: 'donor', label: t('Given by', 'অনুদানদাতা'), render: g => <div><b>{g.party?.name ?? t('Not recorded (workbook)', 'লেখা নেই (ওয়ার্কবুক)')}</b>{g.party?.phone && <div className="muted small">{g.party.phone}</div>}</div> },
    { key: 'notes', label: t('Purpose', 'উদ্দেশ্য'), hideSm: true, render: g => <span className="muted">{g.notes ?? '—'}</span> },
    { key: 'status', label: t('Status', 'অবস্থা'), render: g => <StatusBadge status={g.status} settled /> },
    { key: 'amount', label: t('Amount', 'টাকা'), num: true, render: g => <Money v={g.amount} /> },
    { key: 'a', label: '', render: g => can('banking.manage') && g.status !== 'VOID' && <button className="btn ghost sm" onClick={e => { e.stopPropagation(); setVoiding(g); }}>{t('Void', 'বাতিল')}</button> },
  ];
  return (
    <>
      <div className="grid g3">
        <Kpi icon={Gift} label={t('Grants received (all time)', 'মোট অনুদান প্রাপ্তি')} value={<Money v={q.data?.total} />} sub={t(`${live.length} grants`, `${live.length}টি অনুদান`)} />
        <Kpi icon={Gift} tone="blue" label={t('Donors', 'অনুদানদাতা')} value={donors} />
        <div className="card card-pad small muted">{t('Grants appear in Profit & loss under Other income, so the farming profit (operating profit) stays clean.', 'অনুদান লাভ-ক্ষতিতে অন্যান্য আয়ে দেখায়, তাই খামারের পরিচালন মুনাফা আলাদা থাকে।')}</div>
      </div>
      <Card title={t('Grants received', 'অনুদান প্রাপ্তি')} actions={can('banking.manage') && <button className="btn primary" onClick={() => setOpen(true)}><Plus size={16} />{t('Record grant', 'অনুদান লিখুন')}</button>}>
        <DataTable rows={q.data?.data} columns={cols} empty={t('No grants recorded yet.', 'এখনো কোনো অনুদান লেখা হয়নি।')} />
      </Card>
      {open && <GrantDrawer onClose={() => setOpen(false)} />}
      {voiding && <VoidDialog what={t('grant', 'অনুদান')} busy={voidIt.isPending} onClose={() => setVoiding(null)} onConfirm={reason => voidIt.mutate({ reason }, { onSuccess: () => setVoiding(null) })} />}
    </>
  );
}

// ───── Side projects ─────
const KINDS = (t: (en: string, bn: string) => string) => [
  { value: 'POULTRY_EGGS', label: t('Poultry — eggs', 'পোলট্রি — ডিম') },
  { value: 'DAIRY', label: t('Cattle — dairy (milk)', 'গরু — দুধ') },
  { value: 'FATTENING', label: t('Cattle — fattening', 'গরু — মোটাতাজাকরণ') },
  { value: 'POULTRY_MEAT', label: t('Poultry — meat', 'পোলট্রি — মাংস') },
  { value: 'OTHER', label: t('Other', 'অন্যান্য') },
];

function TransferDrawer({ projects, initialProjectId, onClose }: { projects: Project[]; initialProjectId?: string; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const side = projects.filter(p => !p.isMain && p.active);
  const [f, setF] = useState({ date: ymd(), projectId: initialProjectId ?? '', direction: 'OUT' as 'OUT' | 'IN', cashAccountId: '', amount: '', memo: '' });
  useEffect(() => { if (!f.projectId && side[0]) setF(x => ({ ...x, projectId: side[0].id })); }, [side, f.projectId]);
  const save = useSave('post', '/project-transfers', t('Transfer recorded.', 'স্থানান্তর লেখা হয়েছে।'));
  const valid = !!f.projectId && !!f.cashAccountId && Number(f.amount) > 0;
  return (
    <Drawer narrow title={t('Money to / from a side project', 'সাইড প্রকল্পে টাকা দেওয়া / ফেরত')} subtitle={t('Not an expense of the duck farm: the amount is kept as “Funds with side projects” until it is returned or spent by that project.', 'হাঁসের খামারের খরচ নয়: টাকাটি ফেরত বা সেই প্রকল্পে খরচ না হওয়া পর্যন্ত “সাইড প্রকল্পে দেওয়া অর্থ” হিসেবে থাকে।')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={!valid || save.isPending} onClick={() => save.mutate({ ...f, amount: Number(f.amount), memo: f.memo.trim() || null }, { onSuccess: onClose })}>{t('Save', 'সংরক্ষণ')}</button></>}>
      <Segmented value={f.direction} onChange={v => setF({ ...f, direction: v })} options={[{ value: 'OUT', label: t('Send to project', 'প্রকল্পে পাঠানো') }, { value: 'IN', label: t('Returned from project', 'প্রকল্প থেকে ফেরত') }]} />
      <div className="form-grid">
        <Field label={t('Project', 'প্রকল্প')}><Select value={f.projectId} onChange={e => setF({ ...f, projectId: e.target.value })} options={side.map(p => ({ value: p.id, label: projectName(lang, p) }))} /></Field>
        <Field label={t('Date', 'তারিখ')}><Input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t('Amount', 'টাকা')}><Input type="number" min="0" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={f.direction === 'OUT' ? t('Paid from', 'যে হিসাব থেকে') : t('Received into', 'যে হিসাবে জমা')}><CashAccountSelect value={f.cashAccountId} onChange={v => setF(x => ({ ...x, cashAccountId: v }))} /></Field>
        <Field label={t('Purpose', 'উদ্দেশ্য')} className="full"><Input value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} placeholder={t('e.g. cow feed, vaccine, shed repair', 'যেমন: গরুর খাবার, টিকা, শেড মেরামত')} /></Field>
      </div>
    </Drawer>
  );
}

function ProjectDrawer({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ code: project?.code ?? '', name: project?.name ?? '', nameBn: project?.nameBn ?? '', kind: project?.kind ?? 'DAIRY', active: project?.active ?? true, notes: project?.notes ?? '' });
  const save = useSave(project ? 'put' : 'post', project ? `/projects/${project.id}` : '/projects', t('Project saved.', 'প্রকল্প সংরক্ষিত হয়েছে।'));
  const valid = /^[A-Za-z0-9_-]{2,20}$/.test(f.code.trim()) && f.name.trim().length >= 2;
  return (
    <Drawer narrow title={project ? t('Edit project', 'প্রকল্প সম্পাদনা') : t('New project', 'নতুন প্রকল্প')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={!valid || save.isPending} onClick={() => save.mutate({ ...f, code: f.code.trim().toUpperCase(), nameBn: f.nameBn || null, notes: f.notes || null }, { onSuccess: onClose })}>{t('Save', 'সংরক্ষণ')}</button></>}>
      <div className="form-grid">
        <Field label={t('Code', 'কোড')}><Input value={f.code} disabled={!!project?.isMain} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder={t('e.g. GOAT', 'যেমন: GOAT')} /></Field>
        <Field label={t('Type', 'ধরন')}><Select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} options={KINDS(t)} /></Field>
        <Field label={t('Name', 'নাম')}><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('Name (Bangla)', 'নাম (বাংলা)')}><Input value={f.nameBn} onChange={e => setF({ ...f, nameBn: e.target.value })} /></Field>
        <Field label={t('Notes', 'নোট')} className="full"><textarea className="textarea" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        {!project?.isMain && <label className="check full"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />{t('Active', 'সক্রিয়')}</label>}
      </div>
    </Drawer>
  );
}

export function ProjectsTab() {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const summary = useApi<{ data: ProjectSum[] }>('/projects/summary');
  const transfers = useApi<{ data: Transfer[] }>('/project-transfers');
  const [transferFor, setTransferFor] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState<Project | null | undefined>(undefined);
  const [voiding, setVoiding] = useState<Transfer | null>(null);
  const voidIt = useSave<{ reason: string }>('post', () => `/journals/${voiding?.id}/void`, t('Transfer voided.', 'স্থানান্তর বাতিল হয়েছে।'));
  const projects = summary.data?.data ?? [];
  const held = projects.reduce((a, p) => a + p.held, 0);
  const cols: Column<Transfer>[] = [
    { key: 'date', label: t('Date', 'তারিখ'), render: x => fmtDate(x.date, lang) },
    { key: 'p', label: t('Project', 'প্রকল্প'), render: x => projectName(lang, x.project) },
    { key: 'd', label: t('Direction', 'দিক'), render: x => x.direction === 'OUT' ? <Badge tone="amber"><ArrowUpRight size={12} />{t('Sent', 'পাঠানো')}</Badge> : <Badge tone="green"><ArrowDownLeft size={12} />{t('Returned', 'ফেরত')}</Badge> },
    { key: 'm', label: t('Purpose', 'উদ্দেশ্য'), hideSm: true, render: x => <span className="muted">{x.memo}</span> },
    { key: 'amt', label: t('Amount', 'টাকা'), num: true, render: x => <Money v={x.amount} /> },
    { key: 'a', label: '', render: x => can('banking.manage') && x.status !== 'VOID' ? <button className="btn ghost sm" onClick={() => setVoiding(x)}>{t('Void', 'বাতিল')}</button> : x.status === 'VOID' ? <StatusBadge status="VOID" /> : null },
  ];
  return (
    <>
      <Alert>{t('The duck farm is the main business. Cow and chicken are side projects: money sent to them is tracked here and never counted as a duck-farm expense. Each project already has its own Profit & loss (Reports → filter by project); full cow modules (milk, fattening) come next.', 'হাঁসের খামার মূল ব্যবসা। গরু ও মুরগি সাইড প্রকল্প: এদের পাঠানো টাকা এখানে ট্র্যাক হয় এবং কখনো হাঁসের খামারের খরচ ধরা হয় না। প্রতিটি প্রকল্পের আলাদা লাভ-ক্ষতি আছে (রিপোর্ট → প্রকল্প বাছাই); গরুর পূর্ণ মডিউল (দুধ, মোটাতাজাকরণ) পরের ধাপে আসছে।')}</Alert>
      <div className="grid g3">
        {projects.map(p => (
          <div key={p.id} className="card card-pad stack gap-8">
            <div className="row between">
              <div className="row gap-8"><span className="kpi-icon">{p.isMain ? '🦆' : p.kind === 'POULTRY_MEAT' ? '🐔' : p.kind === 'DAIRY' || p.kind === 'FATTENING' ? '🐄' : <Tractor size={15} />}</span><b>{projectName(lang, p)}</b></div>
              <div className="row gap-4">{p.isMain ? <Badge tone="blue">{t('Main', 'মূল')}</Badge> : !p.active && <Badge>{t('Inactive', 'নিষ্ক্রিয়')}</Badge>}
                {can('settings.manage') && <button className="btn ghost sm icon" aria-label={t('Edit', 'সম্পাদনা')} onClick={() => setEditing(p)}><Pencil size={14} /></button>}</div>
            </div>
            <dl className="desc-list small">
              {!p.isMain && <><dt>{t('Sent', 'পাঠানো')}</dt><dd><Money v={p.sent} /></dd><dt>{t('Returned', 'ফেরত')}</dt><dd><Money v={p.returned} /></dd><dt>{t('Still with project', 'প্রকল্পে আছে')}</dt><dd><b><Money v={p.held} /></b></dd></>}
              <dt>{t('Income recorded', 'লেখা আয়')}</dt><dd><Money v={p.income} /></dd>
              <dt>{t('Expenses recorded', 'লেখা খরচ')}</dt><dd><Money v={p.expenses} /></dd>
            </dl>
            {!p.isMain && p.active && can('banking.manage') && <button className="btn sm" onClick={() => setTransferFor(p.id)}>{t('Send / receive money', 'টাকা পাঠান / ফেরত নিন')}</button>}
          </div>
        ))}
      </div>
      <Card title={t('Transfers to and from side projects', 'সাইড প্রকল্পে আদান-প্রদান')} subtitle={t(`Currently with side projects: ${fmtMoney(held, lang)}`, `বর্তমানে সাইড প্রকল্পে আছে: ${fmtMoney(held, lang)}`)}
        actions={<>
          {can('settings.manage') && <button className="btn" onClick={() => setEditing(null)}><Plus size={16} />{t('New project', 'নতুন প্রকল্প')}</button>}
          {can('banking.manage') && <button className="btn primary" onClick={() => setTransferFor(null)}><ArrowUpRight size={16} />{t('Send / receive money', 'টাকা পাঠান / ফেরত নিন')}</button>}
        </>}>
        {transfers.data && !transfers.data.data.length ? <Empty>{t('No money moved to side projects yet.', 'এখনো সাইড প্রকল্পে কোনো টাকা দেওয়া হয়নি।')}</Empty> : <DataTable rows={transfers.data?.data} columns={cols} />}
      </Card>
      {transferFor !== undefined && <TransferDrawer projects={projects} initialProjectId={transferFor ?? undefined} onClose={() => setTransferFor(undefined)} />}
      {editing !== undefined && <ProjectDrawer project={editing} onClose={() => setEditing(undefined)} />}
      {voiding && <VoidDialog what={t('transfer', 'স্থানান্তর')} busy={voidIt.isPending} onClose={() => setVoiding(null)} onConfirm={reason => voidIt.mutate({ reason }, { onSuccess: () => setVoiding(null) })} />}
    </>
  );
}
