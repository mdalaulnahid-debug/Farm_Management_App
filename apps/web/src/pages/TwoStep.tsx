import { useState, type FormEvent } from 'react';
import { Copy, Printer, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { usePrefs } from '../lib/i18n';
import { fmtDateTime, fmtNum } from '../lib/format';
import { Alert, Badge, Card, Field, Input, Loading, useToast } from '../components/ui';

interface Status { enabled: boolean; enabledAt: string | null; required: boolean; recoveryCodesLeft: number; passkeys: number }

/** The one-time recovery codes, shown once right after they are made. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = usePrefs();
  const toast = useToast();
  const copy = () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast(t('Codes copied.', 'কোডগুলো কপি হয়েছে।')), () => {});
  return (
    <div className="stack">
      <Alert tone="warn">{t('Save these recovery codes now: print them or write them down, and keep them somewhere safe away from your phone. Each one works once if you lose your phone. They will not be shown again.', 'এই রিকভারি কোডগুলো এখনই সংরক্ষণ করুন: প্রিন্ট করুন বা লিখে রাখুন, এবং ফোন থেকে আলাদা নিরাপদ জায়গায় রাখুন। ফোন হারালে প্রতিটি একবার কাজ করবে। এগুলো আর দেখানো হবে না।')}</Alert>
      <ol className="mono" style={{ columns: 2, margin: 0, paddingLeft: 24, lineHeight: 1.9, fontSize: 15 }}>{codes.map(c => <li key={c}>{c}</li>)}</ol>
      <div className="row">
        <button type="button" className="btn" onClick={copy}><Copy size={16} />{t('Copy', 'কপি')}</button>
        <button type="button" className="btn" onClick={() => window.print()}><Printer size={16} />{t('Print', 'প্রিন্ট')}</button>
        <button type="button" className="btn primary" onClick={onDone}>{t('I have saved them', 'সংরক্ষণ করেছি')}</button>
      </div>
    </div>
  );
}

/** Turn on 2-step sign-in: password, scan the QR code, type the first code, save the recovery codes. */
export function TwoStepSetup({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { t } = usePrefs();
  const { refresh, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (e: FormEvent, fn: () => Promise<void>) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await fn(); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const start = (e: FormEvent) => run(e, async () => { setSetup(await api.post('/auth/two-step/start', { password })); setPassword(''); });
  const confirm = (e: FormEvent) => run(e, async () => { setCodes((await api.post<{ recoveryCodes: string[] }>('/auth/two-step/confirm', { code })).recoveryCodes); });
  const finish = () => { refresh(); onDone?.(); };

  const body = codes ? <RecoveryCodes codes={codes} onDone={finish} /> : !setup ? (
    <form onSubmit={start} className="stack">
      <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
        <li>{t('Install a free authenticator app on your phone: Google Authenticator, Microsoft Authenticator or 2FAS.', 'ফোনে একটি ফ্রি অথেনটিকেটর অ্যাপ ইনস্টল করুন: Google Authenticator, Microsoft Authenticator বা 2FAS।')}</li>
        <li>{t('Type your password below to continue.', 'চালিয়ে যেতে নিচে আপনার পাসওয়ার্ড দিন।')}</li>
      </ol>
      <Field label={t('Your password', 'আপনার পাসওয়ার্ড')}><Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <div className="row"><button className="btn primary" disabled={busy}><Smartphone size={16} />{t('Continue', 'চালিয়ে যান')}</button></div>
    </form>
  ) : (
    <form onSubmit={confirm} className="stack">
      <p className="small" style={{ margin: 0 }}>{t('In the app, tap “+” or “Add account”, then scan this code:', 'অ্যাপে “+” বা “Add account” চাপুন, তারপর এই কোডটি স্ক্যান করুন:')}</p>
      <img src={setup.qr} alt={t('QR code for the authenticator app', 'অথেনটিকেটর অ্যাপের কিউআর কোড')} width={200} height={200} style={{ background: '#fff', padding: 8, borderRadius: 8, alignSelf: 'flex-start' }} />
      <details className="small"><summary>{t('Cannot scan? Type this key instead', 'স্ক্যান করা যাচ্ছে না? এই কী টাইপ করুন')}</summary><code className="mono" style={{ wordBreak: 'break-all' }}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code></details>
      <Field label={t('6-digit code from the app', 'অ্যাপের ৬ অঙ্কের কোড')}><Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required value={code} onChange={e => setCode(e.target.value)} /></Field>
      <div className="row"><button className="btn primary" disabled={busy}><ShieldCheck size={16} />{t('Turn on 2-step sign-in', '২-ধাপ সাইন-ইন চালু করুন')}</button></div>
    </form>
  );

  if (!forced) return <div className="stack">{error && <Alert tone="error">{error}</Alert>}{body}</div>;
  return (
    <div className="auth-form" style={{ minHeight: '100%' }}>
      <div className="stack" style={{ width: 'min(440px, 100%)' }}>
        <h1>{t('Set up 2-step sign-in', '২-ধাপ সাইন-ইন সেট আপ করুন')}</h1>
        <p className="muted" style={{ margin: 0 }}>{t('Your farm requires a code from your phone at every sign-in, so a stolen password alone is not enough. This takes about two minutes.', 'আপনার খামারে প্রতিবার সাইন-ইনে ফোনের একটি কোড লাগে, যাতে শুধু চুরি হওয়া পাসওয়ার্ডে কাজ না হয়। এতে প্রায় দুই মিনিট লাগবে।')}</p>
        {error && <Alert tone="error">{error}</Alert>}
        {body}
        {!codes && <div className="row"><button type="button" className="btn ghost" onClick={() => logout()}>{t('Sign out', 'সাইন আউট')}</button></div>}
      </div>
    </div>
  );
}

/** My settings → Password & security: status, setup, new recovery codes, turn off. */
export function TwoStepCard() {
  const { t, lang } = usePrefs();
  const { refresh } = useAuth();
  const toast = useToast();
  const q = useApi<Status>('/auth/two-step');
  const [mode, setMode] = useState<'idle' | 'setup' | 'codes' | 'off'>('idle');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const s = q.data;
  const reset = () => { setMode('idle'); setCode(''); setPassword(''); setCodes(null); setError(''); q.refetch(); refresh(); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    try {
      if (mode === 'codes') setCodes((await api.post<{ recoveryCodes: string[] }>('/auth/two-step/recovery-codes', { code })).recoveryCodes);
      if (mode === 'off') { await api.post('/auth/two-step/disable', { password, code }); toast(t('2-step sign-in is off.', '২-ধাপ সাইন-ইন বন্ধ।')); reset(); }
    } catch (err: any) { setError(err.message); }
  };
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><ShieldCheck size={18} />{t('2-step sign-in', '২-ধাপ সাইন-ইন')}</span>}
      subtitle={t('After your password, FarmLedger asks for a 6-digit code from an app on your phone. Someone who learns your password still cannot get in.', 'পাসওয়ার্ডের পরে FarmLedger আপনার ফোনের অ্যাপ থেকে ৬ অঙ্কের একটি কোড চায়। কেউ পাসওয়ার্ড জানলেও ঢুকতে পারবে না।')} pad>
      {!s ? <Loading /> : (
        <div className="stack">
          <div className="row" style={{ gap: 8 }}>
            {s.enabled ? <Badge tone="green">{t('On', 'চালু')}</Badge> : <Badge tone="amber">{t('Off', 'বন্ধ')}</Badge>}
            {s.enabled && s.enabledAt && <span className="muted small">{t('since', 'থেকে')} {fmtDateTime(s.enabledAt, lang)} · {t(`${s.recoveryCodesLeft} recovery codes left`, `${fmtNum(s.recoveryCodesLeft, lang, 0)}টি রিকভারি কোড বাকি`)}</span>}
            {s.required && <Badge tone="blue">{t('Required by your farm', 'খামারের নিয়মে বাধ্যতামূলক')}</Badge>}
          </div>
          {s.enabled && s.recoveryCodesLeft <= 3 && mode === 'idle' && <Alert tone="warn">{t('Few recovery codes left. Make new ones.', 'রিকভারি কোড প্রায় শেষ। নতুন কোড তৈরি করুন।')}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          {!s.enabled && (mode === 'setup' ? <TwoStepSetup onDone={reset} /> : <div className="row"><button className="btn primary" onClick={() => setMode('setup')}><Smartphone size={16} />{t('Turn on 2-step sign-in', '২-ধাপ সাইন-ইন চালু করুন')}</button></div>)}
          {s.enabled && codes && <RecoveryCodes codes={codes} onDone={reset} />}
          {s.enabled && !codes && mode === 'idle' && (
            <div className="row">
              <button className="btn" onClick={() => setMode('codes')}>{t('New recovery codes', 'নতুন রিকভারি কোড')}</button>
              {!s.required && <button className="btn ghost" onClick={() => setMode('off')}>{t('Turn off', 'বন্ধ করুন')}</button>}
            </div>
          )}
          {s.enabled && !codes && (mode === 'codes' || mode === 'off') && (
            <form onSubmit={submit} className="stack" style={{ maxWidth: 380 }}>
              {mode === 'off' && s.passkeys > 0 && <Alert tone="warn">{t(`Turning off 2-step sign-in also removes your ${s.passkeys} passkey(s).`, `২-ধাপ সাইন-ইন বন্ধ করলে আপনার ${fmtNum(s.passkeys, lang, 0)}টি পাসকিও সরে যাবে।`)}</Alert>}
              {mode === 'off' && <Field label={t('Your password', 'আপনার পাসওয়ার্ড')}><Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>}
              <Field label={t('Code from the app (or a recovery code)', 'অ্যাপের কোড (বা একটি রিকভারি কোড)')}><Input autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)} /></Field>
              <div className="row">
                <button className={`btn ${mode === 'off' ? 'danger' : 'primary'}`}>{mode === 'off' ? t('Turn off 2-step sign-in', '২-ধাপ সাইন-ইন বন্ধ করুন') : t('Make new codes', 'নতুন কোড তৈরি করুন')}</button>
                <button type="button" className="btn ghost" onClick={reset}>{t('Cancel', 'বাতিল')}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
