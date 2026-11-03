// Passkeys: one-touch sign-in with the device's fingerprint, face, Windows Hello or PIN. The sign-in button for the
// sign-in page, and the list in My settings → Password & security. FarmLedger never sees the fingerprint or face:
// the device checks it and signs the sign-in for us.
import { useState, type FormEvent } from 'react';
import { Fingerprint, Pencil, Plus, Trash2 } from 'lucide-react';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { usePrefs } from '../lib/i18n';
import { fmtDateTime } from '../lib/format';
import { Alert, Card, Field, Input, Loading, useToast } from '../components/ui';

interface Passkey { id: string; name: string; createdAt: string; lastUsedAt: string | null }
interface PasskeyList { available: boolean; twoStepOn: boolean; data: Passkey[] }

const supported = () => typeof window !== 'undefined' && window.isSecureContext && browserSupportsWebAuthn();
/** The person closed the prompt or it timed out: not an error worth showing. */
const cancelled = (err: any) => err?.name === 'NotAllowedError' || err?.name === 'AbortError' || err?.code === 'ERROR_CEREMONY_ABORTED';

/** "Sign in with fingerprint / face", under the password form. Errors go to the sign-in page's own alert. */
export function PasskeySignIn({ onError }: { onError: (message: string) => void }) {
  const { t } = usePrefs();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!supported()) return null;
  const signIn = async () => {
    setBusy(true); onError('');
    try {
      const { challengeId, options } = await api.post('/auth/passkey/login/options');
      const response = await startAuthentication({ optionsJSON: options });
      await api.post('/auth/passkey/login', { challengeId, response });
      try { sessionStorage.removeItem('farmledger.home-opened'); } catch { /* storage unavailable */ } // as after a password sign-in
      refresh();
    } catch (err: any) {
      if (!cancelled(err)) onError(err.message);
    } finally { setBusy(false); }
  };
  return (
    <button type="button" className="btn auth-submit" disabled={busy} onClick={signIn}>
      <Fingerprint size={16} />{busy ? t('Waiting for your device…', 'আপনার ডিভাইসের অপেক্ষায়…') : t('Sign in with fingerprint / face', 'আঙুলের ছাপ / মুখ দিয়ে সাইন ইন')}
    </button>
  );
}

