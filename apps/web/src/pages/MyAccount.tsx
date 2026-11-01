import { KeyRound, LogOut, Monitor, MonitorSmartphone, SlidersHorizontal, Smartphone, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useApi, useSave } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../lib/auth';
import { nameOf, usePrefs, type Lang } from '../lib/i18n';
import { Badge, Card, Field, Loading, PageHeader, Segmented, useToast } from '../components/ui';
import { ChangePassword } from './Login';

export default function MyAccount() {
  const { t, lang, theme, density, fontSize, accent, set } = usePrefs();
  const { me, logout } = useAuth();
  const toast = useToast();
  if (!me) return <Loading />;
  const u = me.user;
  const initials = u.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

  const setLang = (l: Lang) => {
    if (l === lang) return;
    set({ lang: l });
    api.patch('/auth/preferences', { locale: l }).catch((e: Error) => toast(e.message, 'error'));
  };

  return (
    <>
      <PageHeader crumb={t('My account', 'আমার অ্যাকাউন্ট')} title={u.name} subtitle={t('Your profile, display preferences and password.', 'আপনার প্রোফাইল, প্রদর্শনের পছন্দ ও পাসওয়ার্ড।')}
        actions={<button className="btn" onClick={() => logout()}><LogOut size={16} />{t('Sign out', 'সাইন আউট')}</button>} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 'var(--gap)' }}>
          <Card title={<span className="row" style={{ gap: 8 }}><UserRound size={18} />{t('Profile', 'প্রোফাইল')}</span>} subtitle={t('Ask an administrator to change your name, email or role.', 'নাম, ইমেইল বা ভূমিকা বদলাতে প্রশাসককে বলুন।')} pad>
            <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
              <span className="avatar" style={{ width: 48, height: 48, fontSize: '1.05em' }}>{initials}</span>
              <dl className="desc-list" style={{ margin: 0 }}>
                <dt>{t('Name', 'নাম')}</dt><dd>{u.name}</dd>
                <dt>{t('Email', 'ইমেইল')}</dt><dd>{u.email}</dd>
                <dt>{t('Role', 'ভূমিকা')}</dt><dd><Badge tone={u.role.key === 'owner' ? 'blue' : undefined}>{u.role.name}</Badge></dd>
                <dt>{t('Organization', 'প্রতিষ্ঠান')}</dt><dd>{nameOf(me.organization, lang)}</dd>
                <dt>{t('Permissions', 'অনুমতি')}</dt><dd>{t(`${u.permissions.length} granted by your role`, `আপনার ভূমিকা থেকে ${u.permissions.length}টি`)}</dd>
              </dl>
            </div>
          </Card>

          <Card title={<span className="row" style={{ gap: 8 }}><SlidersHorizontal size={18} />{t('Preferences', 'পছন্দসমূহ')}</span>} subtitle={t('Display settings apply to this browser. Language is also saved to your account.', 'প্রদর্শন সেটিংস এই ব্রাউজারে প্রযোজ্য। ভাষা আপনার অ্যাকাউন্টেও সংরক্ষিত হয়।')} pad>
            <div className="stack" style={{ gap: 16 }}>
              <Field label={t('Language', 'ভাষা')}>
                <div><Segmented value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} /></div>
              </Field>
              <Field label={t('Theme', 'থিম')}>
                <div><Segmented value={theme} onChange={v => set({ theme: v })} options={[{ value: 'light', label: t('Light', 'উজ্জ্বল') }, { value: 'dark', label: t('Dark', 'গাঢ়') }]} /></div>
              </Field>
              <Field label={t('Accent colour', 'মূল রং')}>
                <div className="row" style={{ gap: 10 }}>
                  {([['green', '#157347', t('Farm green', 'খামার সবুজ')], ['blue', '#2563eb', t('Blue', 'নীল')], ['purple', '#7c3aed', t('Purple', 'বেগুনি')], ['amber', '#d97706', t('Amber', 'কমলা')]] as const).map(([k, c, label]) => (
                    <button key={k} type="button" className={`swatch ${accent === k ? 'on' : ''}`} style={{ background: c }} title={label} aria-label={label} aria-pressed={accent === k} onClick={() => set({ accent: k })} />
                  ))}
                </div>
              </Field>
              <Field label={t('Density', 'ঘনত্ব')} hint={t('Compact fits more rows on screen.', 'কমপ্যাক্টে পর্দায় বেশি সারি আঁটে।')}>
                <div><Segmented value={density} onChange={v => set({ density: v })} options={[{ value: 'comfortable', label: t('Comfortable', 'আরামদায়ক') }, { value: 'compact', label: t('Compact', 'কমপ্যাক্ট') }]} /></div>
              </Field>
              <Field label={t(`Text size — ${fontSize}px`, `লেখার আকার — ${fontSize}px`)}>
                <div className="row">
                  <span className="muted small">A</span>
                  <input type="range" min={12} max={20} step={1} value={fontSize} onChange={e => set({ fontSize: Number(e.target.value) })} style={{ flex: 1, maxWidth: 260, accentColor: 'var(--brand)' }} aria-label={t('Text size', 'লেখার আকার')} />
                  <span className="muted" style={{ fontSize: '1.3em' }}>A</span>
                  {fontSize !== 14 && <button type="button" className="btn ghost sm" onClick={() => set({ fontSize: 14 })}>{t('Reset', 'রিসেট')}</button>}
                </div>
              </Field>
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 'var(--gap)' }}>
          <Card title={<span className="row" style={{ gap: 8 }}><KeyRound size={18} />{t('Change password', 'পাসওয়ার্ড পরিবর্তন')}</span>} subtitle={t('Use a password you do not use anywhere else. Changing it signs you out on your other devices.', 'এমন পাসওয়ার্ড দিন যা অন্য কোথাও ব্যবহার করেন না। বদলালে আপনার অন্য ডিভাইসগুলো থেকে সাইন আউট হবে।')} pad>
            <ChangePassword />
          </Card>
          <SignedInDevices />
        </div>
      </div>
    </>
  );
}

