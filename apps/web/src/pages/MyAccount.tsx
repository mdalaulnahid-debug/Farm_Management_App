import { Fragment, useEffect, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CircleDollarSign, Info, KeyRound, Languages, LogOut, Monitor, MonitorSmartphone, Palette, Rocket, RotateCcw, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useApi, useSave } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { nameOf, usePrefs, type Accent, type FontSet, type Lang } from '../lib/i18n';
import { loadFontSet } from '../lib/fonts';
import { fmtDate, fmtDateTime, fmtLongDate, fmtMoney, ymd } from '../lib/format';
import { Badge, Card, Kpi, Loading, PageHeader, Segmented, Select, Switch, useToast } from '../components/ui';
import { ChangePassword } from './Login';
import { TwoStepCard } from './TwoStep';
import { PasskeyCard } from './Passkeys';

type Section = 'profile' | 'appearance' | 'language' | 'startup' | 'security' | 'about';

/** Changes the language and also saves it to the signed-in account, so it follows the user to other devices. */
export function useSetLanguage() {
  const { lang, set } = usePrefs();
  const toast = useToast();
  return (l: Lang) => {
    if (l === lang) return;
    set({ lang: l });
    api.patch('/auth/preferences', { locale: l }).catch((e: Error) => toast(e.message, 'error'));
  };
}

/** One labelled setting: what it is on the left, the control on the right (stacks on phones). */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="set-row"><div><b>{label}</b>{hint && <small>{hint}</small>}</div><div className="set-control">{children}</div></div>;
}

