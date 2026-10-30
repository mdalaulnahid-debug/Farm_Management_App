// Shared UI kit. Pages compose these; styling lives in styles.css.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Info, Loader2, Search, X, XCircle } from 'lucide-react';
import { useT, statusLabel } from '../lib/i18n';
import { iso10, monthEnd, monthStart, ymd } from '../lib/format';

// ───── Toasts ─────
type ToastFn = (message: string, kind?: 'ok' | 'error') => void;
const ToastContext = createContext<ToastFn>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string; kind: 'ok' | 'error' }[]>([]);
  const push = useCallback<ToastFn>((message, kind = 'ok') => {
    const id = Date.now() + Math.random();
    setItems(xs => [...xs, { id, message, kind }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(i => (
          <div key={i.id} className={`toast ${i.kind === 'error' ? 'error' : ''}`}>
            {i.kind === 'error' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}<span>{i.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ───── Layout primitives ─────
export function PageHeader({ title, subtitle, crumb, actions }: { title: string; subtitle?: string; crumb?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>{crumb && <div className="crumb">{crumb}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, pad, className = '' }: { title?: ReactNode; subtitle?: string; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-head"><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="row">{actions}</div>}</div>}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function Kpi({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: ReactNode; sub?: ReactNode; tone?: 'amber' | 'blue' | 'red' }) {
  return (
    <div className="card kpi">
      <div className="kpi-label"><span className={`kpi-icon ${tone ?? ''}`}><Icon size={16} /></span>{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue' }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

/** `settled` = a record that has no payment state (payments, journals, production): POSTED reads "Posted". */
export function StatusBadge({ status, settled }: { status: string; settled?: boolean }) {
  const t = useT();
  if (settled && status === 'POSTED') return <Badge tone="green">{t('Posted', 'পোস্ট হয়েছে')}</Badge>;
  const tone = ({ PAID: 'green', PARTIAL: 'amber', POSTED: 'blue', VOID: 'red', ACTIVE: 'green' } as const)[status as 'PAID'];
  return <Badge tone={tone}>{statusLabel(t, status)}</Badge>;
}

export function Alert({ children, tone }: { children: ReactNode; tone?: 'warn' | 'error' }) {
  const Icon = tone === 'error' ? XCircle : tone === 'warn' ? AlertTriangle : Info;
  return <div className={`alert ${tone ?? ''}`}><Icon size={18} /><div>{children}</div></div>;
}

export function Empty({ children, icon: Icon = Inbox }: { children: ReactNode; icon?: any }) {
  return <div className="empty"><Icon size={28} />{children}</div>;
}

export function Loading() {
  const t = useT();
  return <div className="empty"><Loader2 size={22} className="spin" style={{ animation: 'spin 1s linear infinite' }} />{t('Loading…', 'লোড হচ্ছে…')}<style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style></div>;
}

// ───── Form controls ─────
export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${error ? 'err' : ''} ${className}`}><span>{label}</span>{children}{(error || hint) && <small>{error || hint}</small>}</label>;
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.type === 'number' ? 'num' : ''} ${p.className ?? ''}`} />;

export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={`select ${p.className ?? ''}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useT();
  return <div className="search"><Search size={15} /><input className="input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder ?? t('Search…', 'খুঁজুন…')} /></div>;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return <div className="segmented" role="tablist">{options.map(o => <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return <div className="tabs" role="tablist">{options.map(o => <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

// ───── Period selector ─────
export interface Range { from: string; to: string }
export const thisMonth = (): Range => ({ from: monthStart(), to: monthEnd() });

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const t = useT();
  const now = new Date();
  const presets: { key: string; label: string; r: () => Range }[] = [
    { key: 'm', label: t('This month', 'এই মাস'), r: thisMonth },
    { key: 'lm', label: t('Last month', 'গত মাস'), r: () => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { from: monthStart(d), to: monthEnd(d) }; } },
    { key: 'q', label: t('Last 90 days', 'গত ৯০ দিন'), r: () => ({ from: ymd(new Date(Date.now() - 89 * 86400000)), to: ymd() }) },
    { key: 'y', label: t('This year', 'এই বছর'), r: () => ({ from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` }) },
    { key: 'fy', label: t('Fiscal year (Jul–Jun)', 'অর্থবছর (জুল–জুন)'), r: () => { const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1; return { from: `${y}-07-01`, to: `${y + 1}-06-30` }; } },
  ];
  const current = presets.find(p => { const r = p.r(); return r.from === value.from && r.to === value.to; })?.key ?? 'custom';
  return (
    <div className="row">
      <select className="select" style={{ width: 'auto' }} value={current} onChange={e => { const p = presets.find(x => x.key === e.target.value); if (p) onChange(p.r()); }}>
        {presets.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        <option value="custom">{t('Custom', 'নির্দিষ্ট')}</option>
      </select>
      <input className="input" style={{ width: 150 }} type="date" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })} aria-label={t('From', 'থেকে')} />
      <span className="muted">–</span>
      <input className="input" style={{ width: 150 }} type="date" value={value.to} onChange={e => onChange({ ...value, to: e.target.value })} aria-label={t('To', 'পর্যন্ত')} />
    </div>
  );
}

// ───── Overlays ─────
export function Drawer({ title, subtitle, onClose, children, footer, narrow }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; narrow?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`drawer ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="overlay center" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Asks for a reason, then calls `onConfirm(reason)`. Used for every void action. */
export function VoidDialog({ what, onClose, onConfirm, busy }: { what: string; onClose: () => void; onConfirm: (reason: string) => void; busy?: boolean }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <Dialog title={t(`Void ${what}`, `${what} বাতিল`)} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল করুন')}</button>
      <button className="btn danger" disabled={reason.trim().length < 3 || busy} onClick={() => onConfirm(reason.trim())}>{t('Void', 'বাতিল')}</button>
    </>}>
      <Alert tone="warn">{t('Voiding keeps the record for audit and posts a reversing entry. Stock and balances are restored.', 'বাতিল করলে রেকর্ডটি অডিটের জন্য থাকবে এবং বিপরীত এন্ট্রি হবে। মজুদ ও স্থিতি আগের অবস্থায় ফিরবে।')}</Alert>
      <Field label={t('Reason', 'কারণ')}><textarea className="textarea" autoFocus value={reason} onChange={e => setReason(e.target.value)} /></Field>
    </Dialog>
  );
}

// ───── Data table ─────
export interface Column<T> { key: string; label: string; render: (row: T) => ReactNode; num?: boolean; className?: string; hideSm?: boolean }

export function DataTable<T extends { id: string; status?: string }>({ rows, columns, onRow, empty, footer, page, pageSize, total, onPage }: {
  rows: T[] | undefined; columns: Column<T>[]; onRow?: (r: T) => void; empty?: ReactNode; footer?: ReactNode;
  page?: number; pageSize?: number; total?: number; onPage?: (p: number) => void;
}) {
  const t = useT();
  if (!rows) return <Loading />;
  if (!rows.length) return <Empty>{empty ?? t('Nothing recorded for this period yet.', 'এই সময়ে এখনো কিছু লেখা হয়নি।')}</Empty>;
  const pages = total && pageSize ? Math.ceil(total / pageSize) : 1;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>{columns.map(c => <th key={c.key} className={`${c.num ? 'num' : ''} ${c.hideSm ? 'hide-sm' : ''}`}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={`${onRow ? 'clickable' : ''} ${r.status === 'VOID' ? 'void' : ''}`} onClick={() => onRow?.(r)}>
                {columns.map(c => <td key={c.key} className={`${c.num ? 'num' : ''} ${c.className ?? ''} ${c.hideSm ? 'hide-sm' : ''}`}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {pages > 1 && onPage && page && (
        <div className="pager">
          <span>{t(`Page ${page} of ${pages} · ${total} records`, `পৃষ্ঠা ${page} / ${pages} · ${total}টি রেকর্ড`)}</span>
          <div className="row">
            <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('Previous', 'আগের')}</button>
            <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('Next', 'পরের')}</button>
          </div>
        </div>
      )}
    </>
  );
}

export { iso10 };
