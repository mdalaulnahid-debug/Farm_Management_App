// One line under a bill or payment: its voucher as staff typed it, and whether the owner/accountant checked it.
import { usePrefs } from '../lib/i18n';
import { fmtDate } from '../lib/format';
import { Badge } from './ui';
import { Money } from './forms';

export interface VoucherInfo { number: string | null; date: string; amount: number | string; status: 'UNCHECKED' | 'MATCHES' | 'MISMATCH'; note: string | null; checkedAt: string | null }

export function VoucherStatus({ v }: { v?: VoucherInfo | null }) {
  const { t, lang } = usePrefs();
  if (!v) return null;
  return (
    <div className="voucher-status no-print">
      <span className="muted">{t('Voucher', 'ভাউচার')}{v.number ? ` ${v.number}` : ''} · {fmtDate(v.date, lang)} · <Money v={Number(v.amount)} /></span>
      {v.status === 'MATCHES' && <Badge tone="green">{t('Checked: matches', 'যাচাই: মিলেছে')}</Badge>}
      {v.status === 'MISMATCH' && <Badge tone="red">{t('Checked: does not match', 'যাচাই: মেলেনি')}</Badge>}
      {v.status === 'UNCHECKED' && <Badge tone="amber">{t('Not checked yet', 'এখনো যাচাই হয়নি')}</Badge>}
      {v.note && <span className="neg small">{v.note}</span>}
    </div>
  );
}
