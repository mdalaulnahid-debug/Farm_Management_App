// Today's routine at a glance: morning eggs, then sales and money collected, feed, medicine and spending, each
// ticking green when done (by anyone on the farm), so the books stay up to date every day. "None today" answers
// count, so a quiet day can still be finished.
import { Check, Circle } from 'lucide-react';
import { api } from '../lib/api';
import { ymd } from '../lib/format';
import { useApi } from '../lib/hooks';
import { usePrefs } from '../lib/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useFarmLists, type Flow } from './shared';

interface Item { key: string; label: string; done: boolean; flow: Flow; none?: 'feed' | 'medicine' | 'expenses' | 'sales' }

export function TodayChecklist({ onOpen }: { onOpen: (f: Flow) => void }) {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const date = ymd();
  const L = useFarmLists();
  const range = { from: date, to: date };
  const logs = useApi<{ data: { flockId: string; eggsCollected: number; feedQty: number }[] }>('/production', { ...range, status: 'POSTED', pageSize: 200 });
  const moves = useApi<{ data: { type: string; voided: boolean; item: { name: string }; itemId: string }[] }>('/stock-moves', { ...range, type: 'CONSUMPTION', pageSize: 200 });
  const bills = useApi<{ data: { status: string }[] }>('/bills', { ...range, pageSize: 50 });
  const sales = useApi<{ data: { status: string }[] }>('/invoices', { ...range, pageSize: 50 });
  // Money collected from customers counts (receipts against what they owe); owner capital or loans do not.
  const received = useApi<{ data: { status: string; partyId: string | null; party?: { kind?: string } | null; allocations?: unknown[] }[] }>('/payments', { ...range, direction: 'IN', pageSize: 50 });
  const mine = useApi<{ none?: string[] }>('/me/today');
  if (!L.flocks.length || logs.isLoading) return null;

  const none = new Set(mine.data?.none ?? []);
  const sum = (id: string, f: (l: { eggsCollected: number; feedQty: number }) => number) => (logs.data?.data ?? []).filter(l => l.flockId === id).reduce((a, l) => a + Number(f(l)), 0);
  const items: Item[] = [
    { key: 'eggs', label: t('Morning eggs', 'সকালের ডিম'), flow: 'eggs', done: L.flocks.every(f => sum(f.id, l => l.eggsCollected) > 0) },
    { key: 'sales', label: t('Sales & money collected', 'বিক্রি ও টাকা আদায়'), flow: 'sale', none: 'sales', done: none.has('sales') || (sales.data?.data ?? []).some(r => r.status !== 'VOID') || (received.data?.data ?? []).some(r => r.status !== 'VOID' && !!r.partyId) },
    { key: 'feed', label: t('Feed used', 'খাদ্য ব্যবহার'), flow: 'evening', none: 'feed', done: none.has('feed') || L.flocks.every(f => sum(f.id, l => l.feedQty) > 0) },
    { key: 'medicine', label: t('Medicine used', 'ওষুধ ব্যবহার'), flow: 'evening', none: 'medicine', done: none.has('medicine') || (moves.data?.data ?? []).some(m => !m.voided && L.medicineIds.has(m.itemId)) },
    { key: 'expenses', label: t('Spending (with vouchers)', 'খরচ (ভাউচারসহ)'), flow: 'bought', none: 'expenses', done: none.has('expenses') || (bills.data?.data ?? []).some(b => b.status !== 'VOID') },
  ];
  const left = items.filter(i => !i.done).length;
  const markNone = async (what: string) => { await api.post('/me/today/none', { what }).catch(() => undefined); qc.invalidateQueries({ queryKey: ['/me/today'] }); };

  return (
    <section className="card easy-today">
      <div className="card-head"><div><h2>{t('Today', 'আজ')}</h2><p>{left ? t(`${left} left to record`, `আরো ${left}টি লেখা বাকি`) : t('All done for today. Thank you!', 'আজকের সব লেখা শেষ। ধন্যবাদ!')}</p></div></div>
      <ul className="checklist">
        {items.map(i => (
          <li key={i.key} className={i.done ? 'done' : ''}>
            <span className="check-mark" aria-hidden="true">{i.done ? <Check size={18} /> : <Circle size={18} />}</span>
            <span className="check-label">{i.label}<span className="sr-only">{i.done ? t(' — done', ' — হয়েছে') : t(' — not done yet', ' — এখনো হয়নি')}</span></span>
            {!i.done && <span className="check-actions">
              {i.none && mine.data && <button type="button" className="btn sm" onClick={() => markNone(i.none!)}>{t('None today', 'আজ নেই')}</button>}
              <button type="button" className="btn sm primary" onClick={() => onOpen(i.flow)}>{t('Record', 'লিখুন')}</button>
            </span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