/** My settings → Password & security: the person's passkeys, add one on this device, rename, remove. */
export function PasskeyCard() {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const q = useApi<PasskeyList>('/auth/passkeys');
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const s = q.data;
  const done = () => { setAdding(false); setPassword(''); setRenaming(null); setRemoving(null); q.refetch(); };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (err: any) {
      if (err?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') setError(t('This device already has a passkey for FarmLedger.', 'এই ডিভাইসে FarmLedger-এর পাসকি আগেই আছে।'));
      else if (!cancelled(err)) setError(err.message);
    } finally { setBusy(false); }
  };
  const add = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const { challengeId, options } = await api.post('/auth/passkeys/options', { password });
    setPassword('');
    const response = await startRegistration({ optionsJSON: options });
    await api.post('/auth/passkeys', { challengeId, response });
    toast(t('Passkey added. Next time, sign in with one touch.', 'পাসকি যোগ হয়েছে। এরপর এক ছোঁয়ায় সাইন ইন করুন।'));
    done();
  }); };
  const rename = (e: FormEvent) => { e.preventDefault(); if (renaming) run(async () => { await api.patch(`/auth/passkeys/${renaming.id}`, { name: renaming.name }); done(); }); };
  const remove = (id: string) => run(async () => { await api.del(`/auth/passkeys/${id}`); toast(t('Passkey removed.', 'পাসকি সরানো হয়েছে।')); done(); });
  const blocked = !s ? '' : !s.available
    ? t('Passkeys work only on FarmLedger’s https address (the one ending in .ts.net).', 'পাসকি শুধু FarmLedger-এর https ঠিকানায় (যেটি .ts.net দিয়ে শেষ) কাজ করে।')
    : !s.twoStepOn ? t('Turn on 2-step sign-in first.', 'আগে ২-ধাপ সাইন-ইন চালু করুন।')
    : !supported() ? t('This browser cannot make passkeys.', 'এই ব্রাউজারে পাসকি তৈরি করা যায় না।') : '';
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Fingerprint size={18} />{t('Passkeys (fingerprint, face, PIN)', 'পাসকি (আঙুলের ছাপ, মুখ, পিন)')}</span>}
      subtitle={t('Sign in with one touch instead of typing your password and code. Your phone or computer checks your fingerprint, face or PIN; FarmLedger never sees it.', 'পাসওয়ার্ড ও কোড টাইপ না করে এক ছোঁয়ায় সাইন ইন করুন। আপনার ফোন বা কম্পিউটার আঙুলের ছাপ, মুখ বা পিন যাচাই করে; FarmLedger তা কখনো দেখে না।')} pad>
      {!s ? <Loading /> : (
        <div className="stack">
          {error && <Alert tone="error">{error}</Alert>}
          {s.data.length === 0 && <p className="muted small" style={{ margin: 0 }}>{t('No passkeys yet.', 'এখনো কোনো পাসকি নেই।')}</p>}
          {s.data.map(p => (
            <div key={p.id} className="row" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              {renaming?.id === p.id ? (
                <form onSubmit={rename} className="row" style={{ gap: 8 }}>
                  <Input aria-label={t('Passkey name', 'পাসকির নাম')} required maxLength={60} value={renaming.name} onChange={e => setRenaming({ id: p.id, name: e.target.value })} autoFocus />
                  <button className="btn sm primary" disabled={busy}>{t('Save', 'সংরক্ষণ')}</button>
                  <button type="button" className="btn sm ghost" onClick={() => setRenaming(null)}>{t('Cancel', 'বাতিল')}</button>
                </form>
              ) : (
                <div>
                  <b>{p.name}</b>
                  <div className="muted small">{t('Added', 'যোগ হয়েছে')} {fmtDateTime(p.createdAt, lang)} · {p.lastUsedAt ? `${t('Last used', 'শেষ ব্যবহার')} ${fmtDateTime(p.lastUsedAt, lang)}` : t('Never used', 'কখনো ব্যবহার হয়নি')}</div>
                </div>
              )}
              {renaming?.id !== p.id && (removing === p.id ? (
                <div className="row" style={{ gap: 8 }}>
                  <span className="small">{t('Remove this passkey?', 'এই পাসকি সরাবেন?')}</span>
                  <button className="btn sm danger" disabled={busy} onClick={() => remove(p.id)}>{t('Remove', 'সরান')}</button>
                  <button className="btn sm ghost" onClick={() => setRemoving(null)}>{t('Cancel', 'বাতিল')}</button>
                </div>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn sm ghost" onClick={() => { setRemoving(null); setRenaming({ id: p.id, name: p.name }); }}><Pencil size={14} />{t('Rename', 'নাম বদলান')}</button>
                  <button className="btn sm ghost" onClick={() => { setRenaming(null); setRemoving(p.id); }}><Trash2 size={14} />{t('Remove', 'সরান')}</button>
                </div>
              ))}
            </div>
          ))}
          {blocked && <Alert tone="warn">{blocked}</Alert>}
          {adding && !blocked ? (
            <form onSubmit={add} className="stack" style={{ maxWidth: 380 }}>
              <Field label={t('Your password', 'আপনার পাসওয়ার্ড')}><Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} autoFocus /></Field>
              <div className="row">
                <button className="btn primary" disabled={busy}><Fingerprint size={16} />{busy ? t('Waiting for your device…', 'আপনার ডিভাইসের অপেক্ষায়…') : t('Continue', 'চালিয়ে যান')}</button>
                <button type="button" className="btn ghost" onClick={done}>{t('Cancel', 'বাতিল')}</button>
              </div>
            </form>
          ) : (
            <div className="row"><button className="btn" disabled={!!blocked} onClick={() => setAdding(true)}><Plus size={16} />{t('Add a passkey on this device', 'এই ডিভাইসে পাসকি যোগ করুন')}</button></div>
          )}
          <p className="muted small" style={{ margin: 0 }}>{t('A passkey is tied to this website’s address. If the address changes, add your passkeys again.', 'পাসকি এই ওয়েবসাইটের ঠিকানার সাথে যুক্ত। ঠিকানা বদলালে পাসকিগুলো আবার যোগ করুন।')}</p>
        </div>
      )}
    </Card>
  );
}
