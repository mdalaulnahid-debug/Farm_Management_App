// Business forms shared across screens: invoice, bill/expense, receipt/payment, production.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { nameOf, usePrefs } from '../lib/i18n';
import { fmtDate, fmtMoney, fmtNum, round2, ymd } from '../lib/format';
import { useAccounts, useApi, useCashAccounts, useFlocks, useItems, useParties, useSave } from '../lib/hooks';
import type { Account } from '../lib/api';
import { Alert, Drawer, Field, Input, Segmented, Select, StatusBadge } from './ui';

export function Money({ v, decimals }: { v: number | null | undefined; decimals?: number }) {
  const { lang } = usePrefs();
  return <span className={`num ${Number(v) < 0 ? 'neg' : ''}`}>{fmtMoney(v, lang, { decimals })}</span>;
}

export const accountOptions = (accounts: Account[] | undefined, lang: string, filter: (a: Account) => boolean = () => true) =>
  (accounts ?? []).filter(a => a.active && filter(a)).map(a => ({ value: a.id, label: `${a.code} · ${nameOf(a, lang)}` }));

export function CashAccountSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { lang } = usePrefs();
  const cash = useCashAccounts();
  useEffect(() => { if (!value && cash.data?.data[0]) onChange(cash.data.data[0].id); }, [cash.data, value, onChange]);
  return <Select value={value} onChange={e => onChange(e.target.value)} options={(cash.data?.data ?? []).map(a => ({ value: a.id, label: `${nameOf(a, lang)} — ${fmtMoney(a.balance, lang as any)}` }))} />;
}

type T = (en: string, bn: string) => string;
/** Payment methods, in the order users see them. Digital ones are recorded with their transaction ID; online collection is a next-phase feature. */
const METHODS: [value: string, en: string, bn: string][] = [
  ['CASH', 'Cash', 'নগদ'],
  ['MOBILE', 'bKash / Nagad / Rocket', 'বিকাশ / নগদ / রকেট'],
  ['CARD', 'Card', 'কার্ড'],
  ['BANK', 'Bank transfer', 'ব্যাংক ট্রান্সফার'],
  ['CHEQUE', 'Cheque', 'চেক'],
];
export const methodOptions = (t: T) => METHODS.map(([value, en, bn]) => ({ value, label: t(en, bn) }));
/** Translated label for a stored payment method (e.g. MOBILE → "bKash / Nagad / Rocket"); unknown values are shown as stored. */
export const methodLabel = (t: T, method: string) => { const m = METHODS.find(x => x[0] === method); return m ? t(m[1], m[2]) : method; };

// ───── Read-only document detail (invoice / bill) ─────
interface DocLine { id: string; description?: string | null; quantity: number; unitPrice: number; amount: number }
/** Line table of a posted invoice or bill. */
export function DocLinesTable({ lines }: { lines: DocLine[] }) {
  const { t, lang } = usePrefs();
  return (
    <div className="lines doc">
      <table>
        <thead><tr><th>{t('Description', 'বিবরণ')}</th><th className="num">{t('Qty', 'পরিমাণ')}</th><th className="num">{t('Rate', 'দর')}</th><th className="num">{t('Amount', 'টাকা')}</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.id}><td>{l.description || '—'}</td><td className="num">{fmtNum(l.quantity, lang)}</td><td className="num"><Money v={l.unitPrice} decimals={2} /></td><td className="num"><Money v={l.amount} /></td></tr>)}</tbody>
      </table>
    </div>
  );
}

interface Allocation { id: string; amount: number; payment: { number: string; date: string; method: string; status: string } }
/** "Payments applied" block of an invoice or bill: receipt/payment no., date, method (or Void) and amount. Renders nothing when empty. */
export function AllocationsTable({ allocations }: { allocations: Allocation[] }) {
  const { t, lang } = usePrefs();
  if (!allocations.length) return null;
  return (
    <div className="doc-section">
      <h3>{t('Payments applied', 'প্রয়োগকৃত পরিশোধ')}</h3>
      <div className="lines doc"><table><tbody>{allocations.map(a => (
        <tr key={a.id} className={a.payment.status === 'VOID' ? 'void' : ''}>
          <td className="mono">{a.payment.number}</td>
          <td>{fmtDate(a.payment.date, lang)}</td>
          <td>{a.payment.status === 'VOID' ? <StatusBadge status="VOID" /> : methodLabel(t, a.payment.method)}</td>
          <td className="num"><Money v={a.amount} /></td>
        </tr>
      ))}</tbody></table></div>
    </div>
  );
}

