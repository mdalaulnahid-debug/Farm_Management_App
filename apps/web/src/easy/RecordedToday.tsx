// "What I recorded today": this person's own entries since midnight. A wrong one can be cancelled the same day
// and entered again (the server allows data-entry staff to cancel only their own entries of today).
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Dialog, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { useApi } from '../lib/hooks';
import { usePrefs } from '../lib/i18n';
import type { Flow } from './shared';

interface Entry { kind: 'production' | 'invoice' | 'receipt' | 'bill' | 'payment' | 'adjustment'; id: string; summary: string; amount?: number; createdAt: string; canFix: boolean }
const VOID_PATH: Record<Entry['kind'], string> = {
  production: '/production', invoice: '/invoices', receipt: '/payments', bill: '/bills', payment: '/payments', adjustment: '/stock-adjustments',
};
const FLOW: Record<Entry['kind'], Flow> = { production: 'eggs', invoice: 'sale', receipt: 'sale', bill: 'bought', payment: 'bought', adjustment: 'evening' };

export function RecordedToday({ onReenter }: { onReenter: (f: Flow) => void }) {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useApi<{ entries: Entry[] }>('/me/today');
  const [fixing, setFixing] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isError || !q.data) return null; // an older server without this list: show nothing
  const kindLabel = (k: Entry['kind']) => ({
    production: t('Production', 'উৎপাদন'), invoice: t('Sale', 'বিক্রি'), receipt: t('Money received', 'টাকা আদায়'),
    bill: t('Purchase', 'কেনা'), payment: t('Payment', 'পরিশোধ'), adjustment: t('Stock used', 'মজুদ ব্যবহার'),
  })[k];
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { hour: 'numeric', minute: '2-digit' });

  const cancel = async (e: Entry) => {
    setBusy(true);
    try {
      await api.post(`${VOID_PATH[e.kind]}/${e.id}/void`, { reason: 'Fixed the same day by the person who entered it' });
      qc.invalidateQueries();
      toast(t('Entry cancelled. Enter it again with the right numbers.', 'লেখাটি বাতিল হয়েছে। সঠিক সংখ্যা দিয়ে আবার লিখুন।'));
      setFixing(null);
      onReenter(e.kind === 'production' && /feed|died/.test(e.summary) && !/eggs/.test(e.summary) ? 'evening' : FLOW[e.kind]);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setBusy(false); }
  };

  return (
    <section className="card easy-recorded">
      <div className="card-head"><div><h2>{t('What I recorded today', 'আজ যা লিখেছি')}</h2><p>{t('You can fix a mistake until midnight.', 'মধ্যরাত পর্যন্ত ভুল ঠিক করতে পারবেন।')}</p></div></div>
      {!q.data.entries.length
        ? <p className="easy-empty">{t('Nothing yet today.', 'আজ এখনো কিছু লেখা হয়নি।')}</p>
        : <ul className="recorded">
          {q.data.entries.map(e => (
            <li key={`${e.kind}-${e.id}`}>
              <span className="recorded-time">{time(e.createdAt)}</span>
              <span className="recorded-what"><b>{kindLabel(e.kind)}</b><small>{e.summary}</small></span>
              {e.amount !== undefined && <span className="recorded-amount">{fmtMoney(e.amount, lang)}</span>}
              {e.canFix && <button type="button" className="btn sm" onClick={() => setFixing(e)}><RotateCcw size={14} />{t('Fix', 'ঠিক করুন')}</button>}
            </li>
          ))}
        </ul>}
      {fixing && (
        <Dialog title={t('Fix this entry?', 'এই লেখাটি ঠিক করবেন?')} onClose={() => setFixing(null)} footer={<>
          <button className="btn" onClick={() => setFixing(null)}>{t('Keep it', 'রেখে দিন')}</button>
          <button className="btn danger" disabled={busy} onClick={() => cancel(fixing)}>{t('Cancel it and enter again', 'বাতিল করে আবার লিখুন')}</button>
        </>}>
          <p>{t(`“${kindLabel(fixing.kind)}: ${fixing.summary}” will be cancelled (it stays in the history), and you can enter it again with the right numbers.`, `“${kindLabel(fixing.kind)}: ${fixing.summary}” বাতিল হবে (ইতিহাসে থাকবে), তারপর সঠিক সংখ্যা দিয়ে আবার লিখতে পারবেন।`)}</p>
        </Dialog>
      )}
    </section>
  );
}