export default function MyAccount() {
  const { t, lang, theme, density, fontSize, accent, motion, banglaCalendar, home, fontSet, set, reset } = usePrefs();
  const { me, can, logout } = useAuth();
  const toast = useToast();
  const setLang = useSetLanguage();
  const loc = useLocation();
  const nav = useNavigate();
  // Appearance shows each reading font in its own face, so fetch those files while it is open.
  useEffect(() => { if (loc.hash === '#appearance') { void loadFontSet('easy'); void loadFontSet('friendly'); } }, [loc.hash]);
  if (!me) return <Loading />;
  const u = me.user;
  const initials = u.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

  const sections: { key: Section; label: string; icon: ComponentType<{ size?: number }> }[] = [
    { key: 'profile', label: t('Profile', 'প্রোফাইল'), icon: UserRound },
    { key: 'appearance', label: t('Appearance', 'প্রদর্শন'), icon: Palette },
    { key: 'language', label: t('Language & region', 'ভাষা ও অঞ্চল'), icon: Languages },
    { key: 'startup', label: t('Start-up', 'শুরুর পাতা'), icon: Rocket },
    { key: 'security', label: t('Password & security', 'পাসওয়ার্ড ও নিরাপত্তা'), icon: KeyRound },
    { key: 'about', label: t('About', 'সম্পর্কে'), icon: Info },
  ];
  const fromHash = loc.hash.slice(1) as Section;
  const section: Section = sections.some(s => s.key === fromHash) ? fromHash : 'profile';
  const go = (s: Section) => nav({ hash: s }, { replace: true });

  // What the role allows, grouped by area; the labels mirror the sidebar.
  const areas: { key: string; label: string }[] = [
    { key: 'dashboard', label: t('Dashboard', 'ড্যাশবোর্ড') }, { key: 'sales', label: t('Sales & invoices', 'বিক্রয় ও চালান') },
    { key: 'purchases', label: t('Bills & expenses', 'বিল ও খরচ') }, { key: 'parties', label: t('Customers & suppliers', 'ক্রেতা ও সরবরাহকারী') },
    { key: 'production', label: t('Production', 'উৎপাদন') }, { key: 'inventory', label: t('Inventory', 'মজুদ') },
    { key: 'banking', label: t('Cash & bank', 'নগদ ও ব্যাংক') }, { key: 'accounting', label: t('Accounting', 'হিসাবরক্ষণ') },
    { key: 'reports', label: t('Reports', 'রিপোর্ট') }, { key: 'settings', label: t('Farm settings', 'খামার সেটিংস') },
    { key: 'users', label: t('Users & roles', 'ব্যবহারকারী ও ভূমিকা') }, { key: 'audit', label: t('Activity log', 'কার্যক্রমের লগ') },
  ];
  const actionLabel = (a: string) => ({ view: t('View', 'দেখা'), create: t('Create', 'তৈরি'), void: t('Void', 'বাতিল'), manage: t('Manage', 'পরিচালনা') } as Record<string, string>)[a] ?? a;
  const granted = areas.map(a => ({ ...a, actions: u.permissions.filter(p => p.startsWith(`${a.key}.`)).map(p => p.split('.')[1]) })).filter(a => a.actions.length);

  // Each sample is drawn in its own font, so people see what they pick (the files load on first choice).
  const fontSets: [FontSet, string, string][] = [
    ['clean', t('Clean', 'পরিচ্ছন্ন'), "'Inter', 'Hind Siliguri', sans-serif"],
    ['easy', t('Easy to read', 'সহজপাঠ্য'), "'Atkinson Hyperlegible', 'Noto Sans Bengali', sans-serif"],
    ['friendly', t('Friendly', 'বন্ধুসুলভ'), "'Nunito', 'Baloo Da 2', sans-serif"],
  ];
  const accents: [Accent, string, string][] = [['green', 'var(--swatch-green)', t('Farm green', 'খামার সবুজ')], ['blue', 'var(--swatch-blue)', t('Blue', 'নীল')], ['purple', 'var(--swatch-purple)', t('Purple', 'বেগুনি')], ['amber', 'var(--swatch-amber)', t('Amber', 'কমলা')]];
  const startPages = [
    { value: '/', label: t('Dashboard', 'ড্যাশবোর্ড'), perm: 'dashboard.view' },
    { value: '/sales', label: t('Invoices', 'চালান'), perm: 'sales.view' },
    { value: '/purchases', label: t('Bills & expenses', 'বিল ও খরচ'), perm: 'purchases.view' },
    { value: '/production', label: t('Production', 'উৎপাদন'), perm: 'production.view' },
    { value: '/inventory', label: t('Inventory', 'মজুদ'), perm: 'inventory.view' },
    { value: '/banking', label: t('Cash & bank', 'নগদ ও ব্যাংক'), perm: 'banking.view' },
    { value: '/reports', label: t('Reports', 'রিপোর্ট'), perm: 'reports.view' },
  ].filter(p => can(p.perm));
  const current = sections.find(s => s.key === section)!;

  return (
    <>
      <PageHeader crumb={t('Settings', 'সেটিংস')} title={t('Settings', 'সেটিংস')} subtitle={t('Your profile, how FarmLedger looks and behaves for you, and your password.', 'আপনার প্রোফাইল, FarmLedger আপনার জন্য কেমন দেখাবে ও চলবে, এবং আপনার পাসওয়ার্ড।')} />
      <div className="settings">
        <nav className="settings-nav" aria-label={t('Settings sections', 'সেটিংসের অংশ')}>
          {sections.map(s => (
            <button key={s.key} type="button" className={s.key === section ? 'on' : ''} aria-current={s.key === section ? 'page' : undefined} onClick={() => go(s.key)}><s.icon size={17} />{s.label}</button>
          ))}
        </nav>

        <div className="settings-body">
          {section === 'profile' && <>
            <Card pad>
              <div className="profile-head">
                <span className="avatar xl">{initials}</span>
                <div>
                  <h2>{u.name}</h2>
                  <div className="muted">{u.email}</div>
                  <div className="row" style={{ marginTop: 8 }}><Badge tone={u.role.key === 'owner' ? 'blue' : undefined}>{u.role.name}</Badge><span className="muted small">{nameOf(me.organization, lang)}</span></div>
                </div>
              </div>
              <p className="muted small set-note">{can('users.manage')
                ? <>{t('You can change names, emails and roles in ', 'নাম, ইমেইল ও ভূমিকা বদলাতে যান ')}<Link to="/admin">{t('Users & settings', 'ব্যবহারকারী ও সেটিংস')}</Link>.</>
                : t('To change your name, email or role, ask your farm administrator.', 'নাম, ইমেইল বা ভূমিকা বদলাতে খামারের প্রশাসককে বলুন।')}</p>
            </Card>
            <Card title={t('What your role can do', 'আপনার ভূমিকায় যা করা যায়')} subtitle={t(`${u.role.name} · ${u.permissions.length} permissions`, `${u.role.name} · ${u.permissions.length}টি অনুমতি`)} pad>
              <dl className="perm-list">
                {granted.map(a => <Fragment key={a.key}><dt>{a.label}</dt><dd>{a.actions.map(x => <Badge key={x} tone={x === 'view' ? undefined : 'green'}>{actionLabel(x)}</Badge>)}</dd></Fragment>)}
              </dl>
            </Card>
          </>}

          {section === 'appearance' && <>
            <Card title={t('Appearance', 'প্রদর্শন')} subtitle={t('Saved to your account, so the shared office PC and your phone both look the way you chose.', 'আপনার অ্যাকাউন্টে সংরক্ষিত, তাই অফিসের কম্পিউটার ও আপনার ফোন দুটোতেই আপনার পছন্দমতো দেখাবে।')} pad>
              <Row label={t('Theme', 'থিম')} hint={t('“Match device” follows your phone or computer’s light/dark setting.', '“ডিভাইসের মতো” আপনার ফোন বা কম্পিউটারের আলো/অন্ধকার সেটিং অনুসরণ করে।')}>
                <Segmented value={theme} onChange={v => set({ theme: v })} options={[{ value: 'light', label: t('Light', 'উজ্জ্বল') }, { value: 'dark', label: t('Dark', 'গাঢ়') }, { value: 'system', label: t('Match device', 'ডিভাইসের মতো') }]} />
              </Row>
              <Row label={t('Reading font', 'পড়ার ফন্ট')} hint={t('“Easy to read” is made for weaker eyesight: every letter and number looks different.', '“সহজপাঠ্য” দুর্বল দৃষ্টির জন্য তৈরি: প্রতিটি অক্ষর ও সংখ্যা আলাদা দেখায়।')}>
                <div className="font-sets" role="radiogroup" aria-label={t('Reading font', 'পড়ার ফন্ট')}>
                  {fontSets.map(([k, label, family]) => (
                    <button key={k} type="button" role="radio" aria-checked={fontSet === k} className={`font-set ${fontSet === k ? 'on' : ''}`} onClick={() => set({ fontSet: k })}>
                      <span className="font-set-sample" style={{ fontFamily: family }}>Aa অআ 0O 1l</span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </Row>
              <Row label={t('Accent colour', 'মূল রং')} hint={t('Colours the menu panel, buttons and highlights.', 'মেনু প্যানেল, বোতাম ও হাইলাইটের রং।')}>
                <div className="swatches">
                  {accents.map(([k, c, label]) => (
                    <button key={k} type="button" className={`swatch-btn ${accent === k ? 'on' : ''}`} aria-pressed={accent === k} onClick={() => set({ accent: k })}>
                      <span className="swatch" style={{ background: c }} />{label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label={t('Density', 'ঘনত্ব')} hint={t('Compact fits more rows on screen.', 'কমপ্যাক্টে পর্দায় বেশি সারি আঁটে।')}>
                <Segmented value={density} onChange={v => set({ density: v })} options={[{ value: 'comfortable', label: t('Comfortable', 'আরামদায়ক') }, { value: 'compact', label: t('Compact', 'কমপ্যাক্ট') }]} />
              </Row>
              <Row label={t('Text size', 'লেখার আকার')} hint={t(`${fontSize}px · default 14px`, `${fontSize}px · স্বাভাবিক ১৪px`)}>
                <div className="row">
                  <button type="button" className="btn sm" disabled={fontSize <= 12} onClick={() => set({ fontSize: fontSize - 1 })} aria-label={t('Smaller text', 'ছোট লেখা')}>A−</button>
                  <input type="range" className="range" min={12} max={20} step={1} value={fontSize} onChange={e => set({ fontSize: Number(e.target.value) })} aria-label={t('Text size', 'লেখার আকার')} />
                  <button type="button" className="btn sm" disabled={fontSize >= 20} onClick={() => set({ fontSize: fontSize + 1 })} aria-label={t('Larger text', 'বড় লেখা')}>A+</button>
                </div>
              </Row>
              <Row label={t('Motion', 'অ্যানিমেশন')} hint={t('“Reduced” turns off fades and movement, e.g. for slower phones.', '“কম” বেছে নিলে নড়াচড়া ও ফেড বন্ধ থাকে, যেমন ধীর ফোনের জন্য।')}>
                <Segmented value={motion} onChange={v => set({ motion: v })} options={[{ value: 'full', label: t('Full', 'পূর্ণ') }, { value: 'reduce', label: t('Reduced', 'কম') }]} />
              </Row>
            </Card>
            <Card title={t('Preview', 'নমুনা')} subtitle={t('How cards and buttons look with these settings.', 'এই সেটিংসে কার্ড ও বোতাম যেমন দেখাবে।')} pad>
              <div className="preview">
                <Kpi icon={CircleDollarSign} label={t('Sales this month', 'এই মাসে বিক্রি')} value={fmtMoney(125000, lang)} sub={t('42 invoices', '৪২টি চালান')} />
                <div className="row"><button type="button" className="btn primary">{t('New invoice', 'নতুন চালান')}</button><button type="button" className="btn">{t('Export', 'ডাউনলোড')}</button><Badge tone="green">{t('Paid', 'পরিশোধিত')}</Badge></div>
              </div>
            </Card>
          </>}

          {section === 'language' && (
            <Card title={t('Language & region', 'ভাষা ও অঞ্চল')} pad>
              <Row label={t('Language', 'ভাষা')} hint={t('Saved to your account, so it follows you to other devices.', 'আপনার অ্যাকাউন্টে সংরক্ষিত, তাই অন্য ডিভাইসেও একই থাকবে।')}>
                <Segmented value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} />
              </Row>
              <Row label={t('Bangla calendar date', 'বাংলা সনের তারিখ')} hint={fmtLongDate(new Date(), lang, true)}>
                <Switch checked={banglaCalendar} onChange={v => set({ banglaCalendar: v })} label={t('Show on the dashboard', 'ড্যাশবোর্ডে দেখান')} />
              </Row>
              <Row label={t('Numbers, money and dates', 'সংখ্যা, টাকা ও তারিখ')} hint={t('Follow the language. Amounts use lakh grouping.', 'ভাষা অনুযায়ী দেখায়। টাকায় লাখের হিসাবে কমা বসে।')}>
                <div className="sample">{fmtMoney(1234567, lang)} · {fmtDate(ymd(), lang)}</div>
              </Row>
              <Row label={t('Currency', 'মুদ্রা')} hint={t('Set by the farm for every user.', 'খামার সবার জন্য ঠিক করে।')}>
                <div className="sample">৳ {me.organization.currency}</div>
              </Row>
            </Card>
          )}

          {section === 'startup' && (
            <Card title={t('Start-up', 'শুরুর পাতা')} pad>
              <Row label={t('Open after sign-in', 'সাইন ইনের পর খুলবে')} hint={t('Data-entry staff can go straight to the page they use most. Saved on this device.', 'ডেটা এন্ট্রির কর্মীরা সবচেয়ে বেশি ব্যবহৃত পাতায় সরাসরি যেতে পারেন। এই ডিভাইসে সংরক্ষিত।')}>
                <Select value={startPages.some(p => p.value === home) ? home : startPages[0]?.value ?? '/'} onChange={e => set({ home: e.target.value })} options={startPages} aria-label={t('Open after sign-in', 'সাইন ইনের পর খুলবে')} />
              </Row>
            </Card>
          )}

          {section === 'security' && <>
            <Card title={t('Change password', 'পাসওয়ার্ড পরিবর্তন')} subtitle={t('Use a password you do not use anywhere else. Changing it signs you out on your other devices.', 'এমন পাসওয়ার্ড দিন যা অন্য কোথাও ব্যবহার করেন না। বদলালে আপনার অন্য ডিভাইসগুলো থেকে সাইন আউট হবে।')} pad>
              <ChangePassword />
            </Card>
            <TwoStepCard />
            <PasskeyCard />
            <SignedInDevices />
            <Card title={t('Staying safe', 'নিরাপদ থাকুন')} pad>
              <ul className="tips">
                <li><ShieldCheck size={16} />{t('Never share your password. Each person signs in with their own account, so the activity log shows who did what.', 'পাসওয়ার্ড কাউকে দেবেন না। প্রত্যেকে নিজের অ্যাকাউন্টে সাইন ইন করেন, তাই লগে কে কী করেছে তা দেখা যায়।')}</li>
                <li><LogOut size={16} />{t('Sign out when you finish on a shared office computer or someone else’s phone.', 'অফিসের শেয়ার করা কম্পিউটার বা অন্যের ফোনে কাজ শেষে সাইন আউট করুন।')}</li>
                <li><KeyRound size={16} />{t('Forgot your password? Your farm administrator can set a temporary one for you.', 'পাসওয়ার্ড ভুলে গেলে খামারের প্রশাসক একটি অস্থায়ী পাসওয়ার্ড দিতে পারেন।')}</li>
              </ul>
              <div className="row" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={() => logout()}><LogOut size={16} />{t('Sign out of this device', 'এই ডিভাইস থেকে সাইন আউট')}</button></div>
            </Card>
          </>}

          {section === 'about' && (
            <Card title={t('About', 'সম্পর্কে')} pad>
              <Row label="FarmLedger ERP" hint={t('Version 1.0', 'সংস্করণ ১.০')}><span className="sample">{nameOf(me.organization, lang)}</span></Row>
              <Row label={t('Where settings are saved', 'সেটিংস কোথায় থাকে')} hint={t('Language and display settings are saved to your account, so they follow you to any phone or computer you sign in on.', 'ভাষা ও প্রদর্শন সেটিংস আপনার অ্যাকাউন্টে সংরক্ষিত, তাই যে ফোন বা কম্পিউটারেই সাইন ইন করুন, একই থাকবে।')}><span /></Row>
              {can('settings.manage') && (
                <Row label={t('Design reference', 'ডিজাইন রেফারেন্স')} hint={t('Every colour and building block of the shared design system, for checking the look.', 'শেয়ার করা ডিজাইন সিস্টেমের প্রতিটি রং ও অংশ, চেহারা যাচাইয়ের জন্য।')}>
                  <Link className="btn" to="/system"><Palette size={16} />{t('Open', 'খুলুন')}</Link>
                </Row>
              )}
              <Row label={t('Reset display settings', 'প্রদর্শন সেটিংস রিসেট')} hint={t('Theme, colour, density, text size, motion, calendar and start page go back to their defaults. Language is kept.', 'থিম, রং, ঘনত্ব, লেখার আকার, অ্যানিমেশন, সন ও শুরুর পাতা আগের মতো হবে। ভাষা বদলাবে না।')}>
                <button type="button" className="btn" onClick={() => { reset(); toast(t('Display settings reset.', 'প্রদর্শন সেটিংস রিসেট হয়েছে।')); }}><RotateCcw size={16} />{t('Reset', 'রিসেট')}</button>
              </Row>
            </Card>
          )}
          <span className="sr-only" aria-live="polite">{current.label}</span>
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
