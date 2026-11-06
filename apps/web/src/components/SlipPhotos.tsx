// Photos of handwritten vouchers and receipt slips, kept with a payment or bill as proof. On a phone the
// button opens the camera. Photos are shrunk on the phone first (longest side 1600 px, JPEG), so they upload
// quickly on mobile data and stay small in the database and its backups.
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { usePrefs } from '../lib/i18n';
import { useToast } from './ui';

export type SlipKind = 'payments' | 'bills';
export interface SlipPhoto { id: string; mime: string; size: number; createdAt: string }

/** Read a picked image and return it as a JPEG data URL no larger than `max` px on its longest side. */
export async function shrinkPhoto(file: File, max = 1600, quality = 0.82): Promise<string> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(src); }
}

export const uploadSlip = (kind: SlipKind, id: string, dataUrl: string) => api.post(`/${kind}/${id}/attachments`, { dataUrl });
const photoUrl = (kind: SlipKind, id: string, aid: string) => `/api/v1/${kind}/${id}/attachments/${aid}`;

/** The camera button and its hidden file input. */
function PickButton({ onPicked, busy, label }: { onPicked: (dataUrl: string) => void; busy?: boolean; label: string }) {
  const { t } = usePrefs();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}><Camera size={16} />{label}</button>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={async e => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try { onPicked(await shrinkPhoto(f)); } catch { toast(t('That file could not be read as a photo.', 'ফাইলটি ছবি হিসেবে পড়া গেল না।'), 'error'); }
      }} />
    </>
  );
}

/** For a new payment or bill: one photo picked before saving, uploaded right after the record is saved. */
export function SlipPhotoPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { t } = usePrefs();
  return (
    <div className="field full">
      <span>{t('Photo of the handwritten slip (optional)', 'হাতে লেখা স্লিপের ছবি (ঐচ্ছিক)')}</span>
      <div className="slip-photos">
        {value && <div className="slip-thumb"><img src={value} alt={t('Slip photo', 'স্লিপের ছবি')} /><button type="button" className="slip-remove" onClick={() => onChange(null)} aria-label={t('Remove photo', 'ছবি সরান')}><X size={14} /></button></div>}
        {!value && <PickButton onPicked={onChange} label={t('Take or choose photo', 'ছবি তুলুন বা বাছুন')} />}
      </div>
      <small>{t('Kept with the record as proof. Staff still type the amount.', 'প্রমাণ হিসেবে রেকর্ডের সাথে থাকবে। টাকার পরিমাণ হাতে লিখতে হবে।')}</small>
    </div>
  );
}

/** Upload the picked photo after saving; a failed upload is reported but never undoes the saved record. */
export function useAttachAfterSave() {
  const { t } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  return (kind: SlipKind, id: string | undefined, dataUrl: string | null) => {
    if (!id || !dataUrl) return;
    uploadSlip(kind, id, dataUrl).then(() => qc.invalidateQueries(), () => toast(t('Saved, but the photo did not upload. Open the record and add it again.', 'সংরক্ষিত হয়েছে, কিন্তু ছবি আপলোড হয়নি। রেকর্ড খুলে আবার যোগ করুন।'), 'error'));
  };
}

/** On a saved payment or bill: its photos, a button to add more, and (with void rights) to remove a wrong one. */
export function SlipPhotos({ kind, id, photos, canRemove }: { kind: SlipKind; id: string; photos: SlipPhoto[]; canRemove?: boolean }) {
  const { t } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await job(); await qc.invalidateQueries(); toast(done); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <section className="slip-box no-print">
      <h3>{t('Slip photos', 'স্লিপের ছবি')}</h3>
      <div className="slip-photos">
        {photos.map(p => (
          <div key={p.id} className="slip-thumb">
            <a href={photoUrl(kind, id, p.id)} target="_blank" rel="noreferrer"><img src={photoUrl(kind, id, p.id)} alt={t('Slip photo', 'স্লিপের ছবি')} loading="lazy" /></a>
            {canRemove && <button type="button" className="slip-remove" disabled={busy} aria-label={t('Remove photo', 'ছবি সরান')}
              onClick={() => { if (window.confirm(t('Remove this photo? This is noted in the activity log.', 'ছবিটি সরাবেন? এটি কার্যক্রম লগে লেখা থাকবে।'))) run(() => api.del(`/${kind}/${id}/attachments/${p.id}`), t('Photo removed.', 'ছবি সরানো হয়েছে।')); }}><Trash2 size={14} /></button>}
          </div>
        ))}
        <PickButton busy={busy} onPicked={d => run(() => uploadSlip(kind, id, d), t('Photo added.', 'ছবি যোগ হয়েছে।'))} label={photos.length ? t('Add another photo', 'আরেকটি ছবি') : t('Add photo of slip', 'স্লিপের ছবি যোগ করুন')} />
      </div>
      {!photos.length && <small className="muted">{t('No photo yet. Add the handwritten voucher or receipt as proof.', 'এখনো ছবি নেই। প্রমাণ হিসেবে হাতে লেখা ভাউচার বা রসিদের ছবি দিন।')}</small>}
    </section>
  );
}