interface Line { itemId: string; accountId: string; description: string; quantity: string; unitPrice: string }
const blank = (): Line => ({ itemId: '', accountId: '', description: '', quantity: '1', unitPrice: '' });

// ───── Sales invoice ─────
export function InvoiceDrawer({ onClose }: { onClose: () => void }) {
  const { t, lang } = usePrefs();
  const customers = useParties('CUSTOMER');
  const items = useItems();
  const accounts = useAccounts('SALES,OTHER_INCOME');
  const [form, setForm] = useState({ date: ymd(), dueDate: '', customerId: '', discount: '0', reference: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [receive, setReceive] = useState({ mode: 'full' as 'full' | 'partial' | 'none', amount: '', cashAccountId: '', method: 'CASH' });
  const save = useSave('post', '/invoices', t('Invoice saved and posted.', 'চালান সংরক্ষিত ও পোস্ট হয়েছে।'));

  const [buyer, setBuyer] = useState({ mode: 'phone' as 'phone' | 'list', phone: '', name: '' });
  const phoneDigits = buyer.phone.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/\D/g, '');
  const lookup = useApi<{ match: { id: string; name: string; phone: string } | null }>(buyer.mode === 'phone' && phoneDigits.length >= 11 ? '/parties/lookup' : null, { phone: buyer.phone });
  const match = phoneDigits.length >= 11 ? lookup.data?.match ?? null : null;
  const buyerOk = buyer.mode === 'list' ? !!form.customerId : !buyer.phone.trim() || !!match || buyer.name.trim().length >= 2;
  useEffect(() => {
    const eggs = items.data?.data.find(i => i.category === 'PRODUCE');
    if (eggs && lines.length === 1 && !lines[0].itemId) setLines([{ ...blank(), itemId: eggs.id, unitPrice: String(eggs.salePrice || '') }]);
  }, [items.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = round2(lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0));
  const total = round2(subtotal - Number(form.discount || 0));
  const received = receive.mode === 'full' ? total : receive.mode === 'partial' ? Number(receive.amount || 0) : 0;
  const saleItems = (items.data?.data ?? []).filter(i => i.active && (i.salePrice > 0 || i.category === 'PRODUCE' || i.category === 'LIVESTOCK'));

  const submit = () => save.mutate({
    ...form, dueDate: form.dueDate || null, discount: Number(form.discount || 0),
    customerId: buyer.mode === 'list' ? form.customerId : match?.id ?? null,
    customer: buyer.mode === 'phone' && !match ? { name: buyer.name.trim() || null, phone: buyer.phone.trim() || null } : null,
    lines: lines.filter(l => Number(l.quantity) > 0).map(l => ({ itemId: l.itemId || null, accountId: l.accountId || null, description: l.description || undefined, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice || 0) })),
    received: received > 0 ? { amount: received, cashAccountId: receive.cashAccountId, method: receive.method } : null,
  }, { onSuccess: onClose });

  return (
    <Drawer title={t('New sales invoice', 'নতুন বিক্রয় চালান')} subtitle={t('Posts revenue and receivable, reduces stock, and records cash received.', 'আয় ও পাওনা পোস্ট করে, মজুদ কমায় এবং প্রাপ্ত নগদ লেখে।')} onClose={onClose}
      footer={<><div className="left">{t('Total', 'মোট')}: <b><Money v={total} /></b></div><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={save.isPending || !buyerOk || total < 0} onClick={submit}>{t('Save & post', 'সংরক্ষণ ও পোস্ট')}</button></>}>
      <div className="form-grid three">
        <div className="full stack gap-8">
          <div className="row between">
            <b>{t('Buyer', 'ক্রেতা')}</b>
            <Segmented value={buyer.mode} onChange={m => setBuyer({ ...buyer, mode: m })} options={[{ value: 'phone', label: t('Name & phone', 'নাম ও ফোন') }, { value: 'list', label: t('From customer list', 'ক্রেতা তালিকা থেকে') }]} />
          </div>
          {buyer.mode === 'phone' ? (
            <div className="form-grid">
              <Field label={t('Mobile number', 'মোবাইল নম্বর')} hint={match ? undefined : t('Existing customers are recognised automatically.', 'পুরোনো ক্রেতা স্বয়ংক্রিয়ভাবে চেনা যাবে।')}>
                <Input type="tel" inputMode="tel" autoFocus value={buyer.phone} onChange={e => setBuyer({ ...buyer, phone: e.target.value })} placeholder="01XXXXXXXXX" />
              </Field>
              {match
                ? <Field label={t('Customer', 'ক্রেতা')}><div className="badge green match">✓ {match.name}</div></Field>
                : <Field label={t('Buyer name', 'ক্রেতার নাম')} hint={buyer.phone.trim() ? t('New buyer — will be added to the customer list.', 'নতুন ক্রেতা — ক্রেতা তালিকায় যোগ হবে।') : t('Leave both blank for a walk-in sale.', 'খুচরা বিক্রিতে দুটোই খালি রাখুন।')}>
                    <Input value={buyer.name} onChange={e => setBuyer({ ...buyer, name: e.target.value })} />
                  </Field>}
            </div>
          ) : (
            <Select value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} placeholder={t('Choose…', 'বাছাই করুন…')} options={(customers.data?.data ?? []).filter(c => c.active).map(c => ({ value: c.id, label: c.phone ? `${c.name} · ${c.phone}` : c.name }))} />
          )}
        </div>
        <Field label={t('Invoice date', 'তারিখ')}><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label={t('Due date', 'পরিশোধের শেষ তারিখ')} hint={t('Blank = customer terms', 'খালি = ক্রেতার শর্ত')}><Input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
        <Field label={t('Reference', 'রেফারেন্স')}><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder={t('Memo / reference no.', 'মেমো / রেফারেন্স নং')} /></Field>
      </div>
      <div className="lines stack-sm">
        <table>
          <thead><tr><th style={{ width: '34%' }}>{t('Item', 'পণ্য')}</th><th>{t('Description', 'বিবরণ')}</th><th style={{ width: 100 }}>{t('Qty', 'পরিমাণ')}</th><th style={{ width: 110 }}>{t('Rate', 'দর')}</th><th style={{ width: 110 }} className="num">{t('Amount', 'টাকা')}</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const item = items.data?.data.find(x => x.id === l.itemId);
              const set = (p: Partial<Line>) => setLines(ls => ls.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <tr key={i}>
                  <td>
                    <Select value={l.itemId} placeholder={t('— Other income line —', '— অন্যান্য আয় —')} options={saleItems.map(x => ({ value: x.id, label: `${nameOf(x, lang)}${x.trackInventory ? ` (${x.qtyOnHand} ${x.unit})` : ''}` }))}
                      onChange={e => { const it = items.data?.data.find(x => x.id === e.target.value); set({ itemId: e.target.value, unitPrice: it ? String(it.salePrice || '') : l.unitPrice }); }} />
                    {!l.itemId && <Select className="mt-6" value={l.accountId} placeholder={t('Income account…', 'আয়ের হিসাব…')} options={accountOptions(accounts.data?.data, lang)} onChange={e => set({ accountId: e.target.value })} />}
                  </td>
                  <td data-label={t('Description', 'বিবরণ')}><Input value={l.description} onChange={e => set({ description: e.target.value })} placeholder={item?.name ?? ''} /></td>
                  <td data-label={t('Qty', 'পরিমাণ')}><Input type="number" min="0" step="any" value={l.quantity} onChange={e => set({ quantity: e.target.value })} /></td>
                  <td data-label={t('Rate', 'দর')}><Input type="number" min="0" step="any" value={l.unitPrice} onChange={e => set({ unitPrice: e.target.value })} /></td>
                  <td className="num line-amount" data-label={t('Amount', 'টাকা')}><Money v={Number(l.quantity || 0) * Number(l.unitPrice || 0)} /></td>
                  <td><button className="btn ghost sm icon" disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={6}><button className="btn sm" onClick={() => setLines(ls => [...ls, blank()])}><Plus size={14} />{t('Add line', 'লাইন যোগ')}</button></td></tr></tfoot>
        </table>
      </div>
      <div className="row align-start">
        <Field label={t('Notes', 'নোট')} className="" ><textarea className="textarea notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="totals">
          <span className="muted">{t('Subtotal', 'উপমোট')}</span><Money v={subtotal} />
          <span className="muted">{t('Discount', 'ছাড়')}</span><Input type="number" min="0" className="discount" value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} />
          <span className="grand">{t('Total', 'মোট')}</span><span className="grand num"><Money v={total} /></span>
        </div>
      </div>
      <div className="card card-pad stack soft">
        <h3>{t('Payment received now', 'এখন প্রাপ্ত টাকা')}</h3>
        <div className="row">
          {(['full', 'partial', 'none'] as const).map(m => <label key={m} className="check"><input type="radio" checked={receive.mode === m} onChange={() => setReceive({ ...receive, mode: m })} />{m === 'full' ? t('Paid in full', 'সম্পূর্ণ পরিশোধ') : m === 'partial' ? t('Part payment', 'আংশিক') : t('On credit (unpaid)', 'বাকিতে')}</label>)}
        </div>
        {receive.mode !== 'none' && (
          <div className="form-grid">
            {receive.mode === 'partial' && <Field label={t('Amount received', 'প্রাপ্ত টাকা')}><Input type="number" min="0" value={receive.amount} onChange={e => setReceive({ ...receive, amount: e.target.value })} /></Field>}
            <Field label={t('Paid by', 'পরিশোধের মাধ্যম')}><Select value={receive.method} onChange={e => setReceive({ ...receive, method: e.target.value })} options={methodOptions(t)} /></Field>
            <Field label={t('Received into', 'যে হিসাবে জমা')}><CashAccountSelect value={receive.cashAccountId} onChange={v => setReceive(r => ({ ...r, cashAccountId: v }))} /></Field>
          </div>
        )}
        {receive.mode !== 'full' && <small className="muted">{t(`Balance due ${fmtMoney(total - received, lang)} will appear in receivables.`, `বাকি ${fmtMoney(total - received, lang)} পাওনা হিসেবে থাকবে।`)}</small>}
      </div>
    </Drawer>
  );
}

