import { useState, type FormEvent } from 'react';
import { BarChart3, Egg, Leaf, ShieldCheck, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePrefs } from '../lib/i18n';
import { Alert, Field, Input } from '../components/ui';

export default function Login() {
  const { t, lang, set } = usePrefs();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api.post('/auth/login', { email, password }); refresh(); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="brand" style={{ padding: 0 }}><span className="brand-mark" style={{ background: '#d9f99d', color: '#0f5132' }}><Leaf size={19} /></span><b style={{ fontSize: '1.15em' }}>FarmLedger ERP</b></div>
        <div>
          <h1>{t('Run the whole farm business from one ledger.', 'পুরো খামার ব্যবসা এক খাতায় পরিচালনা করুন।')}</h1>
          <p>{t('Sales, purchases, cash, inventory, daily production and full double-entry accounting — with real profit & loss, balance sheet and cash flow.', 'বিক্রয়, ক্রয়, নগদ, মজুদ, দৈনিক উৎপাদন ও সম্পূর্ণ দ্বৈত-দাখিলা হিসাব — প্রকৃত লাভ-ক্ষতি, ব্যালান্স শিট ও নগদ প্রবাহসহ।')}</p>
          <ul>
            <li><Egg size={18} />{t('Daily production, laying rate & feed cost per egg', 'দৈনিক উৎপাদন, ডিম পাড়ার হার ও প্রতি ডিমে খাদ্য খরচ')}</li>
            <li><Wallet size={18} />{t('Receivables, payables and cash reconciliation', 'পাওনা, দেনা ও নগদ মিলকরণ')}</li>
            <li><BarChart3 size={18} />{t('Financial statements straight from the ledger', 'খাতা থেকে সরাসরি আর্থিক বিবরণী')}</li>
            <li><ShieldCheck size={18} />{t('Role-based access and a full audit trail', 'ভূমিকাভিত্তিক প্রবেশাধিকার ও সম্পূর্ণ অডিট ট্রেইল')}</li>
          </ul>
        </div>
        <small style={{ color: '#9cc7aa' }}>© {new Date().getFullYear()} FarmLedger</small>
      </section>
      <section className="auth-form">
        <form onSubmit={submit}>
          <div className="row between"><h1>{t('Sign in', 'সাইন ইন')}</h1><button type="button" className="btn ghost sm" onClick={() => set({ lang: lang === 'en' ? 'bn' : 'en' })}>{lang === 'en' ? 'বাংলা' : 'English'}</button></div>
          <p className="muted" style={{ margin: 0 }}>{t('Use the account your farm administrator created for you.', 'খামারের প্রশাসক আপনার জন্য যে অ্যাকাউন্ট তৈরি করেছেন তা ব্যবহার করুন।')}</p>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label={t('Email', 'ইমেইল')}><Input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} autoFocus /></Field>
          <Field label={t('Password', 'পাসওয়ার্ড')}><Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
          <button className="btn primary" style={{ height: 42 }} disabled={busy}>{busy ? t('Signing in…', 'সাইন ইন হচ্ছে…') : t('Sign in', 'সাইন ইন')}</button>
        </form>
      </section>
    </div>
  );
}

export function ChangePassword({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { t } = usePrefs();
  const { refresh, logout } = useAuth();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [msg, setMsg] = useState<{ tone?: 'error'; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) return setMsg({ tone: 'error', text: t('New passwords do not match.', 'নতুন পাসওয়ার্ড মেলেনি।') });
    try { await api.post('/auth/change-password', { current: f.current, next: f.next }); setMsg({ text: t('Password changed.', 'পাসওয়ার্ড পরিবর্তন হয়েছে।') }); setF({ current: '', next: '', confirm: '' }); refresh(); onDone?.(); } catch (err: any) { setMsg({ tone: 'error', text: err.message }); }
  };
  const form = (
    <form onSubmit={submit} className="stack" style={{ width: 'min(380px, 100%)' }}>
      {forced && <><h1>{t('Set a new password', 'নতুন পাসওয়ার্ড দিন')}</h1><p className="muted" style={{ margin: 0 }}>{t('For security, replace the temporary password before continuing.', 'নিরাপত্তার জন্য এগিয়ে যাওয়ার আগে অস্থায়ী পাসওয়ার্ড বদলান।')}</p></>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Field label={t('Current password', 'বর্তমান পাসওয়ার্ড')}><Input type="password" autoComplete="current-password" required value={f.current} onChange={e => setF({ ...f, current: e.target.value })} /></Field>
      <Field label={t('New password', 'নতুন পাসওয়ার্ড')} hint={t('At least 10 characters with letters and numbers.', 'কমপক্ষে ১০ অক্ষর, অক্ষর ও সংখ্যা সহ।')}><Input type="password" autoComplete="new-password" required value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></Field>
      <Field label={t('Confirm new password', 'নতুন পাসওয়ার্ড নিশ্চিত করুন')}><Input type="password" autoComplete="new-password" required value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} /></Field>
      <div className="row"><button className="btn primary">{t('Change password', 'পাসওয়ার্ড পরিবর্তন')}</button>{forced && <button type="button" className="btn ghost" onClick={() => logout()}>{t('Sign out', 'সাইন আউট')}</button>}</div>
    </form>
  );
  return forced ? <div className="auth-form" style={{ minHeight: '100%' }}>{form}</div> : form;
}
