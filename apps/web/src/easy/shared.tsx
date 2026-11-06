// What the easy flows share: the farm's lists (active flocks, items, cash accounts), a "save" helper that turns
// server refusals into plain words, and the pictures used on buttons and steps.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banknote, Bird, Egg, HandCoins, Package, Pill, ShoppingBasket, Smartphone, Wheat, type LucideIcon } from 'lucide-react';
import { api, ApiError, type Item } from '../lib/api';
import { useApi, useCashAccounts, useFlocks, useItems } from '../lib/hooks';
import { nameOf, usePrefs, unitLabel } from '../lib/i18n';

export const PICTURES = {
  eggs: Egg, sale: ShoppingBasket, money: HandCoins, bought: Package, deaths: Bird, feed: Wheat, medicine: Pill, cash: Banknote, mobile: Smartphone,
} satisfies Record<string, LucideIcon>;
export const Pic = ({ name, size = 28 }: { name: keyof typeof PICTURES; size?: number }) => { const I = PICTURES[name]; return <I size={size} aria-hidden="true" />; };

export type Flow = 'eggs' | 'sale' | 'bought' | 'evening';

export function useFarmLists() {
  const flocks = useFlocks();
  const items = useItems();
  const cash = useCashAccounts();
  const active = (flocks.data?.data ?? []).filter(f => f.status === 'ACTIVE');
  const list = (items.data?.data ?? []).filter(i => i.active);
  const cashAccounts = cash.data?.data ?? [];
  // "Cash" is the first cash account; "bKash / Nagad" the mobile-banking one if there is one, else the first bank account.
  const cashId = cashAccounts.find(a => a.subtype === 'CASH')?.id ?? cashAccounts[0]?.id;
  const mobileId = cashAccounts.find(a => /mobile|bkash|nagad/i.test(a.name))?.id ?? cashAccounts.find(a => a.subtype === 'BANK')?.id ?? cashId;
  return {
    loading: flocks.isLoading || items.isLoading || cash.isLoading,
    flocks: active,
    produce: list.filter(i => i.category === 'PRODUCE' || i.category === 'LIVESTOCK'),
    // Only what is in the store can be used from it.
    feed: list.filter(i => i.category === 'FEED' && i.trackInventory && Number(i.qtyOnHand) > 0),
    medicine: list.filter(i => i.category === 'MEDICINE' && i.trackInventory && Number(i.qtyOnHand) > 0),
    medicineIds: new Set(list.filter(i => i.category === 'MEDICINE').map(i => i.id)),
    buyable: list.filter(i => ['FEED', 'MEDICINE', 'SUPPLY', 'LIVESTOCK'].includes(i.category)),
    cashId, mobileId,
  };
}

/** Entries already made today for a flock (to say "adds to the 420 eggs recorded this morning"). */
export function useTodayProduction(date: string) {
  return useApi<{ data: { flockId: string; eggsCollected: number; status: string }[] }>('/production', { from: date, to: date, status: 'POSTED', pageSize: 100 });
}

export function useItemLabel() {
  const { t, lang } = usePrefs();
  return (i: Item | undefined, qty?: number) => (i ? `${qty !== undefined ? `${qty} ` : ''}${qty !== undefined ? unitLabel(t, i.unit) + ' ' : ''}${nameOf(i, lang)}` : '');
}

/** Runs the save calls in order; a refusal from the server becomes a plain message instead of a crash. */
export function useEasySave(onDone: () => void) {
  const qc = useQueryClient();
  const { t } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (calls: (() => Promise<unknown>)[]) => {
    setBusy(true); setError(null);
    try {
      for (const c of calls) await c();
      qc.invalidateQueries();
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /already recorded/i.test(e.message)) {
        setError(t('This flock’s day was already recorded, and this server cannot add to it yet. Ask the owner to update FarmLedger, or fix the morning entry under “What I recorded today”.', 'এই ঝাঁকের আজকের হিসাব আগেই লেখা হয়েছে, আর এই সার্ভার এখনো তাতে যোগ করতে পারে না। মালিককে ফার্মলেজার হালনাগাদ করতে বলুন, অথবা “আজ যা লিখেছি” থেকে সকালের লেখা ঠিক করুন।'));
      } else setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return { busy, error, run, post: (path: string, body: unknown) => () => api.post(path, body) };
}