interface SignIn { id: string; current: boolean; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string | null; userAgent: string }

/** "Chrome · Windows" from a browser's user-agent text; good enough to recognise your own devices. */
const deviceOf = (ua: string) => {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return { label: [browser, os].filter(Boolean).join(' · '), phone: /Android|iPhone|Mobile/.test(ua) };
};

/** Where this account is signed in, with a way to end a lost or unknown device. */
function SignedInDevices() {
  const { t, lang } = usePrefs();
  const q = useApi<{ data: SignIn[] }>('/auth/sessions');
  const endOne = useSave<{ id: string }>('post', b => `/auth/sessions/${b.id}/end`, t('That device is signed out.', 'ঐ ডিভাইস সাইন আউট হয়েছে।'));
  const endOthers = useSave<void>('post', '/auth/sessions/end-others', t('Signed out on every other device.', 'অন্য সব ডিভাইস থেকে সাইন আউট হয়েছে।'));
  const list = q.data?.data ?? [];
  const others = list.filter(s => !s.current).length;
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><MonitorSmartphone size={18} />{t('Where you are signed in', 'যেখানে সাইন ইন করা আছে')}</span>}
      subtitle={t('If you see a device you do not recognise, sign it out and change your password.', 'অচেনা কোনো ডিভাইস দেখলে সেটি সাইন আউট করুন এবং পাসওয়ার্ড বদলান।')}
      actions={others > 0 && <button className="btn sm" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}><LogOut size={14} />{t('Sign out everywhere else', 'অন্য সব জায়গা থেকে সাইন আউট')}</button>} pad>
      {!q.data ? <Loading /> : (
        <div className="stack" style={{ gap: 10 }}>
          {list.map(s => {
            const d = deviceOf(s.userAgent);
            return (
              <div key={s.id} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                {d.phone ? <Smartphone size={20} className="muted" /> : <Monitor size={20} className="muted" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}><b>{d.label || t('Unknown device', 'অজানা ডিভাইস')}</b>{s.current && <Badge tone="green">{t('This device', 'এই ডিভাইস')}</Badge>}</div>
                  <div className="muted small">{t('Last active', 'শেষ সক্রিয়')} {fmtDateTime(s.lastSeenAt, lang)} · {t('signed in', 'সাইন ইন')} {fmtDateTime(s.createdAt, lang)}{s.ip ? ` · ${s.ip}` : ''}</div>
                </div>
                {!s.current && <button className="btn ghost sm" disabled={endOne.isPending} onClick={() => endOne.mutate({ id: s.id })}>{t('Sign out', 'সাইন আউট')}</button>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
