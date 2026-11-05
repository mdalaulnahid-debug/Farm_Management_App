// App UI kit: the shared components come from @farmledger/design-system; the parts here know about
// FarmLedger's records (status names, accounting periods, voiding).
import { useState } from 'react';
import { Alert, Badge, Dialog, Field } from '@farmledger/design-system';
import { useT, statusLabel } from '../lib/i18n';
import { iso10, monthEnd, monthStart, ymd } from '../lib/format';

export * from '@farmledger/design-system';

/** `settled` = a record that has no payment state (payments, journals, production): POSTED reads "Posted". */
export function StatusBadge({ status, settled }: { status: string; settled?: boolean }) {
  const t = useT();
  if (settled && status === 'POSTED') return <Badge tone="green">{t('Posted', 'পোস্ট হয়েছে')}</Badge>;
  const tone = ({ PAID: 'green', PARTIAL: 'amber', POSTED: 'blue', VOID: 'red', ACTIVE: 'green' } as const)[status as 'PAID'];
  return <Badge tone={tone}>{statusLabel(t, status)}</Badge>;
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
      <select className="select w-auto" value={current} onChange={e => { const p = presets.find(x => x.key === e.target.value); if (p) onChange(p.r()); }}>
        {presets.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        <option value="custom">{t('Custom', 'নির্দিষ্ট')}</option>
      </select>
      <input className="input date-range" type="date" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })} aria-label={t('From', 'থেকে')} />
      <span className="muted">–</span>
      <input className="input date-range" type="date" value={value.to} onChange={e => onChange({ ...value, to: e.target.value })} aria-label={t('To', 'পর্যন্ত')} />
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
      <button className="btn danger" disabled={reason.trim().length < 10 || busy} onClick={() => onConfirm(reason.trim())}>{t('Void', 'বাতিল')}</button>
    </>}>
      <Alert tone="warn">{t('Voiding keeps the record for audit and posts a reversing entry. Stock and balances are restored.', 'বাতিল করলে রেকর্ডটি অডিটের জন্য থাকবে এবং বিপরীত এন্ট্রি হবে। মজুদ ও স্থিতি আগের অবস্থায় ফিরবে।')}</Alert>
      <Field label={t('Reason', 'কারণ')} hint={t('Say clearly why (at least 10 characters). The owner sees every void.', 'কেন তা পরিষ্কার লিখুন (কমপক্ষে ১০ অক্ষর)। মালিক প্রতিটি বাতিল দেখেন।')}><textarea className="textarea" autoFocus value={reason} onChange={e => setReason(e.target.value)} /></Field>
    </Dialog>
  );
}

export { iso10 };
