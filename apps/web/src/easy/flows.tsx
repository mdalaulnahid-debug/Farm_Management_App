// The four everyday jobs as step-by-step forms. Each posts to the same endpoints as the full forms
// (components/forms.tsx), so the books are exactly the same whichever way something was entered.
import { ChoiceButtons, Empty, Input, Loading, NumberPad, Wizard, type WizardStep } from '../components/ui';
import { api } from '../lib/api';
import { fmtMoney, ymd } from '../lib/format';
import { useParties } from '../lib/hooks';
import { nameOf, unitLabel, usePrefs } from '../lib/i18n';
import { Pic, useEasySave, useFarmLists, useItemLabel, useTodayProduction } from './shared';

const n = (v: string) => Number(v || 0);
const NoFlock = () => {
  const { t } = usePrefs();
  return <div className="card"><Empty>{t('There is no active flock yet. Ask the owner to add one in Production.', 'এখনো কোনো সক্রিয় ঝাঁক নেই। মালিককে উৎপাদন অংশে একটি যোগ করতে বলুন।')}</Empty></div>;
};

// ───── Eggs collected (morning) ─────
interface EggsData { flockId: string; eggs: string; broken: string; died: string }
export function EggsFlow({ onClose }: { onClose: () => void }) {
  const { t, lang } = usePrefs();
  const L = useFarmLists();
  const date = ymd();
  const today = useTodayProduction(date);
  const save = useEasySave(onClose);
  if (L.loading) return <Loading />;
  if (!L.flocks.length) return <NoFlock />;
  const flockName = (id: string) => L.flocks.find(f => f.id === id)?.name ?? '';
  const already = (id: string) => (today.data?.data ?? []).filter(l => l.flockId === id).reduce((a, l) => a + l.eggsCollected, 0);
  const steps: WizardStep<EggsData>[] = [
    {
      key: 'flock', title: t('Which flock?', 'কোন ঝাঁক?'), picture: <Pic name="deaths" />, skip: () => L.flocks.length === 1, valid: d => !!d.flockId,
      help: t('Choose the flock (group of ducks) these eggs came from.', 'যে ঝাঁক (হাঁসের দল) থেকে ডিম এসেছে সেটি বেছে নিন।'),
      render: (d, set, next) => <ChoiceButtons value={d.flockId} onChange={v => set({ flockId: v })} onPick={next} options={L.flocks.map(f => ({ value: f.id, label: f.name, sub: t(`${f.currentCount} birds`, `${f.currentCount}টি পাখি`), picture: <Pic name="deaths" /> }))} />,
    },
    {
      key: 'eggs', title: t('How many eggs did you collect?', 'কতগুলো ডিম সংগ্রহ করলেন?'), picture: <Pic name="eggs" />, valid: d => n(d.eggs) > 0,
      help: t('Count every egg picked up, including cracked or broken ones. You will enter the broken ones next.', 'যত ডিম তুলেছেন সব গুনুন, ফাটা বা ভাঙাও। ভাঙাগুলো পরের ধাপে লিখবেন।'),
      render: (d, set) => <NumberPad label={t('Eggs collected', 'সংগৃহীত ডিম')} unit={t('eggs', 'টি ডিম')} value={d.eggs} onChange={v => set({ eggs: v })} />,
    },
    {
      key: 'broken', title: t('How many were broken?', 'কতগুলো ভাঙা ছিল?'), picture: <Pic name="eggs" />, valid: d => n(d.broken) <= n(d.eggs),
      help: t('Broken or cracked eggs that cannot be sold. Leave 0 if none.', 'যে ভাঙা বা ফাটা ডিম বিক্রি করা যাবে না। না থাকলে ০ রাখুন।'),
      render: (d, set) => <NumberPad label={t('Broken eggs', 'ভাঙা ডিম')} unit={t('eggs', 'টি ডিম')} value={d.broken} onChange={v => set({ broken: v })} />,
    },
    {
      key: 'died', title: t('Did any ducks die?', 'কোনো হাঁস কি মারা গেছে?'), picture: <Pic name="deaths" />,
      help: t('Number of ducks found dead since the last count. Leave 0 if none.', 'শেষ গোনার পর কতগুলো হাঁস মৃত পাওয়া গেছে। না থাকলে ০ রাখুন।'),
      render: (d, set) => <NumberPad label={t('Ducks died', 'মৃত হাঁস')} unit={t('ducks', 'টি হাঁস')} value={d.died} onChange={v => set({ died: v })} />,
    },
  ];
  return (
    <Wizard<EggsData> title={t('Eggs collected', 'ডিম সংগ্রহ')} steps={steps} initial={{ flockId: L.flocks.length === 1 ? L.flocks[0].id : '', eggs: '', broken: '0', died: '0' }}
      busy={save.busy} error={save.error} onCancel={onClose}
      sentence={d => <>
        {t(`You collected ${d.eggs} eggs from ${flockName(d.flockId)} today`, `আজ ${flockName(d.flockId)} থেকে ${d.eggs}টি ডিম সংগ্রহ করেছেন`)}
        {n(d.broken) > 0 && t(`, ${d.broken} broken`, `, ${d.broken}টি ভাঙা`)}
        {n(d.died) > 0 && t(`, and ${d.died} ducks died`, `, আর ${d.died}টি হাঁস মারা গেছে`)}.
        {already(d.flockId) > 0 && <small className="wizard-note">{t(`This adds to the ${already(d.flockId)} eggs already recorded today.`, `আজ আগে লেখা ${already(d.flockId)}টি ডিমের সাথে যোগ হবে।`)}</small>}
      </>}
      onSave={d => save.run([save.post('/production', { date, flockId: d.flockId, eggsCollected: n(d.eggs), eggsBroken: n(d.broken), mortality: n(d.died), addToDay: true })])}
      key={lang}
    />
  );
}

