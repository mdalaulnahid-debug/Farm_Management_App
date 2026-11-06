// Vouchers to check (owner / accountant): each spending's voucher photo beside the entry, with the voucher's own
// number, date and amount as staff typed them. "Matches" records who checked and when; "Doesn't match" needs a
// note and flags it for the owner. Checked vouchers' photos are locked.
import { useState } from 'react';
import { CheckCircle2, FileCheck2, XCircle } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { useApi, useSave } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { Badge, Card, Empty, Input, Loading, PageHeader, Segmented } from '../components/ui';
import { Money } from '../components/forms';

type Status = 'UNCHECKED' | 'MISMATCH' | 'MATCHES';
interface Row {
  id: string; ownerType: 'BILL' | 'PAYMENT'; ownerId: string; number: string | null; date: string; amount: number; status: Status; note: string | null; checkedAt: string | null;
  entry: { kind: 'bill' | 'payment'; number: string; date: string; total: number; party: string | null; lines?: { description: string; quantity: number; amount: number }[]; method?: string; reference?: string | null; notes?: string | null };
  photos: string[];
}

export default function VoucherCheck() {
  const { t } = usePrefs();
  const [status, setStatus] = useState<Status>('UNCHECKED');
  const list = useApi<{ data: Row[] }>('/vouchers', { status });
  return (
    <>
      <PageHeader crumb={t('Finance', 'অর্থ')} title={t('Vouchers to check', 'যাচাইয়ের ভাউচার')}
        subtitle={t('Every spending is saved with a photo of its voucher. Look at the paper beside the entry and mark whether they match.', 'প্রতিটি খরচ ভাউচারের ছবিসহ লেখা হয়। হিসাবের পাশে কাগজটি দেখে মিলেছে কি না চিহ্ন দিন।')} />
      <Card title={t('Vouchers', 'ভাউচার')} actions={<Segmented value={status} onChange={setStatus} options={[
        { value: 'UNCHECKED', label: t('To check', 'যাচাই বাকি') },
        { value: 'MISMATCH', label: t('Does not match', 'মেলেনি') },
        { value: 'MATCHES', label: t('Checked', 'যাচাই হয়েছে') },
      ]} />}>
        {!list.data ? <Loading /> : !list.data.data.length
          ? <Empty icon={FileCheck2}>{status === 'UNCHECKED' ? t('Nothing to check. Every voucher has been checked.', 'যাচাইয়ের কিছু নেই। সব ভাউচার যাচাই হয়েছে।') : t('None here.', 'এখানে কিছু নেই।')}</Empty>
          : <div className="vcheck-list">{list.data.data.map(v => <VoucherRow key={v.id} v={v} />)}</div>}
      </Card>
    </>
  );
}

function VoucherRow({ v }: { v: Row }) {
  const { t, lang } = usePrefs();
  const [note, setNote] = useState('');
  const check = useSave<{ result: 'MATCHES' | 'MISMATCH'; note?: string }>('post', `/vouchers/${v.id}/check`, t('Voucher checked.', 'ভাউচার যাচাই হয়েছে।'));
  const kind = v.ownerType === 'BILL' ? 'bills' : 'payments';
  const same = Math.abs(Number(v.amount) - v.entry.total) < 0.011;
  return (
    <article className="vcheck">
      <div className="vcheck-photos">
        {v.photos.map(p => <a key={p} href={`/api/v1/${kind}/${v.ownerId}/attachments/${p}`} target="_blank" rel="noreferrer"><img src={`/api/v1/${kind}/${v.ownerId}/attachments/${p}`} alt={t('Voucher photo', 'ভাউচারের ছবি')} loading="lazy" /></a>)}
      </div>
      <div className="vcheck-body">
        <div className="vcheck-head">
          <b className="mono">{v.entry.number}</b>
          <span>{v.entry.kind === 'bill' ? t('Bill / expense', 'বিল / খরচ') : t('Payment out', 'পরিশোধ')}</span>
          {v.status === 'MATCHES' && <Badge tone="green">{t('Matches', 'মিলেছে')}</Badge>}
          {v.status === 'MISMATCH' && <Badge tone="red">{t('Does not match', 'মেলেনি')}</Badge>}
        </div>
        <dl className="vcheck-compare">
          <dt />
          <dd className="muted small">{t('Entry in FarmLedger', 'FarmLedger-এর হিসাব')}</dd>
          <dd className="muted small">{t('Voucher (as typed)', 'ভাউচার (যেমন লেখা)')}</dd>
          <dt>{t('Date', 'তারিখ')}</dt><dd>{fmtDate(v.entry.date, lang)}</dd><dd>{fmtDate(v.date, lang)}</dd>
          <dt>{t('Amount', 'টাকা')}</dt><dd><b><Money v={v.entry.total} /></b></dd><dd className={same ? 'pos' : 'neg'}><b><Money v={v.amount} /></b></dd>
          <dt>{t('Paid to', 'যাকে')}</dt><dd>{v.entry.party ?? '—'}</dd><dd>{v.number ? t(`No. ${v.number}`, `নং ${v.number}`) : '—'}</dd>
        </dl>
        {v.entry.lines && <ul className="vcheck-lines">{v.entry.lines.map((l, i) => <li key={i}>{l.description} × {l.quantity} = <Money v={l.amount} /></li>)}</ul>}
        {v.entry.notes && <p className="muted small">{v.entry.notes}</p>}
        {v.note && <p className="vcheck-note">{v.note}</p>}
        {v.status !== 'MATCHES' && (
          <div className="vcheck-actions">
            <button className="btn primary" disabled={check.isPending} onClick={() => check.mutate({ result: 'MATCHES' })}><CheckCircle2 size={16} />{t('Matches', 'মিলেছে')}</button>
            <Input placeholder={t('What does not match?', 'কী মেলেনি?')} value={note} onChange={e => setNote(e.target.value)} />
            <button className="btn danger" disabled={check.isPending || !note.trim()} onClick={() => check.mutate({ result: 'MISMATCH', note: note.trim() })}><XCircle size={16} />{t('Doesn’t match', 'মেলেনি')}</button>
          </div>
        )}
      </div>
    </article>
  );
}
