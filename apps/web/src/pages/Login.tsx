import { useEffect, useState, type FormEvent } from 'react';
import { LogoMark } from '../brand/Logo';
import dawn from '../assets/signin-dawn.webp';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { nameOf, usePrefs } from '../lib/i18n';
import { Alert, Field, Input } from '../components/ui';
import { PasskeySignIn } from './Passkeys';

export default function Login() {
  const { t, lang, set } = usePrefs();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // After a right password, accounts with 2-step sign-in get a ticket and are asked for the code.
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [brand, setBrand] = useState<{ name: string; nameBn: string | null } | null>(null);
  useEffect(() => { api.get<{ name: string; nameBn: string | null }>('/auth/brand').then(setBrand).catch(() => {}); }, []);
  const farm = brand ? nameOf(brand, lang) : '';
  const farmOther = brand?.nameBn ? (lang === 'bn' ? brand.name : brand.nameBn) : '';
  useEffect(() => { if (farm) document.title = `${farm} · FarmLedger`; }, [farm]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (ticket) {
        await api.post('/auth/login/two-step', { ticket, code });
      } else {
        const r = await api.post<{ ok?: boolean; twoStep?: boolean; ticket?: string }>('/auth/login', { email, password });
        if (r.twoStep && r.ticket) { setTicket(r.ticket); setPassword(''); return; }
      }
      try { sessionStorage.removeItem('farmledger.home-opened'); } catch { /* storage unavailable */ } // lets Settings › Start-up apply once per sign-in
      refresh();
    } catch (err: any) {
      setError(err.message);
      // An expired or used-up ticket means starting again from the password.
      if (ticket && /password again/i.test(err.message)) { setTicket(''); setCode(''); }
    } finally { setBusy(false); }
  };
  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="auth-crest">
          <span className="brand-mark"><LogoMark size={46} variant="egg" /></span>
          <div><small>{farmOther || 'FarmLedger ERP'}</small><b>{farm || 'FarmLedger ERP'}</b></div>
        </div>
        <div className="auth-title">
          <h1>{lang === 'bn' ? <><em>মাটির</em> যত্নে,<br />হিসাবের সততায়।</> : <>Rooted in the <em>land</em>,<br />run with integrity.</>}</h1>
          <p>{t('The farm’s sales, flocks, stock and accounts, kept in one place.', 'খামারের বিক্রয়, ঝাঁক, মজুদ ও হিসাব — এক জায়গায়।')}</p>
        </div>
        <img className="auth-photo" src={dawn} alt="" />
      </section>
      <section className="auth-form">
        <form onSubmit={submit} method="post" name="login">
          <div className="row between"><h1>{t('Sign in', 'সাইন ইন')}</h1><button type="button" className="btn ghost sm" onClick={() => set({ lang: lang === 'en' ? 'bn' : 'en' })}>{lang === 'en' ? 'বাংলা' : 'English'}</button></div>
          <p className="muted auth-hint">{t('Use the account your farm administrator created for you.', 'খামারের প্রশাসক আপনার জন্য যে অ্যাকাউন্ট তৈরি করেছেন তা ব্যবহার করুন।')}</p>
          {error && <Alert tone="error">{error}</Alert>}
          {!ticket ? <>
            <Field label={t('Email', 'ইমেইল')}><Input type="email" id="email" name="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} autoFocus /></Field>
            <Field label={t('Password', 'পাসওয়ার্ড')}><Input type="password" id="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
          </> : <>
            <p style={{ margin: 0 }}>{t('Open the authenticator app on your phone and type the 6-digit code for FarmLedger.', 'ফোনের অথেনটিকেটর অ্যাপ খুলে FarmLedger-এর ৬ অঙ্কের কোড দিন।')}</p>
            <Field label={t('Code', 'কোড')} hint={t('Lost your phone? Type one of your printed recovery codes instead.', 'ফোন হারিয়েছেন? এর বদলে আপনার প্রিন্ট করা একটি রিকভারি কোড দিন।')}>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)} autoFocus />
            </Field>
          </>}
          <button className="btn primary auth-submit" disabled={busy}>{busy ? t('Signing in…', 'সাইন ইন হচ্ছে…') : ticket ? t('Verify', 'যাচাই করুন') : t('Sign in', 'সাইন ইন')}</button>
          {!ticket && <PasskeySignIn onError={setError} />}
          {ticket && <button type="button" className="btn ghost" onClick={() => { setTicket(''); setCode(''); setError(''); }}>{t('Back', 'ফিরে যান')}</button>}
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