// ───── Deaths, feed and medicine (evening) ─────
interface EveningData { flockId: string; died: string; feedId: string; feedQty: string; medId: string; medQty: string }
export function EveningFlow({ onClose }: { onClose: () => void }) {
  const { t, lang } = usePrefs();
  const L = useFarmLists();
  const label = useItemLabel();
  const date = ymd();
  const save = useEasySave(onClose);
  if (L.loading) return <Loading />;
  if (!L.flocks.length) return <NoFlock />;
  const NONE = 'none';
  const flockName = (id: string) => L.flocks.find(f => f.id === id)?.name ?? '';
  const feed = (id: string) => L.feed.find(i => i.id === id);
  const med = (id: string) => L.medicine.find(i => i.id === id);
  const steps: WizardStep<EveningData>[] = [
    {
      key: 'flock', title: t('Which flock?', 'কোন ঝাঁক?'), picture: <Pic name="deaths" />, skip: () => L.flocks.length === 1, valid: d => !!d.flockId,
      help: t('Choose the flock this evening’s entry is for.', 'সন্ধ্যার এই হিসাব কোন ঝাঁকের, বেছে নিন।'),
      render: (d, set, next) => <ChoiceButtons value={d.flockId} onChange={v => set({ flockId: v })} onPick={next} options={L.flocks.map(f => ({ value: f.id, label: f.name, picture: <Pic name="deaths" /> }))} />,
    },
    {
      key: 'died', title: t('Did any more ducks die today?', 'আজ আর কোনো হাঁস কি মারা গেছে?'), picture: <Pic name="deaths" />,
      help: t('Only ducks not already counted this morning. Leave 0 if none.', 'শুধু সকালে না গোনা হাঁস। না থাকলে ০ রাখুন।'),
      render: (d, set) => <NumberPad label={t('Ducks died', 'মৃত হাঁস')} unit={t('ducks', 'টি হাঁস')} value={d.died} onChange={v => set({ died: v })} />,
    },
    {
      key: 'feed', title: t('Which feed did you give?', 'কোন খাদ্য দিয়েছেন?'), picture: <Pic name="feed" />, valid: d => !!d.feedId,
      help: t('Choose the feed taken from the store for this flock today, or “None today”.', 'আজ এই ঝাঁকের জন্য গুদাম থেকে নেওয়া খাদ্য বেছে নিন, অথবা “আজ নেই”।'),
      render: (d, set, next) => <ChoiceButtons value={d.feedId} onChange={v => set({ feedId: v })} onPick={next}
        options={[...L.feed.map(i => ({ value: i.id, label: nameOf(i, lang), sub: t(`${i.qtyOnHand} ${unitLabel(t, i.unit)} in store`, `গুদামে ${i.qtyOnHand} ${unitLabel(t, i.unit)}`), picture: <Pic name="feed" /> })), { value: NONE, label: t('None today', 'আজ নেই') }]} />,
    },
    {
      key: 'feedQty', title: t('How much feed?', 'কতটুকু খাদ্য?'), picture: <Pic name="feed" />, skip: d => d.feedId === NONE, valid: d => n(d.feedQty) > 0,
      help: t('The amount taken out of the store for this flock today.', 'আজ এই ঝাঁকের জন্য গুদাম থেকে যতটুকু নেওয়া হয়েছে।'),
      render: (d, set) => <NumberPad allowDecimal label={t('Feed used', 'ব্যবহৃত খাদ্য')} unit={feed(d.feedId) ? unitLabel(t, feed(d.feedId)!.unit) : ''} value={d.feedQty} onChange={v => set({ feedQty: v })} />,
    },
    {
      key: 'med', title: t('Any medicine or vaccine used?', 'কোনো ওষুধ বা টিকা দিয়েছেন?'), picture: <Pic name="medicine" />, valid: d => !!d.medId,
      help: t('Choose the medicine given today, or “None today”.', 'আজ দেওয়া ওষুধ বেছে নিন, অথবা “আজ নেই”।'),
      render: (d, set, next) => <ChoiceButtons value={d.medId} onChange={v => set({ medId: v })} onPick={next}
        options={[...L.medicine.map(i => ({ value: i.id, label: nameOf(i, lang), picture: <Pic name="medicine" /> })), { value: NONE, label: t('None today', 'আজ নেই') }]} />,
    },
    {
      key: 'medQty', title: t('How much medicine?', 'কতটুকু ওষুধ?'), picture: <Pic name="medicine" />, skip: d => d.medId === NONE, valid: d => n(d.medQty) > 0,
      help: t('The amount used today, in the unit shown.', 'আজ যতটুকু ব্যবহার হয়েছে, দেখানো এককে।'),
      render: (d, set) => <NumberPad allowDecimal label={t('Medicine used', 'ব্যবহৃত ওষুধ')} unit={med(d.medId) ? unitLabel(t, med(d.medId)!.unit) : ''} value={d.medQty} onChange={v => set({ medQty: v })} />,
    },
  ];
  return (
    <Wizard<EveningData> title={t('Deaths & feed used', 'মৃত্যু ও খাদ্য')} steps={steps} key={lang}
      initial={{ flockId: L.flocks.length === 1 ? L.flocks[0].id : '', died: '0', feedId: '', feedQty: '', medId: '', medQty: '' }}
      busy={save.busy} error={save.error} onCancel={onClose}
      sentence={d => <>
        {t(`For ${flockName(d.flockId)} today: `, `আজ ${flockName(d.flockId)}: `)}
        {[
          n(d.died) > 0 ? t(`${d.died} more ducks died`, `আরো ${d.died}টি হাঁস মারা গেছে`) : t('no more deaths', 'আর কোনো মৃত্যু নেই'),
          d.feedId === NONE ? t('no feed', 'খাদ্য নেই') : t(`${label(feed(d.feedId), n(d.feedQty))} fed`, `${label(feed(d.feedId), n(d.feedQty))} খাওয়ানো হয়েছে`),
          d.medId === NONE ? t('no medicine', 'ওষুধ নেই') : t(`${label(med(d.medId), n(d.medQty))} used`, `${label(med(d.medId), n(d.medQty))} ব্যবহার হয়েছে`),
        ].join(', ')}.
      </>}
      onSave={d => {
        const calls = [];
        if (n(d.died) > 0 || (d.feedId !== NONE && n(d.feedQty) > 0)) {
          calls.push(save.post('/production', { date, flockId: d.flockId, eggsCollected: 0, mortality: n(d.died), feedItemId: d.feedId !== NONE ? d.feedId : null, feedQty: d.feedId !== NONE ? n(d.feedQty) : 0, addToDay: true }));
        }
        if (d.medId !== NONE) calls.push(save.post('/stock-adjustments', { date, itemId: d.medId, type: 'USAGE', quantity: n(d.medQty), notes: `${flockName(d.flockId)}` }));
        // "None today" answers count for the evening reminder; an older server without them is fine.
        for (const what of [d.feedId === NONE && 'feed', d.medId === NONE && 'medicine'].filter(Boolean) as string[]) {
          calls.push(() => save.post('/me/today/none', { what })().catch(() => undefined));
        }
        return save.run(calls);
      }}
    />
  );
}