// ───── Bill / expense ─────
export function BillDrawer({ onClose, expense }: { onClose: () => void; expense?: boolean }) {
  const { t, lang } = usePrefs();
  const suppliers = useParties('SUPPLIER');
  const items = useItems();
  const accounts = useAccounts();
  const [form, setForm] = useState({ date: ymd(), dueDate: '', supplierId: '', reference: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [pay, setPay] = useState({ mode: expense ? 'full' as const : 'none' as 'full' | 'partial' | 'none', amount: '', cashAccountId: '' });
  const save = useSave('post', '/bills', expense ? t('Expense recorded.', 'খরচ লেখা হয়েছে।') : t('Bill saved and posted.', 'বিল সংরক্ষিত ও পোস্ট হয়েছে।'));
  const expenseAccounts = accountOptions(accounts.data?.data, lang, a => a.type === 'EXPENSE' || a.subtype === 'FIXED_ASSET' || a.subtype === 'BIOLOGICAL_ASSET' || a.subtype === 'CURRENT_ASSET');
  const total = round2(lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0));
  const paid = pay.mode === 'full' ? total : pay.mode === 'partial' ? Number(pay.amount || 0) : 0;
  const needsSupplier = paid < total && !form.supplierId;

  const submit = () => save.mutate({
    ...form, supplierId: form.supplierId || null, dueDate: form.dueDate || null,
    lines: lines.filter(l => Number(l.quantity) > 0 && Number(l.unitPrice) >= 0).map(l => ({ itemId: l.itemId || null, accountId: l.accountId || null, description: l.description || undefined, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice || 0) })),
    paid: paid > 0 ? { amount: paid, cashAccountId: pay.cashAccountId } : null,
  }, { onSuccess: onClose });

  return (
    <Drawer title={expense ? t('Record expense', 'খরচ লিখুন') : t('New purchase bill', 'নতুন ক্রয় বিল')}
      subtitle={t('Stocked items (e.g. feed) go to inventory and are expensed when used. Other lines are expensed now.', 'মজুদযোগ্য পণ্য (যেমন খাদ্য) মজুদে যায় এবং ব্যবহারের সময় খরচ হয়। অন্যান্য লাইন এখনই খরচ।')} onClose={onClose}
      footer={<><div className="left">{t('Total', 'মোট')}: <b><Money v={total} /></b></div><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={save.isPending || total <= 0 || needsSupplier} onClick={submit}>{t('Save & post', 'সংরক্ষণ ও পোস্ট')}</button></>}>
      <div className="form-grid three">
        <Field label={t('Supplier', 'সরবরাহকারী')} className="full" hint={t('Optional for cash expenses paid in full', 'সম্পূর্ণ নগদ খরচে ঐচ্ছিক')}><Select value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} placeholder={t('— No supplier —', '— সরবরাহকারী নেই —')} options={(suppliers.data?.data ?? []).filter(s => s.active).map(s => ({ value: s.id, label: s.name }))} /></Field>
        <Field label={t('Date', 'তারিখ')}><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label={t('Due date', 'শেষ তারিখ')}><Input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
        <Field label={t('Supplier invoice no.', 'সরবরাহকারীর বিল নং')}><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></Field>
      </div>
      <div className="lines stack-sm">
        <table>
          <thead><tr><th style={{ width: '38%' }}>{t('Item or expense account', 'পণ্য বা খরচের হিসাব')}</th><th>{t('Description', 'বিবরণ')}</th><th style={{ width: 90 }}>{t('Qty', 'পরিমাণ')}</th><th style={{ width: 110 }}>{t('Rate', 'দর')}</th><th style={{ width: 110 }} className="num">{t('Amount', 'টাকা')}</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const set = (p: Partial<Line>) => setLines(ls => ls.map((x, j) => (j === i ? { ...x, ...p } : x)));
              const item = items.data?.data.find(x => x.id === l.itemId);
              return (
                <tr key={i}>
                  <td>
                    <Select value={l.itemId} placeholder={t('— Expense (no item) —', '— খরচ (পণ্য নয়) —')} options={(items.data?.data ?? []).filter(x => x.active && x.category !== 'PRODUCE').map(x => ({ value: x.id, label: `${nameOf(x, lang)} (${x.unit})` }))}
                      onChange={e => { const it = items.data?.data.find(x => x.id === e.target.value); set({ itemId: e.target.value, unitPrice: it?.purchasePrice ? String(it.purchasePrice) : l.unitPrice }); }} />
                    {(!l.itemId || (item && !(item.trackInventory && item.valued) && !item.expenseAccountId)) && <Select className="mt-6" value={l.accountId} placeholder={t('Expense account…', 'খরচের হিসাব…')} options={expenseAccounts} onChange={e => set({ accountId: e.target.value })} />}
                    {item?.trackInventory && item.valued && <small className="muted">{t('Adds to stock', 'মজুদে যোগ হবে')} · {item.qtyOnHand} {item.unit}</small>}
                  </td>
                  <td data-label={t('Description', 'বিবরণ')}><Input value={l.description} onChange={e => set({ description: e.target.value })} /></td>
                  <td data-label={t('Qty', 'পরিমাণ')}><Input type="number" min="0" step="any" value={l.quantity} onChange={e => set({ quantity: e.target.value })} /></td>
                  <td data-label={t('Rate', 'দর')}><Input type="number" min="0" step="any" value={l.unitPrice} onChange={e => set({ unitPrice: e.target.value })} /></td>
                  <td className="num line-amount" data-label={t('Amount', 'টাকা')}><Money v={Number(l.quantity || 0) * Number(l.unitPrice || 0)} /></td>
                  <td><button className="btn ghost sm icon" disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={6}><button className="btn sm" onClick={() => setLines(ls => [...ls, blank()])}><Plus size={14} />{t('Add line', 'লাইন যোগ')}</button></td></tr></tfoot>
        </table>
      </div>
      <Field label={t('Notes', 'নোট')}><textarea className="textarea" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      <div className="card card-pad stack soft">
        <h3>{t('Paid now', 'এখন পরিশোধ')}</h3>
        <div className="row">{(['full', 'partial', 'none'] as const).map(m => <label key={m} className="check"><input type="radio" checked={pay.mode === m} onChange={() => setPay({ ...pay, mode: m })} />{m === 'full' ? t('Paid in full', 'সম্পূর্ণ পরিশোধ') : m === 'partial' ? t('Part payment', 'আংশিক') : t('Pay later', 'পরে পরিশোধ')}</label>)}</div>
        {pay.mode !== 'none' && <div className="form-grid">
          {pay.mode === 'partial' && <Field label={t('Amount paid', 'পরিশোধিত টাকা')}><Input type="number" min="0" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></Field>}
          <Field label={t('Paid from', 'যে হিসাব থেকে')}><CashAccountSelect value={pay.cashAccountId} onChange={v => setPay(p => ({ ...p, cashAccountId: v }))} /></Field>
        </div>}
        {needsSupplier && <Alert tone="warn">{t('Choose a supplier for anything not paid now, so the payable is tracked.', 'এখন পরিশোধ না হলে দেনা ট্র্যাক করতে সরবরাহকারী বাছাই করুন।')}</Alert>}
      </div>
    </Drawer>
  );
}

