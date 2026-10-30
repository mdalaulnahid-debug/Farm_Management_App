import { Fragment, useEffect, useMemo, useState } from 'react';
import { Building2, CalendarCheck, Download, History, KeyRound, Lock, LockOpen, Pencil, Unlock, UserPlus } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useApi, useSave } from '../lib/hooks';
import { downloadCsv, fmtDate, fmtDateTime, monthStart, ymd } from '../lib/format';
import ImportData from './ImportData';
import { Alert, Badge, Card, DataTable, Dialog, Drawer, Empty, Field, Input, Loading, PageHeader, SearchBox, Select, Tabs, type Column } from '../components/ui';

type T = (en: string, bn: string) => string;
type TabKey = 'users' | 'roles' | 'org' | 'close' | 'import' | 'audit';

interface Role { id: string; key: string; name: string; description: string | null; permissions: string[]; system: boolean; _count: { users: number } }
interface User { id: string; name: string; email: string; phone: string | null; active: boolean; mustChangePassword: boolean; lastLoginAt: string | null; role: { id: string; key: string; name: string } }
interface Org { name: string; legalName: string | null; address: string | null; phone: string | null; email: string | null; taxId: string | null; fiscalYearStart: number; invoiceFooter: string | null; lockDate: string | null }
interface AuditRow { id: string; createdAt: string; action: string; entity: string; entityId: string | null; summary: string; ip: string | null; user: { name: string; email: string } | null }

const passwordProblem = (t: T, pw: string) =>
  pw.length < 10 ? t('At least 10 characters.', 'কমপক্ষে ১০ অক্ষর।') : !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? t('Use both letters and numbers.', 'অক্ষর ও সংখ্যা দুটোই দিন।') : null;

const MONTHS: [string, string][] = [['January', 'জানুয়ারি'], ['February', 'ফেব্রুয়ারি'], ['March', 'মার্চ'], ['April', 'এপ্রিল'], ['May', 'মে'], ['June', 'জুন'], ['July', 'জুলাই'], ['August', 'আগস্ট'], ['September', 'সেপ্টেম্বর'], ['October', 'অক্টোবর'], ['November', 'নভেম্বর'], ['December', 'ডিসেম্বর']];

export default function Admin() {
  const { t } = usePrefs();
  const { can } = useAuth();
  const tabs = ([
    can('users.manage') && { value: 'users', label: t('Users', 'ব্যবহারকারী') },
    can('users.manage') && { value: 'roles', label: t('Roles & permissions', 'ভূমিকা ও অনুমতি') },
    can('settings.manage') && { value: 'org', label: t('Organization', 'প্রতিষ্ঠান') },
    can('settings.manage') && { value: 'close', label: t('Period close', 'হিসাবকাল বন্ধ') },
    can('settings.manage') && { value: 'import', label: t('Import past data', 'পুরোনো হিসাব ইমপোর্ট') },
    can('audit.view') && { value: 'audit', label: t('Audit trail', 'অডিট ট্রেইল') },
  ].filter(Boolean)) as { value: TabKey; label: string }[];
  const [tab, setTab] = useState<TabKey>(tabs[0]?.value ?? 'audit');

  return (
    <>
      <PageHeader crumb={t('Administration', 'প্রশাসন')} title={t('Settings & security', 'সেটিংস ও নিরাপত্তা')}
        subtitle={t('Who can sign in, what they can do, your company details, period close and the audit trail.', 'কে সাইন ইন করতে পারবে, কী করতে পারবে, প্রতিষ্ঠানের তথ্য, হিসাবকাল বন্ধ ও অডিট ট্রেইল।')} />
      {!tabs.length ? <Empty>{t('Your role has no administration permissions.', 'আপনার ভূমিকায় প্রশাসনিক কোনো অনুমতি নেই।')}</Empty> : <>
        <Tabs value={tab} onChange={setTab} options={tabs} />
        {tab === 'users' && <UsersTab />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'org' && <OrgTab />}
        {tab === 'close' && <PeriodCloseTab />}
        {tab === 'import' && <ImportData />}
        {tab === 'audit' && <AuditTab />}
      </>}
    </>
  );
}

