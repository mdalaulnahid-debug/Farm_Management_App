import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, BookOpen, Bird, Gift, ChevronDown, ClipboardList, Contact, Egg, FileText, LayoutDashboard, LogOut, Menu,
  KeyRound, Monitor, Moon, Package, Palette, Plus, Receipt, Settings, ShieldCheck, ShoppingCart, Sun, Truck, UserRound, Wallet,
  FileCheck2,
} from 'lucide-react';
import { LogoMark } from '../brand/Logo';
import { nameOf, usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { BillDrawer, InvoiceDrawer, PaymentDrawer, ProductionDrawer } from '../components/forms';
import { AdjustDrawer } from '../pages/Inventory';
import { useSetLanguage } from '../pages/MyAccount';
import { GrantDrawer } from '../pages/BankingProjects';

type Quick = 'invoice' | 'receipt' | 'bill' | 'expense' | 'payment' | 'production' | 'usage' | 'grant' | null;

export default function Shell({ children }: { children: ReactNode }) {
  const { t, lang, theme, dark, fontSize, home, simple, set } = usePrefs();
  const setLang = useSetLanguage();
  const navigate = useNavigate();
  const { me, can, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [quick, setQuick] = useState<Quick>(null);
  const [menu, setMenu] = useState<'new' | 'user' | null>(null);
  const loc = useLocation();
  useEffect(() => { setNavOpen(false); setMenu(null); }, [loc.pathname, loc.hash]);
  // Settings › Start-up: once per sign-in, open the user's chosen page instead of the dashboard.
  useEffect(() => {
    let done = false;
    try { done = sessionStorage.getItem('farmledger.home-opened') === '1'; sessionStorage.setItem('farmledger.home-opened', '1'); } catch { /* storage unavailable */ }
    if (!done && home !== '/' && loc.pathname === '/') navigate(home, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups: { label: string; links: { to: string; label: string; icon: any; perm: string }[] }[] = [
    { label: '', links: [{ to: '/', label: t('Dashboard', 'ড্যাশবোর্ড'), icon: LayoutDashboard, perm: 'dashboard.view' }] },
    { label: t('Sales', 'বিক্রয়'), links: [
      { to: '/sales', label: t('Invoices', 'চালান'), icon: FileText, perm: 'sales.view' },
      { to: '/customers', label: t('Customers', 'ক্রেতা'), icon: Contact, perm: 'sales.view' },
    ] },
    { label: t('Purchases', 'ক্রয়'), links: [
      { to: '/purchases', label: t('Bills & expenses', 'বিল ও খরচ'), icon: ShoppingCart, perm: 'purchases.view' },
      { to: '/suppliers', label: t('Suppliers', 'সরবরাহকারী'), icon: Truck, perm: 'purchases.view' },
    ] },
    { label: t('Farm', 'খামার'), links: [
      { to: '/production', label: t('Production', 'উৎপাদন'), icon: Egg, perm: 'production.view' },
      { to: '/inventory', label: t('Inventory', 'মজুদ'), icon: Package, perm: 'inventory.view' },
    ] },
    { label: t('Finance', 'অর্থ'), links: [
      { to: '/banking', label: t('Cash & bank', 'নগদ ও ব্যাংক'), icon: Wallet, perm: 'banking.view' },
      { to: '/vouchers', label: t('Vouchers to check', 'যাচাইয়ের ভাউচার'), icon: FileCheck2, perm: 'accounting.manage' },
      { to: '/accounting', label: t('Accounting', 'হিসাবরক্ষণ'), icon: BookOpen, perm: 'accounting.view' },
      { to: '/reports', label: t('Reports', 'রিপোর্ট'), icon: BarChart3, perm: 'reports.view' },
    ] },
    { label: t('Administration', 'প্রশাসন'), links: [
      { to: '/admin', label: t('Users & settings', 'ব্যবহারকারী ও সেটিংস'), icon: ShieldCheck, perm: 'settings.manage' },
    ] },
  ];
  const visible = groups.map(g => ({ ...g, links: g.links.filter(l => can(l.perm) || (l.to === '/admin' && (can('users.manage') || can('audit.view')))) })).filter(g => g.links.length);

  const quickItems: { key: Exclude<Quick, null>; label: string; icon: any; perm: string }[] = [
    { key: 'invoice', label: t('Sales invoice', 'বিক্রয় চালান'), icon: FileText, perm: 'sales.create' },
    { key: 'receipt', label: t('Receive payment', 'টাকা আদায়'), icon: Receipt, perm: 'sales.create' },
    { key: 'expense', label: t('Expense', 'খরচ'), icon: ClipboardList, perm: 'purchases.create' },
    { key: 'bill', label: t('Purchase bill', 'ক্রয় বিল'), icon: ShoppingCart, perm: 'purchases.create' },
    { key: 'payment', label: t('Pay supplier', 'সরবরাহকারীকে পরিশোধ'), icon: Wallet, perm: 'purchases.create' },
    { key: 'production', label: t('Daily production', 'দৈনিক উৎপাদন'), icon: Bird, perm: 'production.manage' },
    { key: 'grant', label: t('Grant received', 'অনুদান প্রাপ্তি'), icon: Gift, perm: 'banking.manage' },
    { key: 'usage', label: t('Use stock (medicine, trays…)', 'মজুদ ব্যবহার (ওষুধ, ট্রে…)'), icon: Package, perm: 'inventory.manage|production.manage' },
  ];
  const allowedQuick = quickItems.filter(q => q.perm.split('|').some(can));
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);

  const orgTitle = me ? nameOf(me.organization, lang) : '';
  useEffect(() => { if (orgTitle) document.title = `${orgTitle} · FarmLedger`; }, [orgTitle]);

  const initials = me?.user.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label={t('Main navigation', 'প্রধান নেভিগেশন')}>
        <div className="brand">
          <span className="brand-mark"><LogoMark size={36} variant="egg" /></span>
          <div><b className="brand-org">{me ? nameOf(me.organization, lang) : 'FarmLedger'}</b><small>FarmLedger ERP</small></div>
        </div>
        {visible.map((g, i) => (
          <nav key={i} className="nav-group">
            {g.label && <span>{g.label}</span>}
            {g.links.map(l => <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><l.icon size={17} />{l.label}</NavLink>)}
          </nav>
        ))}
        <nav className="nav-group">
          <NavLink to="/account" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Settings size={17} />{t('My settings', 'আমার সেটিংস')}</NavLink>
        </nav>
        <div className="sidebar-foot">
          {me?.organization.lockDate && <div>🔒 {t('Books closed to', 'বই বন্ধ')} {me.organization.lockDate.slice(0, 10)}</div>}
          <div>FarmLedger ERP v1.0</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar" ref={menuRef}>
          <button className="btn ghost icon menu-btn" onClick={() => setNavOpen(o => !o)} aria-label="Menu"><Menu size={18} /></button>
          <div className="spacer" />
          {/* In the simple workspace the big buttons on the start page replace this menu. */}
          {allowedQuick.length > 0 && !simple && (
            <div className="relative">
              <button className="btn primary" onClick={() => setMenu(m => (m === 'new' ? null : 'new'))}><Plus size={16} /><span className="hide-sm">{t('New', 'নতুন')}</span><ChevronDown size={14} /></button>
              {menu === 'new' && <div className="menu">{allowedQuick.map(q => <button key={q.key} onClick={() => { setQuick(q.key); setMenu(null); }}><q.icon size={16} />{q.label}</button>)}</div>}
            </div>
          )}
          <button className="btn ghost sm lang-switch" title={t('Language', 'ভাষা')} onClick={() => set({ lang: lang === 'en' ? 'bn' : 'en' })}>{lang === 'en' ? 'বাংলা' : 'EN'}</button>
          <button className="btn ghost icon" title={t('Theme', 'থিম')} onClick={() => set({ theme: dark ? 'light' : 'dark' })}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <div className="relative">
            <button className="btn ghost user-btn" aria-haspopup="menu" aria-expanded={menu === 'user'} onClick={() => setMenu(m => (m === 'user' ? null : 'user'))}><span className="avatar">{initials}</span><span className="hide-sm">{me?.user.name}</span><ChevronDown size={14} /></button>
            {menu === 'user' && (
              <div className="menu user-menu" role="menu">
                <div className="um-head">
                  <span className="avatar lg">{initials}</span>
                  <div><b>{me?.user.name}</b><small>{me?.user.email}</small><span className="badge">{me?.user.role.name}</span></div>
                </div>
                <div className="um-quick">
                  <div className="um-row"><span>{t('Theme', 'থিম')}</span>
                    <div className="segmented">
                      {([['light', Sun, t('Light', 'উজ্জ্বল')], ['dark', Moon, t('Dark', 'গাঢ়')], ['system', Monitor, t('Match device', 'ডিভাইসের মতো')]] as const).map(([v, Icon, label]) => (
                        <button key={v} type="button" className={theme === v ? 'on' : ''} aria-pressed={theme === v} title={label} aria-label={label} onClick={() => set({ theme: v })}><Icon size={15} /></button>
                      ))}
                    </div>
                  </div>
                  <div className="um-row"><span>{t('Language', 'ভাষা')}</span>
                    <div className="segmented">
                      <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
                      <button type="button" className={lang === 'bn' ? 'on' : ''} aria-pressed={lang === 'bn'} onClick={() => setLang('bn')}>বাংলা</button>
                    </div>
                  </div>
                  <div className="um-row"><span>{t('Text size', 'লেখার আকার')}</span>
                    <div className="segmented">
                      <button type="button" disabled={fontSize <= 12} onClick={() => set({ fontSize: fontSize - 1 })} aria-label={t('Smaller text', 'ছোট লেখা')}>A−</button>
                      <button type="button" disabled={fontSize >= 20} onClick={() => set({ fontSize: fontSize + 1 })} aria-label={t('Larger text', 'বড় লেখা')}>A+</button>
                    </div>
                  </div>
                </div>
                <hr />
                <NavLink to="/account#profile" role="menuitem"><UserRound size={16} />{t('My profile', 'আমার প্রোফাইল')}</NavLink>
                <NavLink to="/account#appearance" role="menuitem"><Palette size={16} />{t('Appearance', 'প্রদর্শন')}</NavLink>
                <NavLink to="/account#security" role="menuitem"><KeyRound size={16} />{t('Password & security', 'পাসওয়ার্ড ও নিরাপত্তা')}</NavLink>
                <NavLink to="/account" role="menuitem"><Settings size={16} />{t('All settings', 'সব সেটিংস')}</NavLink>
                {(can('users.manage') || can('settings.manage')) && <NavLink to="/admin" role="menuitem"><ShieldCheck size={16} />{t('Users & farm settings', 'ব্যবহারকারী ও খামার সেটিংস')}</NavLink>}
                <hr />
                <button type="button" role="menuitem" className="um-signout" onClick={() => logout()}><LogOut size={16} />{t('Sign out', 'সাইন আউট')}</button>
              </div>
            )}
          </div>
        </header>
        {/* Keyed by page so each page arrives with a short fade (styles.css › .page-in). */}
        <main className="content page-in" key={loc.pathname}>{children}</main>
      </div>
      {quick === 'invoice' && <InvoiceDrawer onClose={() => setQuick(null)} />}
      {quick === 'receipt' && <PaymentDrawer direction="IN" onClose={() => setQuick(null)} />}
      {quick === 'bill' && <BillDrawer onClose={() => setQuick(null)} />}
      {quick === 'expense' && <BillDrawer expense onClose={() => setQuick(null)} />}
      {quick === 'payment' && <PaymentDrawer direction="OUT" onClose={() => setQuick(null)} />}
      {quick === 'production' && <ProductionDrawer onClose={() => setQuick(null)} />}
      {quick === 'usage' && <AdjustDrawer initialType="USAGE" onClose={() => setQuick(null)} />}
      {quick === 'grant' && <GrantDrawer onClose={() => setQuick(null)} />}
    </div>
  );
}