// ───── Sale & money received ─────
interface SaleData { kind: 'sale' | 'due' | ''; itemId: string; qty: string; price: string; buyer: string; phone: string; how: 'cash' | 'mobile' | 'credit' | 'part' | ''; partyId: string; amount: string; paidNow: string; partHow: 'cash' | 'mobile' | '' }
/** A sale QR sticker (pages/QuickSale) opens this with the item, and optionally the customer, already chosen. */
export interface SalePreset { itemId?: string; customerId?: string; customerName?: string }
export function SaleFlow({ onClose, preset }: { onClose: () => void; preset?: SalePreset }) {
  const { t, lang } = usePrefs();
  const L = useFarmLists();
  const label = useItemLabel();
  const date = ymd();
  const save = useEasySave(onClose);
  if (L.loading) return <Loading />;
  const item = (id: string) => L.produce.find(i => i.id === id);
  const total = (d: SaleData) => Math.round(n(d.qty) * n(d.price) * 100) / 100;
  /** Money still owed must be owed by someone: credit and part-paid need a named buyer. */
  const hasBuyer = (d: SaleData) => !!(preset?.customerId || d.buyer.trim() || d.phone.trim());
  const howOptions = (credit: boolean) => [
    { value: 'cash' as const, label: t('Cash', 'নগদ'), picture: <Pic name="cash" /> },
    { value: 'mobile' as const, label: t('bKash / Nagad', 'বিকাশ / নগদ'), picture: <Pic name="mobile" /> },
    ...(credit ? [
      { value: 'credit' as const, label: t('Not paid yet (on credit)', 'এখনো পরিশোধ হয়নি (বাকি)'), picture: <Pic name="money" /> },
      { value: 'part' as const, label: t('Part paid now, rest later', 'কিছু এখন, বাকি পরে'), picture: <Pic name="money" /> },
    ] : []),
  ];
  const steps: WizardStep<SaleData>[] = [
    {
      key: 'kind', title: t('What happened?', 'কী হয়েছে?'), picture: <Pic name="sale" />, valid: d => !!d.kind, skip: () => !!preset?.itemId,
      help: t('“I sold something” for eggs or ducks sold today. “Money for an old sale” when a buyer pays what they owed.', 'আজ ডিম বা হাঁস বিক্রি হলে “বিক্রি করেছি”। কোনো ক্রেতা আগের বাকি দিলে “আগের বিক্রির টাকা”।'),
      render: (d, set, next) => <ChoiceButtons value={d.kind || undefined} onChange={v => set({ kind: v })} onPick={next} options={[
        { value: 'sale', label: t('I sold something', 'বিক্রি করেছি'), picture: <Pic name="sale" /> },
        { value: 'due', label: t('Money for an old sale', 'আগের বিক্রির টাকা'), picture: <Pic name="money" /> },
      ]} />,
    },
    {
      key: 'item', title: t('What did you sell?', 'কী বিক্রি করলেন?'), picture: <Pic name="sale" />, skip: d => d.kind !== 'sale' || !!preset?.itemId, valid: d => !!d.itemId,
      help: t('Choose what was sold. Ask the owner if it is not in the list.', 'যা বিক্রি হয়েছে তা বেছে নিন। তালিকায় না থাকলে মালিককে জিজ্ঞেস করুন।'),
      render: (d, set, next) => <ChoiceButtons value={d.itemId} onChange={v => set({ itemId: v, price: String(item(v)?.salePrice || '') })} onPick={next}
        options={L.produce.map(i => ({ value: i.id, label: nameOf(i, lang), sub: t(`${i.qtyOnHand} ${unitLabel(t, i.unit)} in stock`, `মজুদে ${i.qtyOnHand} ${unitLabel(t, i.unit)}`), picture: <Pic name={/egg|ডিম/i.test(i.name) ? 'eggs' : 'deaths'} /> }))} />,
    },
    {
      key: 'qty', title: preset?.itemId && item(preset.itemId) ? t(`How many ${nameOf(item(preset.itemId)!, lang)}?`, `কতগুলো ${nameOf(item(preset.itemId)!, lang)}?`) : t('How many?', 'কতগুলো?'), picture: <Pic name="sale" />, skip: d => d.kind !== 'sale', valid: d => n(d.qty) > 0,
      help: t('The number sold, in the unit shown.', 'যতগুলো বিক্রি হয়েছে, দেখানো এককে।'),
      render: (d, set) => <NumberPad allowDecimal label={t('Quantity', 'পরিমাণ')} unit={item(d.itemId) ? unitLabel(t, item(d.itemId)!.unit) : ''} value={d.qty} onChange={v => set({ qty: v })} />,
    },
    {
      key: 'price', title: t('Price for each one?', 'প্রতিটির দাম কত?'), picture: <Pic name="money" />, skip: d => d.kind !== 'sale', valid: d => n(d.price) > 0,
      help: t('Taka for one. The total is worked out for you.', 'একটির দাম টাকায়। মোট নিজে থেকেই হিসাব হবে।'),
      render: (d, set) => <>
        <NumberPad allowDecimal label={t('Price each', 'প্রতিটির দাম')} unit="৳" value={d.price} onChange={v => set({ price: v })} />
        <p className="wizard-total">{t('Total', 'মোট')}: <b>{fmtMoney(total(d), lang)}</b></p>
      </>,
    },
    {
      key: 'buyer', title: t('Who bought it?', 'কে কিনেছেন?'), picture: <Pic name="sale" />, skip: d => d.kind !== 'sale' || !!preset?.customerId,
      help: t('Optional. Leave both empty for a walk-in sale. With a mobile number, a known customer is recognised.', 'ঐচ্ছিক। সাধারণ বিক্রিতে দুটোই খালি রাখুন। মোবাইল নম্বর দিলে পরিচিত ক্রেতা চেনা যাবে।'),
      render: (d, set) => <>
        <Input className="input-lg" inputMode="tel" placeholder={t('Mobile number (optional)', 'মোবাইল নম্বর (ঐচ্ছিক)')} value={d.phone} onChange={e => set({ phone: e.target.value })} />
        <Input className="input-lg" placeholder={t('Name (optional)', 'নাম (ঐচ্ছিক)')} value={d.buyer} onChange={e => set({ buyer: e.target.value })} />
      </>,
    },
    {
      key: 'party', title: t('Who paid?', 'কে টাকা দিলেন?'), picture: <Pic name="money" />, skip: d => d.kind !== 'due', valid: d => !!d.partyId,
      help: t('Choose the customer who paid money they owed.', 'যে ক্রেতা বাকি টাকা দিয়েছেন তাকে বেছে নিন।'),
      render: (d, set, next) => <CustomerChoice value={d.partyId} onChange={v => set({ partyId: v })} onPick={next} />,
    },
    {
      key: 'amount', title: t('How much money?', 'কত টাকা?'), picture: <Pic name="money" />, skip: d => d.kind !== 'due', valid: d => n(d.amount) > 0,
      help: t('The taka received now.', 'এখন যত টাকা পেয়েছেন।'),
      render: (d, set) => <NumberPad allowDecimal label={t('Amount received', 'প্রাপ্ত টাকা')} unit="৳" value={d.amount} onChange={v => set({ amount: v })} />,
    },
    {
      key: 'how', title: t('How was it paid?', 'কীভাবে টাকা দিলেন?'), picture: <Pic name="cash" />, valid: d => !!d.how,
      help: t('Cash in hand, by bKash/Nagad, or not paid yet (the buyer owes it).', 'হাতে নগদ, বিকাশ/নগদে, অথবা এখনো দেননি (ক্রেতার বাকি)।'),
      render: (d, set, next) => <>
        <ChoiceButtons value={d.how || undefined} onChange={v => set({ how: v })} onPick={next} options={howOptions(d.kind === 'sale' && hasBuyer(d))} />
        {d.kind === 'sale' && !hasBuyer(d) && <p className="wizard-q">{t('To sell on credit, go back and write the buyer’s name or mobile number.', 'বাকিতে বিক্রি করতে পেছনে গিয়ে ক্রেতার নাম বা মোবাইল নম্বর লিখুন।')}</p>}
      </>,
    },
    {
      key: 'paidNow', title: t('How much was paid now?', 'এখন কত টাকা দিলেন?'), picture: <Pic name="money" />, skip: d => d.how !== 'part',
      valid: d => n(d.paidNow) > 0 && n(d.paidNow) < total(d),
      help: t('The taka the buyer gave now. The rest stays as money they owe.', 'ক্রেতা এখন যত টাকা দিয়েছেন। বাকিটা তার কাছে পাওনা থাকবে।'),
      render: (d, set) => <>
        <NumberPad allowDecimal label={t('Paid now', 'এখন পরিশোধ')} unit="৳" value={d.paidNow} onChange={v => set({ paidNow: v })} />
        <p className="wizard-total">{t('Total', 'মোট')} {fmtMoney(total(d), lang)} · {t('Still owed', 'বাকি থাকবে')}: <b>{fmtMoney(Math.max(total(d) - n(d.paidNow), 0), lang)}</b></p>
      </>,
    },
    {
      key: 'partHow', title: t('How did they pay that part?', 'ওই টাকা কীভাবে দিলেন?'), picture: <Pic name="cash" />, skip: d => d.how !== 'part', valid: d => !!d.partHow,
      help: t('Cash in hand, or by bKash/Nagad.', 'হাতে নগদ, অথবা বিকাশ/নগদে।'),
      render: (d, set, next) => <ChoiceButtons value={d.partHow || undefined} onChange={v => set({ partHow: v as 'cash' | 'mobile' })} onPick={next} options={howOptions(false)} />,
    },
  ];
  const howWord = (d: SaleData) => (d.how === 'cash' ? t('paid in cash', 'নগদে পরিশোধ') : d.how === 'mobile' ? t('paid by bKash/Nagad', 'বিকাশ/নগদে পরিশোধ')
    : d.how === 'part' ? t(`${fmtMoney(n(d.paidNow), lang)} paid now ${d.partHow === 'mobile' ? 'by bKash/Nagad' : 'in cash'}, ${fmtMoney(total(d) - n(d.paidNow), lang)} still owed`,
      `এখন ${fmtMoney(n(d.paidNow), lang)} ${d.partHow === 'mobile' ? 'বিকাশ/নগদে' : 'নগদে'} পরিশোধ, ${fmtMoney(total(d) - n(d.paidNow), lang)} বাকি`)
    : t('not paid yet', 'এখনো পরিশোধ হয়নি'));
  const way = (d: SaleData) => (d.how === 'part' ? d.partHow : d.how);
  const account = (d: SaleData) => (way(d) === 'mobile' ? L.mobileId : L.cashId);
  const buyerName = (d: SaleData) => d.buyer || preset?.customerName || '';
  return (
    <Wizard<SaleData> title={t('Sale & money received', 'বিক্রি ও টাকা আদায়')} steps={steps} key={lang}
      initial={{ kind: preset?.itemId ? 'sale' : '', itemId: preset?.itemId ?? '', qty: '', price: preset?.itemId ? String(item(preset.itemId)?.salePrice || '') : '', buyer: '', phone: '', how: '', partyId: '', amount: '', paidNow: '', partHow: '' }}
      busy={save.busy} error={save.error} onCancel={onClose}
      sentence={d => d.kind === 'sale'
        ? t(`You sold ${label(item(d.itemId), n(d.qty))} at ${fmtMoney(n(d.price), lang)} each = ${fmtMoney(total(d), lang)}${buyerName(d) ? ` to ${buyerName(d)}` : ''}, ${howWord(d)}.`,
          `আপনি ${label(item(d.itemId), n(d.qty))} প্রতিটি ${fmtMoney(n(d.price), lang)} দরে বিক্রি করেছেন = ${fmtMoney(total(d), lang)}${buyerName(d) ? `, ক্রেতা ${buyerName(d)}` : ''}, ${howWord(d)}।`)
        : t(`You received ${fmtMoney(n(d.amount), lang)}, ${howWord(d)}.`, `আপনি ${fmtMoney(n(d.amount), lang)} পেয়েছেন, ${howWord(d)}।`)}
      onSave={d => save.run([d.kind === 'sale'
        ? save.post('/invoices', {
          date, ...(preset?.customerId ? { customerId: preset.customerId } : { customer: d.buyer || d.phone ? { name: d.buyer || null, phone: d.phone || null } : null }),
          lines: [{ itemId: d.itemId, quantity: n(d.qty), unitPrice: n(d.price) }],
          received: d.how === 'credit' ? null : { amount: d.how === 'part' ? n(d.paidNow) : total(d), cashAccountId: account(d), method: way(d) === 'mobile' ? 'MOBILE' : 'CASH' },
        })
        : async () => {
          // Money for old sales pays the oldest unpaid invoices first, as the full receipt form does.
          const open = await api.get<{ data: { id: string; date: string; total: number; amountPaid: number }[] }>('/invoices', { partyId: d.partyId, status: 'POSTED,PARTIAL', pageSize: 200 });
          let left = n(d.amount);
          const allocations = [...open.data].sort((a, b) => a.date.localeCompare(b.date)).flatMap(inv => {
            const a = Math.min(Math.round((inv.total - inv.amountPaid) * 100) / 100, left);
            left = Math.round((left - a) * 100) / 100;
            return a > 0 ? [{ invoiceId: inv.id, amount: a }] : [];
          });
          return api.post('/payments', { direction: 'IN', date, partyId: d.partyId, cashAccountId: account(d), amount: n(d.amount), method: d.how === 'mobile' ? 'MOBILE' : 'CASH', allocations });
        }])}
    />
  );
}