// ───────────── Users ─────────────
function UsersTab() {
  const { t, lang } = usePrefs();
  const users = useApi<{ data: User[] }>('/users');
  const roles = useApi<{ data: Role[] }>('/roles');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return users.data?.data.filter(u => !s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s));
  }, [users.data, search]);

  const columns: Column<User>[] = [
    { key: 'name', label: t('Name', 'নাম'), render: u => <div><b>{u.name}</b><div className="muted small">{u.email}</div></div> },
    { key: 'role', label: t('Role', 'ভূমিকা'), render: u => <Badge tone={u.role.key === 'owner' ? 'blue' : undefined}>{u.role.name}</Badge> },
    { key: 'phone', label: t('Phone', 'ফোন'), hideSm: true, render: u => u.phone || <span className="muted">—</span> },
    { key: 'status', label: t('Status', 'অবস্থা'), render: u => <div className="row" style={{ gap: 6 }}>
      {u.active ? <Badge tone="green">{t('Active', 'সক্রিয়')}</Badge> : <Badge tone="red">{t('Disabled', 'নিষ্ক্রিয়')}</Badge>}
      {u.mustChangePassword && u.active && <Badge tone="amber"><KeyRound size={11} />{t('Must set password', 'পাসওয়ার্ড বদলাতে হবে')}</Badge>}
    </div> },
    { key: 'last', label: t('Last sign-in', 'শেষ সাইন ইন'), hideSm: true, render: u => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt, lang) : <span className="muted">{t('Never', 'কখনো না')}</span>) },
    { key: 'edit', label: '', render: () => <Pencil size={15} className="muted" /> },
  ];

  return (
    <Card title={t('Users', 'ব্যবহারকারী')} subtitle={t('Each person signs in with their own account. Access comes from the role you assign.', 'প্রত্যেকে নিজের অ্যাকাউন্টে সাইন ইন করেন। প্রবেশাধিকার নির্ধারিত ভূমিকা থেকে আসে।')}
      actions={<>
        <SearchBox value={search} onChange={setSearch} placeholder={t('Name or email…', 'নাম বা ইমেইল…')} />
        <button className="btn primary" onClick={() => setEditing('new')} disabled={!roles.data}><UserPlus size={16} />{t('New user', 'নতুন ব্যবহারকারী')}</button>
      </>}>
      <DataTable rows={rows} columns={columns} onRow={u => setEditing(u)} empty={t('No users found.', 'কোনো ব্যবহারকারী পাওয়া যায়নি।')} />
      {editing && roles.data && <UserDrawer user={editing === 'new' ? null : editing} roles={roles.data.data} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function UserDrawer({ user, roles, onClose }: { user: User | null; roles: Role[]; onClose: () => void }) {
  const { t } = usePrefs();
  const { me } = useAuth();
  const isNew = !user;
  const self = user?.id === me?.user.id;
  const defaultRole = roles.find(r => r.key === 'operator') ?? roles[roles.length - 1];
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', roleId: user?.role.id ?? defaultRole?.id ?? '', active: user?.active ?? true, password: '' });
  const [resetPw, setResetPw] = useState(isNew);
  const save = useSave<any>(isNew ? 'post' : 'put', isNew ? '/users' : `/users/${user!.id}`, isNew ? t('User created. They will be asked to set a new password at first sign-in.', 'ব্যবহারকারী তৈরি হয়েছে। প্রথম সাইন ইনে নতুন পাসওয়ার্ড দিতে বলা হবে।') : t('User updated.', 'ব্যবহারকারী হালনাগাদ হয়েছে।'));

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const pwProblem = resetPw ? passwordProblem(t, f.password) : null;
  const valid = f.name.trim().length >= 2 && emailOk && !!f.roleId && !pwProblem;
  const role = roles.find(r => r.id === f.roleId);

  const submit = () => save.mutate({ name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || null, roleId: f.roleId, active: f.active, ...(resetPw ? { password: f.password } : {}) }, { onSuccess: onClose });

  return (
    <Drawer narrow title={isNew ? t('New user', 'নতুন ব্যবহারকারী') : user!.name} subtitle={isNew ? t('Give them a temporary password; they must change it at first sign-in.', 'একটি অস্থায়ী পাসওয়ার্ড দিন; প্রথম সাইন ইনে তাঁকে তা বদলাতে হবে।') : user!.email} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={!valid || save.isPending} onClick={submit}>{isNew ? t('Create user', 'ব্যবহারকারী তৈরি') : t('Save changes', 'পরিবর্তন সংরক্ষণ')}</button></>}>
      {self && <Alert>{t('This is your own account. You cannot change your own role or disable yourself.', 'এটি আপনার নিজের অ্যাকাউন্ট। নিজের ভূমিকা বদলানো বা নিজেকে নিষ্ক্রিয় করা যায় না।')}</Alert>}
      <Field label={t('Full name', 'পূর্ণ নাম')}><Input value={f.name} maxLength={80} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <div className="form-grid">
        <Field label={t('Email (sign-in)', 'ইমেইল (সাইন ইন)')} error={f.email && !emailOk ? t('Enter a valid email.', 'সঠিক ইমেইল দিন।') : undefined}><Input type="email" autoComplete="off" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t('Phone', 'ফোন')}><Input value={f.phone} maxLength={30} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      <Field label={t('Role', 'ভূমিকা')} hint={role?.description ?? undefined}>
        <Select value={f.roleId} disabled={self} onChange={e => setF({ ...f, roleId: e.target.value })} options={roles.map(r => ({ value: r.id, label: r.name }))} />
      </Field>
      <label className="check"><input type="checkbox" checked={f.active} disabled={self} onChange={e => setF({ ...f, active: e.target.checked })} />{t('Active — can sign in', 'সক্রিয় — সাইন ইন করতে পারবেন')}</label>
      {!f.active && !isNew && <small className="muted">{t('Disabling signs them out everywhere immediately.', 'নিষ্ক্রিয় করলে সব জায়গা থেকে সঙ্গে সঙ্গে সাইন আউট হবে।')}</small>}
      <div className="card card-pad stack" style={{ background: 'var(--surface-2)' }}>
        <h3>{isNew ? t('Temporary password', 'অস্থায়ী পাসওয়ার্ড') : t('Password', 'পাসওয়ার্ড')}</h3>
        {!isNew && <label className="check"><input type="checkbox" checked={resetPw} onChange={e => { setResetPw(e.target.checked); setF({ ...f, password: '' }); }} />{t('Reset password', 'পাসওয়ার্ড রিসেট')}</label>}
        {resetPw && (
          <Field label={t('New password', 'নতুন পাসওয়ার্ড')} error={f.password && pwProblem ? pwProblem : undefined} hint={t('At least 10 characters with letters and numbers. Share it privately.', 'কমপক্ষে ১০ অক্ষর, অক্ষর ও সংখ্যা সহ। গোপনে জানিয়ে দিন।')}>
            <Input type="text" autoComplete="new-password" className="mono" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
          </Field>
        )}
        {resetPw && !isNew && <small className="muted">{t('Resetting signs the user out and asks them to choose a new password at next sign-in.', 'রিসেট করলে ব্যবহারকারী সাইন আউট হবেন এবং পরের সাইন ইনে নতুন পাসওয়ার্ড দিতে হবে।')}</small>}
      </div>
    </Drawer>
  );
}