// ───── Receipt from customer / payment to supplier ─────
export function PaymentDrawer({ direction, onClose, partyId: initialParty }: { direction: 'IN' | 'OUT'; onClose: () => void; partyId?: string }) {
  const { t, lang } = usePrefs();
  const parties = useParties(direction === 'IN' ? 'CUSTOMER' : 'SUPPLIER');
  const [form, setForm] = useState({ date: ymd(), partyId: initialParty ?? '', cashAccountId: '', amount: '', method: 'CASH', reference: '', notes: '' });
  const open = useApi<any>(form.partyId ? (direction === 'IN' ? '/invoices' : '/bills') : null, { partyId: form.partyId, status: 'POSTED,PARTIAL', pageSize: 200 });
  const docs = useMemo(() => [...(open.data?.data ?? [])].sort((a, b) => a.date.localeCompare(b.date)), [open.data]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // Auto-allocate oldest first when the amount changes.
  useEffect(() => {
    let left = Number(form.amount || 0);
    const next: Record<string, string> = {};
    for (const d of docs) { const due = round2(d.total - d.amountPaid); const a = Math.min(due, left); if (a > 0) next[d.id] = String(round2(a)); left = round2(left - a); }
    setAlloc(next);
  }, [form.amount, docs]);
  const allocated = round2(Object.values(alloc).reduce((a, v) => a + Number(v || 0), 0));
  const save = useSave('post', '/payments', direction === 'IN' ? t('Receipt recorded.', 'আদায় লেখা হয়েছে।') : t('Payment recorded.', 'পরিশোধ লেখা হয়েছে।'));
  const submit = () => save.mutate({
    direction, date: form.date, partyId: form.partyId, cashAccountId: form.cashAccountId, amount: Number(form.amount), method: form.method, reference: form.reference || null, notes: form.notes || null,
    allocations: Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([id, v]) => (direction === 'IN' ? { invoiceId: id, amount: Number(v) } : { billId: id, amount: Number(v) })),
  }, { onSuccess: onClose });

  return (
    <Drawer narrow title={direction === 'IN' ? t('Receive payment', 'টাকা আদায়') : t('Pay supplier', 'সরবরাহকারীকে পরিশোধ')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={save.isPending || !form.partyId || !(Number(form.amount) > 0) || allocated > Number(form.amount) + 0.001} onClick={submit}>{t('Save', 'সংরক্ষণ')}</button></>}>
      <Field label={direction === 'IN' ? t('Customer', 'ক্রেতা') : t('Supplier', 'সরবরাহকারী')}><Select value={form.partyId} onChange={e => setForm({ ...form, partyId: e.target.value })} placeholder={t('Choose…', 'বাছাই করুন…')} options={(parties.data?.data ?? []).map(p => ({ value: p.id, label: p.name }))} /></Field>
      <div className="form-grid">
        <Field label={t('Date', 'তারিখ')}><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label={t('Amount', 'টাকা')}><Input type="number" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label={direction === 'IN' ? t('Deposit to', 'জমা হিসাব') : t('Pay from', 'যে হিসাব থেকে')}><CashAccountSelect value={form.cashAccountId} onChange={v => setForm(f => ({ ...f, cashAccountId: v }))} /></Field>
        <Field label={t('Method', 'মাধ্যম')}><Select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} options={methodOptions(t)} /></Field>
        <Field label={t('Reference', 'রেফারেন্স')} className="full"><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder={t('Transaction ID / cheque no.', 'লেনদেন আইডি / চেক নং')} /></Field>
      </div>
      {form.partyId && (
        <div className="lines">
          <table>
            <thead><tr><th>{t('Open documents', 'খোলা ডকুমেন্ট')}</th><th className="num">{t('Due', 'বাকি')}</th><th style={{ width: 120 }}>{t('Apply', 'প্রয়োগ')}</th></tr></thead>
            <tbody>
              {docs.length ? docs.map(d => (
                <tr key={d.id}>
                  <td><b>{d.number}</b><br /><small className="muted">{d.date.slice(0, 10)}</small></td>
                  <td className="num due"><Money v={d.total - d.amountPaid} /></td>
                  <td><Input type="number" min="0" value={alloc[d.id] ?? ''} onChange={e => setAlloc({ ...alloc, [d.id]: e.target.value })} /></td>
                </tr>
              )) : <tr><td colSpan={3} className="muted">{t('No open documents. The amount will be kept as an advance.', 'কোনো খোলা ডকুমেন্ট নেই। টাকাটি অগ্রিম হিসেবে থাকবে।')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {Number(form.amount) > allocated && docs.length > 0 && <small className="muted">{t(`${fmtMoney(Number(form.amount) - allocated, lang)} will be kept as an advance.`, `${fmtMoney(Number(form.amount) - allocated, lang)} অগ্রিম হিসেবে থাকবে।`)}</small>}
      <Field label={t('Notes', 'নোট')}><textarea className="textarea" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
    </Drawer>
  );
}

// ───── Daily production ─────
export function ProductionDrawer({ onClose }: { onClose: () => void }) {
  const { t, lang } = usePrefs();
  const flocks = useFlocks();
  const items = useItems();
  const active = (flocks.data?.data ?? []).filter(f => f.status === 'ACTIVE');
  const feeds = (items.data?.data ?? []).filter(i => i.category === 'FEED' && i.trackInventory);
  const [f, setF] = useState({ date: ymd(), flockId: '', eggsCollected: '', eggsBroken: '0', mortality: '0', culled: '0', feedItemId: '', feedQty: '', notes: '' });
  useEffect(() => { if (!f.flockId && active[0]) setF(x => ({ ...x, flockId: active[0].id })); }, [active, f.flockId]);
  useEffect(() => { if (!f.feedItemId && feeds[0]) setF(x => ({ ...x, feedItemId: feeds[0].id })); }, [feeds, f.feedItemId]);
  const flock = active.find(x => x.id === f.flockId);
  const feed = feeds.find(x => x.id === f.feedItemId);
  const rate = flock?.currentCount ? (Number(f.eggsCollected || 0) / flock.currentCount) * 100 : null;
  const save = useSave('post', '/production', t('Production recorded.', 'উৎপাদন লেখা হয়েছে।'));
  const submit = () => save.mutate({ ...f, eggsCollected: Number(f.eggsCollected || 0), eggsBroken: Number(f.eggsBroken || 0), mortality: Number(f.mortality || 0), culled: Number(f.culled || 0), feedQty: Number(f.feedQty || 0), feedItemId: Number(f.feedQty) > 0 ? f.feedItemId : null }, { onSuccess: onClose });
  return (
    <Drawer narrow title={t('Daily production log', 'দৈনিক উৎপাদন')} subtitle={t('Eggs go into stock; feed used is taken from stock and expensed at average cost.', 'ডিম মজুদে যোগ হয়; ব্যবহৃত খাদ্য মজুদ থেকে বাদ যায় ও গড় মূল্যে খরচ হয়।')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button><button className="btn primary" disabled={save.isPending || !f.flockId} onClick={submit}>{t('Save', 'সংরক্ষণ')}</button></>}>
      {!active.length && <Alert tone="warn">{t('Create an active flock first (Production → Flocks).', 'প্রথমে একটি সক্রিয় ঝাঁক তৈরি করুন (উৎপাদন → ঝাঁক)।')}</Alert>}
      <div className="form-grid">
        <Field label={t('Date', 'তারিখ')}><Input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t('Flock', 'ঝাঁক')} hint={flock ? t(`${flock.currentCount} birds`, `${flock.currentCount}টি পাখি`) : undefined}><Select value={f.flockId} onChange={e => setF({ ...f, flockId: e.target.value })} options={active.map(x => ({ value: x.id, label: `${x.code} · ${x.name}` }))} /></Field>
        <Field label={t('Eggs collected', 'সংগৃহীত ডিম')} hint={rate !== null ? t(`Laying rate ${rate.toFixed(1)}%`, `ডিম পাড়ার হার ${rate.toFixed(1)}%`) : undefined}><Input type="number" min="0" autoFocus value={f.eggsCollected} onChange={e => setF({ ...f, eggsCollected: e.target.value })} /></Field>
        <Field label={t('Broken / rejected', 'ভাঙা / বাতিল')}><Input type="number" min="0" value={f.eggsBroken} onChange={e => setF({ ...f, eggsBroken: e.target.value })} /></Field>
        <Field label={t('Mortality', 'মৃত্যু')}><Input type="number" min="0" value={f.mortality} onChange={e => setF({ ...f, mortality: e.target.value })} /></Field>
        <Field label={t('Culled / sold birds', 'বাছাই / বিক্রি পাখি')}><Input type="number" min="0" value={f.culled} onChange={e => setF({ ...f, culled: e.target.value })} /></Field>
        <Field label={t('Feed item', 'খাদ্য')} hint={feed ? t(`In stock: ${feed.qtyOnHand} ${feed.unit}`, `মজুদ: ${feed.qtyOnHand} ${feed.unit}`) : undefined}><Select value={f.feedItemId} onChange={e => setF({ ...f, feedItemId: e.target.value })} options={feeds.map(x => ({ value: x.id, label: nameOf(x, lang) }))} placeholder={t('— none —', '— নেই —')} /></Field>
        <Field label={t(`Feed used${feed ? ` (${feed.unit})` : ''}`, `ব্যবহৃত খাদ্য${feed ? ` (${feed.unit})` : ''}`)} hint={feed && Number(f.feedQty) > 0 ? t(`≈ ${fmtMoney(Number(f.feedQty) * feed.avgCost, lang)} cost`, `≈ ${fmtMoney(Number(f.feedQty) * feed.avgCost, lang)} খরচ`) : undefined}><Input type="number" min="0" step="any" value={f.feedQty} onChange={e => setF({ ...f, feedQty: e.target.value })} /></Field>
        <Field label={t('Notes', 'নোট')} className="full"><textarea className="textarea" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