function CustomerChoice({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: () => void }) {
  const { t, lang } = usePrefs();
  const parties = useEasyCustomers();
  if (!parties) return <Loading />;
  if (!parties.length) return <Empty>{t('Nobody owes money right now.', 'এখন কারো কাছে বাকি নেই।')}</Empty>;
  return <ChoiceButtons value={value} onChange={onChange} onPick={onPick} options={parties.map(p => ({ value: p.id, label: p.name, sub: t(`Owes ${fmtMoney(p.receivable ?? 0, lang)}`, `বাকি ${fmtMoney(p.receivable ?? 0, lang)}`), picture: <Pic name="money" /> }))} />;
}
function useEasyCustomers() {
  const q = useParties('CUSTOMER', true);
  return q.data ? q.data.data.filter(p => (p.receivable ?? 0) > 0.005) : undefined;
}

// ───── Bought feed / medicine ─────
interface BoughtData { itemId: string; qty: string; cost: string; how: 'cash' | 'mobile' | 'credit' | ''; supplierId: string }
export function BoughtFlow({ onClose }: { onClose: () => void }) {
  const { t, lang } = usePrefs();
  const L = useFarmLists();
  const label = useItemLabel();
  const suppliers = useParties('SUPPLIER');
  const date = ymd();
  const save = useEasySave(onClose);
  if (L.loading) return <Loading />;
  const item = (id: string) => L.buyable.find(i => i.id === id);
  const supplierName = (id: string) => suppliers.data?.data.find(s => s.id === id)?.name ?? '';
  const steps: WizardStep<BoughtData>[] = [
    {
      key: 'item', title: t('What did you buy?', 'কী কিনলেন?'), picture: <Pic name="bought" />, valid: d => !!d.itemId,
      help: t('Feed, medicine or supplies bought for the farm. Ask the owner if it is not in the list.', 'খামারের জন্য কেনা খাদ্য, ওষুধ বা সরঞ্জাম। তালিকায় না থাকলে মালিককে জিজ্ঞেস করুন।'),
      render: (d, set, next) => <ChoiceButtons value={d.itemId} onChange={v => set({ itemId: v })} onPick={next}
        options={L.buyable.map(i => ({ value: i.id, label: nameOf(i, lang), picture: <Pic name={i.category === 'MEDICINE' ? 'medicine' : i.category === 'FEED' ? 'feed' : 'bought'} /> }))} />,
    },
    {
      key: 'qty', title: t('How much did you buy?', 'কতটুকু কিনলেন?'), picture: <Pic name="bought" />, valid: d => n(d.qty) > 0,
      help: t('The amount bought, in the unit shown (for example kg or bags).', 'যতটুকু কিনেছেন, দেখানো এককে (যেমন কেজি বা বস্তা)।'),
      render: (d, set) => <NumberPad allowDecimal label={t('Quantity', 'পরিমাণ')} unit={item(d.itemId) ? unitLabel(t, item(d.itemId)!.unit) : ''} value={d.qty} onChange={v => set({ qty: v })} />,
    },
    {
      key: 'cost', title: t('How much did it cost in total?', 'মোট দাম কত?'), picture: <Pic name="money" />, valid: d => n(d.cost) > 0,
      help: t('The full price for everything bought, in taka, as on the shop’s slip.', 'যা কিনেছেন সবকিছুর মোট দাম টাকায়, দোকানের রসিদের মতো।'),
      render: (d, set) => <NumberPad allowDecimal label={t('Total cost', 'মোট দাম')} unit="৳" value={d.cost} onChange={v => set({ cost: v })} />,
    },
    {
      key: 'how', title: t('How did you pay?', 'কীভাবে টাকা দিলেন?'), picture: <Pic name="cash" />, valid: d => !!d.how,
      help: t('Cash, bKash/Nagad, or not paid yet (the farm owes the shop).', 'নগদ, বিকাশ/নগদ, অথবা এখনো দেননি (দোকানের কাছে খামারের বাকি)।'),
      render: (d, set, next) => <ChoiceButtons value={d.how || undefined} onChange={v => set({ how: v })} onPick={next} options={[
        { value: 'cash', label: t('Cash', 'নগদ'), picture: <Pic name="cash" /> },
        { value: 'mobile', label: t('bKash / Nagad', 'বিকাশ / নগদ'), picture: <Pic name="mobile" /> },
        { value: 'credit', label: t('Not paid yet (on credit)', 'এখনো দেইনি (বাকি)'), picture: <Pic name="money" /> },
      ]} />,
    },
    {
      key: 'supplier', title: t('Which shop or supplier?', 'কোন দোকান বা সরবরাহকারী?'), picture: <Pic name="bought" />, skip: d => d.how !== 'credit', valid: d => !!d.supplierId,
      help: t('When the farm owes money, choose who it is owed to.', 'খামারের বাকি থাকলে কার কাছে বাকি তা বেছে নিন।'),
      render: (d, set, next) => suppliers.data?.data.length
        ? <ChoiceButtons value={d.supplierId} onChange={v => set({ supplierId: v })} onPick={next} options={suppliers.data.data.map(s => ({ value: s.id, label: s.name, picture: <Pic name="bought" /> }))} />
        : <Empty>{t('No suppliers yet. Ask the owner to add the shop, or pay now.', 'এখনো কোনো সরবরাহকারী নেই। মালিককে দোকান যোগ করতে বলুন, অথবা এখন পরিশোধ করুন।')}</Empty>,
    },
  ];
  const howWord = (d: BoughtData) => (d.how === 'cash' ? t('paid in cash', 'নগদে পরিশোধ') : d.how === 'mobile' ? t('paid by bKash/Nagad', 'বিকাশ/নগদে পরিশোধ') : t(`owed to ${supplierName(d.supplierId)}`, `${supplierName(d.supplierId)}-এর কাছে বাকি`));
  return (
    <Wizard<BoughtData> title={t('Bought feed / medicine', 'খাদ্য / ওষুধ কেনা')} steps={steps} key={lang}
      initial={{ itemId: '', qty: '', cost: '', how: '', supplierId: '' }} busy={save.busy} error={save.error} onCancel={onClose}
      sentence={d => t(`You bought ${label(item(d.itemId), n(d.qty))} for ${fmtMoney(n(d.cost), lang)}, ${howWord(d)}.`, `আপনি ${label(item(d.itemId), n(d.qty))} কিনেছেন ${fmtMoney(n(d.cost), lang)}-তে, ${howWord(d)}।`)}
      onSave={d => save.run([save.post('/bills', {
        date, supplierId: d.how === 'credit' ? d.supplierId : null,
        lines: [{ itemId: d.itemId, quantity: n(d.qty), unitPrice: Math.round((n(d.cost) / n(d.qty)) * 10000) / 10000 }],
        paid: d.how === 'credit' ? null : { amount: n(d.cost), cashAccountId: d.how === 'mobile' ? L.mobileId : L.cashId, method: d.how === 'mobile' ? 'MOBILE' : 'CASH' },
      })])}
    />
  );
}