// ───────────── Roles & permissions ─────────────
const groupLabel = (t: T, g: string) => ({
  dashboard: t('Dashboard', 'ড্যাশবোর্ড'), sales: t('Sales', 'বিক্রয়'), purchases: t('Purchases', 'ক্রয়'), banking: t('Cash & bank', 'নগদ ও ব্যাংক'),
  inventory: t('Inventory', 'মজুদ'), production: t('Production', 'উৎপাদন'), accounting: t('Accounting', 'হিসাবরক্ষণ'), reports: t('Reports', 'রিপোর্ট'),
  parties: t('Contacts', 'যোগাযোগ'), settings: t('Settings', 'সেটিংস'), users: t('Users & roles', 'ব্যবহারকারী ও ভূমিকা'), audit: t('Audit', 'অডিট'),
} as Record<string, string>)[g] ?? g;

const PERM_BN: Record<string, string> = {
  'dashboard.view': 'ড্যাশবোর্ড দেখা', 'sales.view': 'বিক্রয় ও ক্রেতা দেখা', 'sales.create': 'চালান ও আদায় তৈরি', 'sales.void': 'চালান ও আদায় বাতিল',
  'purchases.view': 'ক্রয়, খরচ ও সরবরাহকারী দেখা', 'purchases.create': 'বিল, খরচ ও পরিশোধ তৈরি', 'purchases.void': 'বিল ও পরিশোধ বাতিল',
  'banking.view': 'নগদ ও ব্যাংক দেখা', 'banking.manage': 'স্থানান্তর, নগদ গণনা, মালিকের লেনদেন', 'inventory.view': 'মজুদ দেখা', 'inventory.manage': 'পণ্য ও মজুদ সমন্বয় পরিচালনা',
  'production.view': 'ঝাঁক ও উৎপাদন দেখা', 'production.manage': 'উৎপাদন লেখা ও ঝাঁক পরিচালনা', 'accounting.view': 'হিসাবের তালিকা ও জার্নাল দেখা',
  'accounting.manage': 'ম্যানুয়াল জার্নাল, হিসাব, প্রারম্ভিক স্থিতি', 'reports.view': 'আর্থিক রিপোর্ট দেখা', 'parties.manage': 'ক্রেতা/সরবরাহকারী তৈরি ও সম্পাদনা',
  'settings.manage': 'প্রতিষ্ঠানের সেটিংস ও হিসাবকাল বন্ধ', 'users.manage': 'ব্যবহারকারী ও ভূমিকা পরিচালনা', 'audit.view': 'অডিট ট্রেইল দেখা',
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

function RolesTab() {
  const { t, lang } = usePrefs();
  const q = useApi<{ data: Role[]; permissions: Record<string, string> }>('/roles');
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const save = useSave<{ id: string; name: string; description: string | null; permissions: string[] }>('put', b => `/roles/${b.id}`, t('Role permissions saved.', 'ভূমিকার অনুমতি সংরক্ষিত হয়েছে।'));

  useEffect(() => { if (q.data) setDrafts(Object.fromEntries(q.data.data.map(r => [r.id, r.permissions]))); }, [q.data]);

  if (!q.data) return <Card><Loading /></Card>;
  const roles = q.data.data;
  const permKeys = Object.keys(q.data.permissions);
  const groups = [...new Set(permKeys.map(k => k.split('.')[0]))];
  const isOwner = (r: Role) => r.key === 'owner';
  const current = (r: Role) => (isOwner(r) ? permKeys : drafts[r.id] ?? r.permissions);
  const dirty = (r: Role) => !isOwner(r) && !sameSet(current(r), r.permissions);
  const toggle = (r: Role, p: string) => setDrafts(d => { const cur = d[r.id] ?? r.permissions; return { ...d, [r.id]: cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p] }; });
  const toggleGroup = (r: Role, g: string, on: boolean) => setDrafts(d => {
    const keys = permKeys.filter(k => k.startsWith(`${g}.`));
    const cur = (d[r.id] ?? r.permissions).filter(x => !keys.includes(x));
    return { ...d, [r.id]: on ? [...cur, ...keys] : cur };
  });

  return (
    <Card title={t('Roles & permissions', 'ভূমিকা ও অনুমতি')} subtitle={t('Tick what each role may do, then save that role. Changes apply at the user’s next request.', 'প্রতিটি ভূমিকা কী করতে পারবে টিক দিন, তারপর সেই ভূমিকা সংরক্ষণ করুন। পরিবর্তন ব্যবহারকারীর পরবর্তী কাজেই কার্যকর হবে।')}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: 240 }}>{t('Permission', 'অনুমতি')}</th>
              {roles.map(r => (
                <th key={r.id} style={{ textAlign: 'center', minWidth: 130, whiteSpace: 'normal', verticalAlign: 'top' }}>
                  <div style={{ color: 'var(--text)' }}>{r.name}</div>
                  <div style={{ textTransform: 'none', fontWeight: 500, marginTop: 2 }}>{isOwner(r) ? <span className="row" style={{ gap: 4, justifyContent: 'center' }}><Lock size={11} />{t('Full access', 'পূর্ণ প্রবেশাধিকার')}</span> : t(`${r._count.users} users`, `${r._count.users} জন ব্যবহারকারী`)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const keys = permKeys.filter(k => k.startsWith(`${g}.`));
              return (
                <Fragment key={g}>
                  <tr className="subtotal">
                    <td>{groupLabel(t, g)}</td>
                    {roles.map(r => {
                      const all = keys.every(k => current(r).includes(k));
                      return <td key={r.id} style={{ textAlign: 'center' }}>
                        <button className="btn ghost sm" disabled={isOwner(r)} onClick={() => toggleGroup(r, g, !all)} title={all ? t('Clear this group', 'এই গ্রুপ খালি করুন') : t('Allow this whole group', 'পুরো গ্রুপ অনুমতি দিন')}>{all ? t('None', 'কোনোটি না') : t('All', 'সব')}</button>
                      </td>;
                    })}
                  </tr>
                  {keys.map(k => (
                    <tr key={k} className="indent">
                      <td><div>{lang === 'bn' ? PERM_BN[k] ?? q.data!.permissions[k] : q.data!.permissions[k]}</div><div className="muted small mono">{k}</div></td>
                      {roles.map(r => (
                        <td key={r.id} style={{ textAlign: 'center' }}>
                          <input type="checkbox" style={{ width: 16, height: 16, accentColor: 'var(--brand)' }} aria-label={`${r.name}: ${k}`} checked={current(r).includes(k)} disabled={isOwner(r)} onChange={() => toggle(r, k)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="muted small" style={{ fontWeight: 500 }}>{t('The owner role always has full access and cannot be edited.', 'মালিকের ভূমিকায় সবসময় পূর্ণ প্রবেশাধিকার থাকে, সম্পাদনা করা যায় না।')}</td>
              {roles.map(r => (
                <td key={r.id} style={{ textAlign: 'center', padding: '10px 6px' }}>
                  {isOwner(r) ? <span className="muted">—</span> : (
                    <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
                      <button className="btn primary sm" disabled={!dirty(r) || save.isPending} onClick={() => save.mutate({ id: r.id, name: r.name, description: r.description, permissions: current(r) })}>{t('Save', 'সংরক্ষণ')}</button>
                      {dirty(r) && <button className="btn ghost sm" onClick={() => setDrafts(d => ({ ...d, [r.id]: r.permissions }))}>{t('Undo', 'ফিরিয়ে নিন')}</button>}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ───────────── Organization ─────────────
function OrgTab() {
  const q = useApi<Org>('/settings');
  if (!q.data) return <Card><Loading /></Card>;
  return <><OrgForm org={q.data} /><BackupCard /></>;
}

function BackupCard() {
  const { t } = usePrefs();
  return (
    <Card title={t('Backup', 'ব্যাকআপ')} subtitle={t('Download a complete copy of the database. Keep backups off this computer (USB drive or cloud storage).', 'সম্পূর্ণ ডাটাবেসের একটি কপি ডাউনলোড করুন। ব্যাকআপ এই কম্পিউটারের বাইরে (ইউএসবি বা ক্লাউডে) রাখুন।')}
      actions={<a className="btn" href="/api/v1/admin/backup" download>{t('Download backup', 'ব্যাকআপ ডাউনলোড')}</a>}>
      <div className="card-body muted small">{t('To restore, stop FarmLedger and replace apps/api/prisma/farmledger.db with the backup file.', 'পুনরুদ্ধার করতে FarmLedger বন্ধ করে apps/api/prisma/farmledger.db ফাইলটি ব্যাকআপ ফাইল দিয়ে বদলে দিন।')}</div>
    </Card>
  );
}

function OrgForm({ org }: { org: Org }) {
  const { t } = usePrefs();
  const { refresh } = useAuth();
  const init = { name: org.name ?? '', legalName: org.legalName ?? '', address: org.address ?? '', phone: org.phone ?? '', email: org.email ?? '', taxId: org.taxId ?? '', fiscalYearStart: org.fiscalYearStart ?? 7, invoiceFooter: org.invoiceFooter ?? '' };
  const [f, setF] = useState(init);
  const save = useSave<typeof f>('put', '/settings', t('Organization settings saved.', 'প্রতিষ্ঠানের সেটিংস সংরক্ষিত হয়েছে।'));
  const changed = JSON.stringify(f) !== JSON.stringify(init);
  const emailOk = !f.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const valid = f.name.trim().length >= 2 && emailOk;
  const submit = () => save.mutate({ ...f, fiscalYearStart: Number(f.fiscalYearStart) }, { onSuccess: () => refresh() });

  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Building2 size={18} />{t('Organization profile', 'প্রতিষ্ঠানের প্রোফাইল')}</span>} subtitle={t('Printed on invoices and financial statements.', 'চালান ও আর্থিক বিবরণীতে ছাপা হয়।')}
      actions={<>
        {changed && <button className="btn" onClick={() => setF(init)}>{t('Discard', 'বাদ দিন')}</button>}
        <button className="btn primary" disabled={!changed || !valid || save.isPending} onClick={submit}>{t('Save changes', 'পরিবর্তন সংরক্ষণ')}</button>
      </>}>
      <div className="card-body">
        <div className="form-grid">
          <Field label={t('Trading name', 'ব্যবসায়িক নাম')} error={f.name.trim().length < 2 ? t('Required.', 'আবশ্যক।') : undefined} hint={t('Shown in the sidebar and on documents.', 'সাইডবার ও ডকুমেন্টে দেখাবে।')}><Input value={f.name} maxLength={120} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Legal name', 'আইনগত নাম')} hint={t('If different from the trading name.', 'ব্যবসায়িক নাম থেকে ভিন্ন হলে।')}><Input value={f.legalName} maxLength={160} onChange={e => setF({ ...f, legalName: e.target.value })} /></Field>
          <Field label={t('Address', 'ঠিকানা')} className="full"><textarea className="textarea" maxLength={300} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
          <Field label={t('Phone', 'ফোন')}><Input value={f.phone} maxLength={40} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label={t('Email', 'ইমেইল')} error={!emailOk ? t('Enter a valid email.', 'সঠিক ইমেইল দিন।') : undefined}><Input type="email" value={f.email} maxLength={120} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={t('Tax ID / TIN / BIN', 'কর শনাক্তকরণ নম্বর / TIN / BIN')}><Input value={f.taxId} maxLength={60} onChange={e => setF({ ...f, taxId: e.target.value })} /></Field>
          <Field label={t('Fiscal year starts in', 'অর্থবছর শুরু')} hint={t('Bangladesh’s fiscal year starts in July.', 'বাংলাদেশের অর্থবছর জুলাইয়ে শুরু হয়।')}>
            <Select value={String(f.fiscalYearStart)} onChange={e => setF({ ...f, fiscalYearStart: Number(e.target.value) })} options={MONTHS.map(([en, bn], i) => ({ value: String(i + 1), label: t(en, bn) }))} />
          </Field>
          <Field label={t('Invoice footer', 'চালানের পাদটীকা')} className="full" hint={t('e.g. payment instructions or a thank-you note. Printed at the bottom of every invoice.', 'যেমন: পরিশোধের নির্দেশনা বা ধন্যবাদ বার্তা। প্রতিটি চালানের নিচে ছাপা হবে।')}>
            <textarea className="textarea" maxLength={500} value={f.invoiceFooter} onChange={e => setF({ ...f, invoiceFooter: e.target.value })} />
          </Field>
        </div>
      </div>
    </Card>
  );
}

// ───────────── Period close ─────────────
function PeriodCloseTab() {
  const { t, lang } = usePrefs();
  const { refresh } = useAuth();
  const q = useApi<Org>('/settings');
  const lastMonthEnd = ymd(new Date(new Date(`${monthStart()}T00:00:00`).getTime() - 86400000));
  const [date, setDate] = useState(lastMonthEnd);
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null);
  const save = useSave<{ lockDate: string | null }>('put', '/settings/lock-date', t('Period close updated.', 'হিসাবকাল বন্ধের তারিখ হালনাগাদ হয়েছে।'));
  if (!q.data) return <Card><Loading /></Card>;
  const current = q.data.lockDate ? q.data.lockDate.slice(0, 10) : null;
  const run = () => save.mutate({ lockDate: confirm === 'close' ? date : null }, { onSuccess: () => { setConfirm(null); refresh(); } });

  return (
    <div className="grid g2">
      <Card title={<span className="row" style={{ gap: 8 }}><CalendarCheck size={18} />{t('Close the books', 'বই বন্ধ করুন')}</span>} pad>
        <div className="stack">
          <p style={{ margin: 0 }}>{t('Once a period is closed, no transaction can be posted, edited or voided on or before the lock date — protecting figures you have already reported, filed or shared with the bank.',
            'কোনো হিসাবকাল বন্ধ করলে লক তারিখ বা তার আগের কোনো লেনদেন পোস্ট, সম্পাদনা বা বাতিল করা যায় না — ফলে আগে জমা দেওয়া বা ব্যাংককে দেওয়া হিসাব অপরিবর্তিত থাকে।')}</p>
          <p className="muted small" style={{ margin: 0 }}>{t('Typical practice: after reconciling cash and stock at month-end, close up to the last day of that month.', 'প্রচলিত নিয়ম: মাস শেষে নগদ ও মজুদ মিলিয়ে সেই মাসের শেষ দিন পর্যন্ত বন্ধ করুন।')}</p>
          <Field label={t('Lock transactions on or before', 'এই তারিখ ও তার আগের লেনদেন লক')}>
            <Input type="date" value={date} max={ymd()} onChange={e => setDate(e.target.value)} style={{ maxWidth: 220 }} />
          </Field>
          {current && date < current && <Alert tone="warn">{t(`This is earlier than the current lock date (${fmtDate(current, lang)}) and will reopen the days in between.`, `এটি বর্তমান লক তারিখের (${fmtDate(current, lang)}) আগে, তাই মাঝের দিনগুলো আবার খুলে যাবে।`)}</Alert>}
          <div className="row">
            <button className="btn primary" disabled={!date || date === current || save.isPending} onClick={() => setConfirm('close')}><Lock size={16} />{t('Close books', 'বই বন্ধ করুন')}</button>
          </div>
        </div>
      </Card>
      <Card title={t('Current status', 'বর্তমান অবস্থা')} pad>
        <div className="stack">
          {current ? <>
            <div className="row"><Badge tone="amber"><Lock size={12} />{t('Closed', 'বন্ধ')}</Badge><b>{t(`Books closed up to ${fmtDate(current, lang)}`, `${fmtDate(current, lang)} পর্যন্ত বই বন্ধ`)}</b></div>
            <p className="muted" style={{ margin: 0 }}>{t('Entries dated after this day can still be recorded and corrected.', 'এই দিনের পরের তারিখের এন্ট্রি এখনো লেখা ও সংশোধন করা যাবে।')}</p>
            <div className="row"><button className="btn" disabled={save.isPending} onClick={() => setConfirm('reopen')}><LockOpen size={16} />{t('Reopen all periods', 'সব হিসাবকাল খুলুন')}</button></div>
          </> : <>
            <div className="row"><Badge tone="green"><Unlock size={12} />{t('Open', 'খোলা')}</Badge><b>{t('No periods are closed', 'কোনো হিসাবকাল বন্ধ নেই')}</b></div>
            <p className="muted" style={{ margin: 0 }}>{t('Transactions can be posted or changed on any date.', 'যেকোনো তারিখে লেনদেন পোস্ট বা পরিবর্তন করা যায়।')}</p>
          </>}
          <small className="muted">{t('Every close and reopen is recorded in the audit trail.', 'প্রতিটি বন্ধ ও খোলা অডিট ট্রেইলে লেখা থাকে।')}</small>
        </div>
      </Card>
      {confirm && (
        <Dialog title={confirm === 'close' ? t('Close the books?', 'বই বন্ধ করবেন?') : t('Reopen all periods?', 'সব হিসাবকাল খুলবেন?')} onClose={() => setConfirm(null)}
          footer={<><button className="btn" onClick={() => setConfirm(null)}>{t('Cancel', 'বাতিল')}</button>
            <button className={`btn ${confirm === 'close' ? 'primary' : 'danger'}`} disabled={save.isPending} onClick={run}>{confirm === 'close' ? t('Close books', 'বই বন্ধ করুন') : t('Reopen', 'খুলুন')}</button></>}>
          {confirm === 'close'
            ? <p style={{ margin: 0 }}>{t(`Nobody will be able to post, edit or void any transaction dated on or before ${fmtDate(date, lang)}.`, `${fmtDate(date, lang)} বা তার আগের তারিখের কোনো লেনদেন কেউ পোস্ট, সম্পাদনা বা বাতিল করতে পারবে না।`)}</p>
            : <Alert tone="warn">{t('All past periods become editable again. Figures you have already reported could change. Only do this to fix a genuine error, then close again.', 'সব পুরোনো হিসাবকাল আবার সম্পাদনাযোগ্য হবে। আগে জমা দেওয়া হিসাব বদলে যেতে পারে। শুধু প্রকৃত ভুল সংশোধনের জন্য করুন, তারপর আবার বন্ধ করুন।')}</Alert>}
        </Dialog>
      )}
    </div>
  );
}

// ───────────── Audit trail ─────────────
const ENTITIES = ['invoice', 'bill', 'payment', 'journal', 'production', 'stock_adjustment', 'user', 'role', 'settings', 'party', 'item', 'account', 'flock', 'transfer', 'cash_count'];
const entityLabel = (t: T, e: string) => ({
  invoice: t('Invoice', 'চালান'), bill: t('Bill', 'বিল'), payment: t('Payment', 'পরিশোধ'), journal: t('Journal', 'জার্নাল'), production: t('Production', 'উৎপাদন'),
  stock_adjustment: t('Stock adjustment', 'মজুদ সমন্বয়'), user: t('User', 'ব্যবহারকারী'), role: t('Role', 'ভূমিকা'), settings: t('Settings', 'সেটিংস'), party: t('Contact', 'যোগাযোগ'),
  item: t('Item', 'পণ্য'), account: t('Account', 'হিসাব'), flock: t('Flock', 'ঝাঁক'), transfer: t('Transfer', 'স্থানান্তর'), cash_count: t('Cash count', 'নগদ গণনা'),
} as Record<string, string>)[e] ?? e;
const actionLabel = (t: T, a: string) => ({ create: t('Created', 'তৈরি'), update: t('Updated', 'হালনাগাদ'), void: t('Voided', 'বাতিল'), login: t('Signed in', 'সাইন ইন'), login_failed: t('Failed sign-in', 'ব্যর্থ সাইন ইন') } as Record<string, string>)[a] ?? a;
const actionTone = (a: string) => (({ create: 'green', update: 'blue', void: 'red', login_failed: 'amber' } as const) as Record<string, 'green' | 'blue' | 'red' | 'amber'>)[a];

function AuditTab() {
  const { t, lang } = usePrefs();
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const q = useApi<{ data: AuditRow[]; total: number }>('/audit', { search, entity, page });

  const columns: Column<AuditRow>[] = [
    { key: 'when', label: t('When', 'কখন'), render: r => <span className="nowrap">{fmtDateTime(r.createdAt, lang)}</span> },
    { key: 'user', label: t('User', 'ব্যবহারকারী'), render: r => (r.user ? <div><div>{r.user.name}</div><div className="muted small hide-sm">{r.user.email}</div></div> : <span className="muted">{t('System', 'সিস্টেম')}</span>) },
    { key: 'action', label: t('Action', 'কাজ'), render: r => <Badge tone={actionTone(r.action)}>{actionLabel(t, r.action)}</Badge> },
    { key: 'entity', label: t('Record', 'রেকর্ড'), hideSm: true, render: r => entityLabel(t, r.entity) },
    { key: 'summary', label: t('Details', 'বিবরণ'), render: r => r.summary },
    { key: 'ip', label: t('IP address', 'আইপি ঠিকানা'), hideSm: true, render: r => <span className="mono muted">{r.ip ?? '—'}</span> },
  ];

  const exportCsv = () => downloadCsv(`audit_trail_page${page}.csv`, ['Time', 'User', 'Email', 'Action', 'Entity', 'Entity ID', 'Summary', 'IP'],
    (q.data?.data ?? []).map(r => [r.createdAt, r.user?.name ?? 'System', r.user?.email ?? '', r.action, r.entity, r.entityId ?? '', r.summary, r.ip ?? '']));

  return (
    <Card title={<span className="row" style={{ gap: 8 }}><History size={18} />{t('Audit trail', 'অডিট ট্রেইল')}</span>} subtitle={t('A permanent, read-only record of who did what and when.', 'কে কখন কী করেছেন তার স্থায়ী, অপরিবর্তনীয় রেকর্ড।')}
      actions={<>
        <Select style={{ width: 'auto' }} value={entity} onChange={e => { setEntity(e.target.value); setPage(1); }} placeholder={t('All records', 'সব রেকর্ড')} options={ENTITIES.map(e => ({ value: e, label: entityLabel(t, e) }))} aria-label={t('Record type', 'রেকর্ডের ধরন')} />
        <SearchBox value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder={t('Search details…', 'বিবরণে খুঁজুন…')} />
        <button className="btn" onClick={exportCsv} disabled={!q.data?.data.length}><Download size={16} />{t('Export page', 'পৃষ্ঠা ডাউনলোড')}</button>
      </>}>
      <DataTable rows={q.data?.data} columns={columns} page={page} pageSize={100} total={q.data?.total} onPage={setPage} empty={t('No activity matches these filters.', 'এই ফিল্টারে কোনো কার্যক্রম নেই।')} />
    </Card>
  );
}

