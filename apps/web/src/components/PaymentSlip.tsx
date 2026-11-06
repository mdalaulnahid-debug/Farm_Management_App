// One receipt (money in) or payment voucher (money out), shown and printed on the farm's letterhead (DocPaper):
// who paid or was paid, how, into or out of which account, the amount in figures and words, and which invoices
// or bills it settled. Opened from Cash & bank › Receipts & payments.
import { useState } from 'react';
import { Printer } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { nameOf, usePrefs } from '../lib/i18n';
import { useApi, useSave } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { Drawer, Loading, StatusBadge, VoidDialog } from './ui';
import { methodLabel, Money } from './forms';
import { DocPaper } from './DocPaper';

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under100 = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
const under1000 = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} hundred` : '', under100(n % 100)].filter(Boolean).join(' ');

/** An amount in words the way Bangladeshi receipts write it, with lakh and crore:
 *  1,25,450.50 → "Taka one lakh twenty-five thousand four hundred fifty and fifty paisa only". */
export function takaInWords(amount: number) {
  const whole = Math.floor(Math.abs(amount) + 1e-9);
  const paisa = Math.round((Math.abs(amount) - whole) * 100);
  const parts: string[] = [];
  let n = whole;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${crore >= 1000 ? takaInWords(crore).replace(/^Taka | only$/g, '') : under1000(crore)} crore`);
  if (lakh) parts.push(`${under100(lakh)} lakh`);
  if (thousand) parts.push(`${under100(thousand)} thousand`);
  if (n) parts.push(under1000(n));
  const words = parts.join(' ') || 'zero';
  return `Taka ${words}${paisa ? ` and ${under100(paisa)} paisa` : ''} only`;
}

export function PaymentSlip({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const { can, me } = useAuth();
  const q = useApi<any>(`/payments/${id}`);
  const [voiding, setVoiding] = useState(false);
  const voidIt = useSave<{ reason: string }>('post', `/payments/${id}/void`, t('Payment voided.', 'লেনদেন বাতিল হয়েছে।'));
  const p = q.data;
  const inward = p?.direction === 'IN';
  const amount = Number(p?.amount ?? 0);
  const settled = (p?.allocations ?? []).reduce((a: number, x: any) => a + Number(x.amount), 0);
  const onAccount = Math.round((amount - settled) * 100) / 100;
  const kind = inward ? t('Money receipt', 'টাকা প্রাপ্তির রসিদ') : t('Payment voucher', 'পরিশোধ ভাউচার');
  const qr = p && [me?.organization.name, `${inward ? 'Receipt' : 'Payment'} ${p.number}`, `Date ${String(p.date).slice(0, 10)}`,
    `${inward ? 'Received' : 'Paid'} Tk ${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, p.party?.name, p.status === 'VOID' ? 'VOID' : null].filter(Boolean).join('\n');

  return (
    <Drawer title={p ? `${kind} ${p.number}` : kind} subtitle={p?.party?.name} onClose={onClose}
      footer={p && <>
        <div className="left">{p.status === 'VOID' ? <StatusBadge status="VOID" /> : <StatusBadge status="POSTED" settled />}</div>
        <button className="btn" onClick={() => window.print()}><Printer size={16} />{t('Print', 'প্রিন্ট')}</button>
        {can('banking.manage') && p.status !== 'VOID' && <button className="btn" onClick={() => setVoiding(true)}>{t('Void', 'বাতিল')}</button>}
      </>}>
      {q.isLoading ? <Loading /> : !p ? null : (
        <DocPaper kind={kind} number={p.number}
          status={p.status === 'VOID' ? { label: t('Void', 'বাতিল'), tone: 'void' } : { label: inward ? t('Received', 'গৃহীত') : t('Paid', 'পরিশোধিত'), tone: 'paid' }}
          party={{ label: inward ? t('Received from', 'যার কাছ থেকে') : t('Paid to', 'যাকে'), name: p.party?.name ?? (p.notes || t('Other money', 'অন্যান্য টাকা')), lines: [p.party?.phone, p.party?.address] }}
          meta={[
            [t('Date', 'তারিখ'), fmtDate(p.date, lang)],
            [t('Method', 'মাধ্যম'), methodLabel(t, p.method)],
            ...(p.cashAccount ? [[inward ? t('Into', 'জমা') : t('From', 'থেকে'), nameOf(p.cashAccount, lang)] as [string, string]] : []),
            ...(p.reference ? [[t('Reference', 'রেফারেন্স'), p.reference] as [string, string]] : []),
          ]}
          qr={qr || undefined}
          thanks={inward ? undefined : null} signLabel={inward ? undefined : t('Received by (signature)', 'গ্রহীতার স্বাক্ষর')}>
          <div className="slip-amount">
            <small>{inward ? t('Amount received', 'প্রাপ্ত টাকা') : t('Amount paid', 'পরিশোধিত টাকা')}</small>
            <b><Money v={amount} decimals={2} /></b>
            {lang === 'en' && <span>{takaInWords(amount)}</span>}
          </div>
          {p.allocations.length > 0 && (
            <div className="doc-section">
              <h3>{inward ? t('Against invoices', 'যে চালানের বিপরীতে') : t('Against bills', 'যে বিলের বিপরীতে')}</h3>
              <div className="lines doc">
                <table>
                  <thead><tr><th>{t('Document', 'নথি')}</th><th>{t('Date', 'তারিখ')}</th><th className="num">{t('Document total', 'নথির মোট')}</th><th className="num">{t('Applied', 'প্রয়োগ')}</th></tr></thead>
                  <tbody>{p.allocations.map((a: any) => {
                    const doc = a.invoice ?? a.bill;
                    return <tr key={a.id}><td className="mono">{doc?.number ?? '—'}</td><td>{doc ? fmtDate(doc.date, lang) : '—'}</td><td className="num">{doc ? <Money v={doc.total} /> : '—'}</td><td className="num"><Money v={a.amount} /></td></tr>;
                  })}</tbody>
                </table>
              </div>
            </div>
          )}
          {p.allocations.length > 0 && onAccount > 0.005 && (
            <div className="doc-notes">{inward
              ? t('The rest is kept as an advance on account: ', 'বাকি অংশ অগ্রিম হিসেবে জমা: ')
              : t('The rest is an advance to the supplier: ', 'বাকি অংশ সরবরাহকারীকে অগ্রিম: ')}<b><Money v={onAccount} /></b></div>
          )}
          {p.notes && p.party && <div className="doc-notes">{p.notes}</div>}
        </DocPaper>
      )}
      {voiding && <VoidDialog what={t('payment', 'লেনদেন')} busy={voidIt.isPending} onClose={() => setVoiding(false)}
        onConfirm={reason => voidIt.mutate({ reason }, { onSuccess: () => { setVoiding(false); onClose(); } })} />}
    </Drawer>
  );
}
