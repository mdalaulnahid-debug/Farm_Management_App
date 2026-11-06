// Sale by QR sticker. A salesperson scans a sticker (printed from /sell/stickers) with the phone camera; it
// opens /sell?item=<SKU>[&customer=<id>] here. Signing in first, if needed, keeps this address, so the sale
// screen follows. The step-by-step sale form (easy/flows › SaleFlow) then asks only how many, the price, and
// how it was paid: cash, bKash/Nagad, on credit, or part now and the rest later.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Printer, QrCode } from 'lucide-react';
import { useItems, useParties } from '../lib/hooks';
import { nameOf, unitLabel, usePrefs } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { fmtMoney } from '../lib/format';
import { Alert, Card, Empty, Field, Loading, PageHeader, Select } from '../components/ui';
import { LogoMark } from '../brand/Logo';
import { SaleFlow } from '../easy/flows';

export default function QuickSale() {
  const { t } = usePrefs();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const items = useItems();
  const customers = useParties('CUSTOMER');
  const sku = params.get('item') ?? '';
  const customerId = params.get('customer') ?? '';
  if (items.isLoading || (customerId && customers.isLoading)) return <Loading />;
  const item = items.data?.data.find(i => i.sku === sku && i.active);
  const customer = customerId ? customers.data?.data.find(c => c.id === customerId && c.active) : undefined;
  if (sku && !item) return <Alert tone="warn">{t('This QR sticker is for a product that is no longer sold. Ask the owner for a new sticker, or use “Sale & money received”.', 'এই কিউআর স্টিকারের পণ্যটি আর বিক্রি হয় না। মালিকের কাছে নতুন স্টিকার চান, অথবা “বিক্রি ও টাকা আদায়” ব্যবহার করুন।')}</Alert>;
  return (
    <div className="easy">
      <SaleFlow key={`${sku}|${customerId}`} preset={{ itemId: item?.id, customerId: customer?.id, customerName: customer?.name }} onClose={() => navigate('/')} />
    </div>
  );
}

/** QR code as an inline SVG, drawn once the small QR library has loaded. */
function QrSvg({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    import('qrcode').then(q => q.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0e3b2c', light: '#0000' } }))
      .then(s => { if (live) setSvg(s); }, () => {});
    return () => { live = false; };
  }, [text]);
  return <div className="sticker-qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A sheet of sale QR stickers to print and stick where sales happen: one product each, optionally for one
 *  regular customer. Each opens the sale screen for that product on the salesperson's phone. */
export function SaleStickers() {
  const { t, lang } = usePrefs();
  const { me } = useAuth();
  const items = useItems();
  const customers = useParties('CUSTOMER');
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [customerId, setCustomerId] = useState('');
  const sellable = useMemo(() => (items.data?.data ?? []).filter(i => i.active && (i.category === 'PRODUCE' || i.category === 'LIVESTOCK')), [items.data]);
  const customer = customers.data?.data.find(c => c.id === customerId);
  const url = (sku: string) => `${window.location.origin}/sell?item=${encodeURIComponent(sku)}${customerId ? `&customer=${encodeURIComponent(customerId)}` : ''}`;
  const sheet = sellable.flatMap(i => Array.from({ length: chosen[i.id] ?? 0 }, (_, k) => ({ item: i, k })));
  if (items.isLoading) return <Loading />;
  return (
    <>
      <PageHeader crumb={t('Sales', 'বিক্রয়')} title={t('Sale QR stickers', 'বিক্রির কিউআর স্টিকার')}
        subtitle={t('Print and stick these where you sell. A salesperson scans one with the phone camera to record that sale in a few taps.', 'যেখানে বিক্রি হয় সেখানে প্রিন্ট করে লাগান। বিক্রেতা ফোনের ক্যামেরায় স্ক্যান করলে কয়েক ট্যাপে বিক্রি লেখা হয়ে যাবে।')}
        actions={<button className="btn primary" disabled={!sheet.length} onClick={() => window.print()}><Printer size={16} />{t('Print stickers', 'স্টিকার প্রিন্ট')}</button>} />
      <Card className="no-print" title={t('Choose stickers', 'স্টিকার বাছুন')} pad>
        {!sellable.length ? <Empty icon={QrCode}>{t('No products for sale yet. Add them in Inventory.', 'এখনো বিক্রির কোনো পণ্য নেই। মজুদ অংশে যোগ করুন।')}</Empty> : (
          <div className="stack">
            <Field label={t('For one regular customer (optional)', 'একজন নিয়মিত ক্রেতার জন্য (ঐচ্ছিক)')} hint={t('Leave as “Any buyer” for a shop sticker; the salesperson can type the buyer.', 'দোকানের স্টিকারে “যেকোনো ক্রেতা” রাখুন; বিক্রেতা ক্রেতার নাম লিখতে পারবেন।')}>
              <Select value={customerId} onChange={e => setCustomerId(e.target.value)}
                options={[{ value: '', label: t('Any buyer', 'যেকোনো ক্রেতা') }, ...(customers.data?.data ?? []).filter(c => c.active).map(c => ({ value: c.id, label: c.phone ? `${c.name} · ${c.phone}` : c.name }))]} />
            </Field>
            <div className="sticker-pick">
              {sellable.map(i => (
                <label key={i.id} className="sticker-row">
                  <span><b>{nameOf(i, lang)}</b><small>{fmtMoney(i.salePrice, lang)} / {unitLabel(t, i.unit)}</small></span>
                  <Select value={String(chosen[i.id] ?? 0)} onChange={e => setChosen(c => ({ ...c, [i.id]: Number(e.target.value) }))} aria-label={t('How many stickers', 'কয়টি স্টিকার')}
                    options={[0, 1, 2, 3, 4, 6, 8, 12].map(n => ({ value: String(n), label: n === 0 ? t('None', 'নেই') : t(`${n} sticker${n > 1 ? 's' : ''}`, `${n}টি স্টিকার`) }))} />
                </label>
              ))}
            </div>
          </div>
        )}
      </Card>
      {sheet.length > 0 && (
        <div className="sticker-sheet">
          {sheet.map(({ item, k }) => (
            <div key={`${item.id}-${k}`} className="sticker">
              <div className="sticker-head"><LogoMark size={26} /><span>{me?.organization.nameBn || me?.organization.name}</span></div>
              <QrSvg text={url(item.sku)} />
              <b>{nameOf(item, lang)}</b>
              {customer && <small>{t('For', 'ক্রেতা')}: {customer.name}</small>}
              <em>{t('Scan to record a sale', 'বিক্রি লিখতে স্ক্যান করুন')}</em>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
