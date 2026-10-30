import { KeyRound, LogOut, SlidersHorizontal, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePrefs, type Lang } from '../lib/i18n';
import { Badge, Card, Field, Loading, PageHeader, Segmented, useToast } from '../components/ui';
import { ChangePassword } from './Login';

export default function MyAccount() {
  const { t, lang, theme, density, fontSize, set } = usePrefs();
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
                <dt>{t('Organization', 'প্রতিষ্ঠান')}</dt><dd>{me.organization.name}</dd>
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
              <Field label={t('Density', 'ঘনত্ব')} hint={t('Compact fits more rows on screen.', 'কমপ্যাক্টে পর্দায় বেশি সারি আঁটে।')}>
                <div><Segmented value={density} onChange={v => set({ density: v })} options={[{ value: 'comfortable', label: t('Comfortable', 'আরামদায়ক') }, { value: 'compact', label: t('Compact', 'কমপ্যাক্ট') }]} /></div>
              </Field>
              <Field label={t(`Text size — ${fontSize}px`, `লেখার আকার — ${fontSize}px`)}>
                <div className="row">
                  <span className="muted small">A</span>
                  <input type="range" min={13} max={18} step={1} value={fontSize} onChange={e => set({ fontSize: Number(e.target.value) })} style={{ flex: 1, maxWidth: 260, accentColor: 'var(--brand)' }} aria-label={t('Text size', 'লেখার আকার')} />
                  <span className="muted" style={{ fontSize: '1.3em' }}>A</span>
                  {fontSize !== 14 && <button type="button" className="btn ghost sm" onClick={() => set({ fontSize: 14 })}>{t('Reset', 'রিসেট')}</button>}
                </div>
              </Field>
            </div>
          </Card>
        </div>

        <Card title={<span className="row" style={{ gap: 8 }}><KeyRound size={18} />{t('Change password', 'পাসওয়ার্ড পরিবর্তন')}</span>} subtitle={t('Use a password you do not use anywhere else.', 'এমন পাসওয়ার্ড দিন যা অন্য কোথাও ব্যবহার করেন না।')} pad>
          <ChangePassword />
        </Card>
      </div>
    </>
  );
}
