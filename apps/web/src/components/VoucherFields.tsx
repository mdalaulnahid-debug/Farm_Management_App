// The voucher part of every spending form (bill, expense, supplier payment, other money out). The owner's rule:
// nothing is spent without the real voucher, and the voucher must match the entry. Staff take a photo of the paper,
// then type its number, date and amount as written; the photo stays beside the fields while they type, and the
// form only saves when the amount equals the entry.
import { useRef } from 'react';
import { Camera, CheckCircle2, X, XCircle } from 'lucide-react';
import { usePrefs } from '../lib/i18n';
import { fmtMoney, ymd } from '../lib/format';
import { Field, Input, useToast } from './ui';
import { shrinkPhoto } from './SlipPhotos';

export interface VoucherValue { number: string; date: string; amount: string; photos: string[] }
export const emptyVoucher = (): VoucherValue => ({ number: '', date: ymd(), amount: '', photos: [] });
const round2 = (v: number) => Math.round(v * 100) / 100;

/** True when the voucher has a photo and its amount equals the entry (paisa rounding allowed). */
export const voucherOk = (v: VoucherValue, total: number) => v.photos.length > 0 && !!v.date && v.amount.trim() !== '' && Math.abs(round2(Number(v.amount)) - round2(total)) <= 0.011;
/** What the API expects with the record. */
export const voucherPayload = (v: VoucherValue) => ({ number: v.number.trim() || null, date: v.date, amount: round2(Number(v.amount)), photos: v.photos });

export function VoucherFields({ value, onChange, total }: { value: VoucherValue; onChange: (v: VoucherValue) => void; total: number }) {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const set = (p: Partial<VoucherValue>) => onChange({ ...value, ...p });
  const typed = value.amount.trim() !== '';
  const matches = typed && Math.abs(round2(Number(value.amount)) - round2(total)) <= 0.011;
  return (
    <section className="voucher-box">
      <h3>{t('Voucher (required)', 'ভাউচার (আবশ্যক)')}</h3>
      <p className="muted small">{t('Spending is saved only with a photo of the real voucher, and its amount must match this entry.', 'আসল ভাউচারের ছবি ছাড়া খরচ লেখা যাবে না, আর ভাউচারের টাকা এই হিসাবের সাথে মিলতে হবে।')}</p>
      <div className="voucher-grid">
        <div className="voucher-photos">
          {value.photos.map((p, i) => (
            <div key={i} className="voucher-photo">
              <a href={p} target="_blank" rel="noreferrer"><img src={p} alt={t('Voucher photo', 'ভাউচারের ছবি')} /></a>
              <button type="button" className="slip-remove" onClick={() => set({ photos: value.photos.filter((_, j) => j !== i) })} aria-label={t('Remove photo', 'ছবি সরান')}><X size={14} /></button>
            </div>
          ))}
          {value.photos.length < 3 && (
            <button type="button" className={`voucher-add${value.photos.length ? ' small' : ''}`} onClick={() => input.current?.click()}>
              <Camera size={value.photos.length ? 18 : 28} />
              <span>{value.photos.length ? t('Add another page', 'আরেক পাতা') : t('Take or choose the voucher photo', 'ভাউচারের ছবি তুলুন বা বাছুন')}</span>
            </button>
          )}
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={async e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try { const d = await shrinkPhoto(f); onChange({ ...value, photos: [...value.photos, d] }); }
            catch { toast(t('That file could not be read as a photo.', 'ফাইলটি ছবি হিসেবে পড়া গেল না।'), 'error'); }
          }} />
        </div>
        <div className="voucher-fields">
          <Field label={t('Voucher no. (if written)', 'ভাউচার নং (লেখা থাকলে)')}><Input value={value.number} onChange={e => set({ number: e.target.value })} /></Field>
          <Field label={t('Date on the voucher', 'ভাউচারের তারিখ')}><Input type="date" value={value.date} onChange={e => set({ date: e.target.value })} /></Field>
          <Field label={t('Amount on the voucher', 'ভাউচারের টাকা')}
            error={typed && !matches ? t(`Voucher ${fmtMoney(Number(value.amount), lang)} ≠ entry ${fmtMoney(total, lang)}. Check the paper and the entry.`, `ভাউচার ${fmtMoney(Number(value.amount), lang)} ≠ হিসাব ${fmtMoney(total, lang)}। কাগজ ও হিসাব মিলিয়ে দেখুন।`) : undefined}>
            <Input type="number" inputMode="decimal" min="0" value={value.amount} onChange={e => set({ amount: e.target.value })} />
          </Field>
          {typed && <div className={`voucher-match ${matches ? 'ok' : 'bad'}`}>{matches ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {matches ? t('Voucher matches the entry', 'ভাউচার হিসাবের সাথে মিলেছে') : t('Does not match yet', 'এখনো মেলেনি')}</div>}
        </div>
      </div>
    </section>
  );
}
