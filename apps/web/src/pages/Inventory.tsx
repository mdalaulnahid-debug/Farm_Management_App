import { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Download, PackagePlus, Pencil, Plus, SlidersHorizontal, Wallet } from 'lucide-react';
import { usePrefs, categoryLabel, moveLabel } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useAccounts, useApi, useItems, useSave } from '../lib/hooks';
import { downloadCsv, fmtDate, fmtMoney, fmtNum, iso10, ymd } from '../lib/format';
import type { Item } from '../lib/api';
import { Alert, Badge, Card, DataTable, Drawer, Field, Input, Kpi, PageHeader, RangePicker, SearchBox, Segmented, Select, Tabs, thisMonth, type Column } from '../components/ui';
import { Money, accountOptions } from '../components/forms';

interface StockRow { id: string; sku: string; name: string; nameBn?: string | null; category: string; unit: string; valued: boolean; qtyOnHand: number; avgCost: number; value: number; reorderLevel: number; low: boolean }
interface StockMove { id: string; date: string; type: string; quantity: number; unitCost: number; value: number; notes?: string | null; voided: boolean; item: { name: string; unit: string; sku: string } }

const CATEGORIES = ['PRODUCE', 'FEED', 'MEDICINE', 'LIVESTOCK', 'SUPPLY', 'SERVICE'] as const;
const MOVE_TYPES = ['OPENING', 'PURCHASE', 'SALE', 'PRODUCTION', 'CONSUMPTION', 'ADJUSTMENT', 'GIFT', 'WASTE', 'MORTALITY'];
type Tab = 'stock' | 'items' | 'moves';

export default function Inventory() {
  const { t } = usePrefs();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('stock');
  const [adjusting, setAdjusting] = useState<{ itemId?: string } | null>(null);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const manage = can('inventory.manage');

  return (
    <>
      <PageHeader crumb={t('Inventory', 'মজুদ')} title={t('Inventory', 'মজুদ')}
        subtitle={t('Stock is moved automatically by sales, purchases and production. Use adjustments only for counts, gifts, waste and opening balances.', 'বিক্রয়, ক্রয় ও উৎপাদনে মজুদ নিজে থেকেই হালনাগাদ হয়। শুধু গণনা, উপহার, নষ্ট ও প্রারম্ভিক মজুদের জন্য সমন্বয় ব্যবহার করুন।')}
        actions={<>
          {manage && <button className="btn" onClick={() => setEditing('new')}><Plus size={16} />{t('New item', 'নতুন পণ্য')}</button>}
          {manage && <button className="btn primary" onClick={() => setAdjusting({})}><SlidersHorizontal size={16} />{t('Adjust stock', 'মজুদ সমন্বয়')}</button>}
        </>} />

      <Tabs value={tab} onChange={setTab} options={[
        { value: 'stock', label: t('Stock on hand', 'হাতে মজুদ') },
        { value: 'items', label: t('Items', 'পণ্য তালিকা') },
        { value: 'moves', label: t('Stock movements', 'মজুদ চলাচল') },
      ]} />

      {tab === 'stock' && <StockOnHand onAdjust={manage ? itemId => setAdjusting({ itemId }) : undefined} />}
      {tab === 'items' && <Items onEdit={manage ? setEditing : undefined} />}
      {tab === 'moves' && <Moves />}

      {adjusting && <AdjustDrawer initialItemId={adjusting.itemId} onClose={() => setAdjusting(null)} />}
      {editing && <ItemDrawer item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const itemName = (lang: string, x: { name: string; nameBn?: string | null }) => (lang === 'bn' && x.nameBn ? x.nameBn : x.name);

// ───── Stock on hand ─────
function StockOnHand({ onAdjust }: { onAdjust?: (itemId: string) => void }) {
  const { t, lang } = usePrefs();
  const report = useApi<{ rows: StockRow[]; totalValue: number }>('/reports/inventory');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const all = report.data?.rows;
  const lowCount = all?.filter(r => r.low).length ?? 0;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all?.filter(r => (!category || r.category === category) && (!lowOnly || r.low)
      && (!q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || (r.nameBn ?? '').includes(q)));
  }, [all, search, category, lowOnly]);
  const shownValue = (rows ?? []).reduce((a, r) => a + r.value, 0);

  const columns: Column<StockRow>[] = [
    { key: 'sku', label: t('SKU', 'এসকেইউ'), render: r => <span className="mono">{r.sku}</span> },
    { key: 'name', label: t('Item', 'পণ্য'), render: r => <><b>{itemName(lang, r)}</b>{lang !== 'bn' && r.nameBn && <div className="muted small">{r.nameBn}</div>}</> },
    { key: 'cat', label: t('Category', 'শ্রেণি'), hideSm: true, render: r => categoryLabel(t, r.category) },
    {
      key: 'qty', label: t('On hand', 'হাতে আছে'), num: true, render: r => (
        <span className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'nowrap' }}>
          {r.qtyOnHand <= 0 ? <Badge tone="red">{t('Out', 'শেষ')}</Badge> : r.low ? <Badge tone="amber">{t('Low', 'কম')}</Badge> : null}
          <b className={r.qtyOnHand < 0 ? 'neg' : ''}>{fmtNum(r.qtyOnHand, lang, 3)}</b> <span className="muted small">{r.unit}</span>
        </span>
      ),
    },
    { key: 'reorder', label: t('Reorder at', 'পুনঃঅর্ডার সীমা'), num: true, hideSm: true, render: r => (r.reorderLevel > 0 ? fmtNum(r.reorderLevel, lang, 3) : <span className="muted">—</span>) },
    { key: 'avg', label: t('Avg cost', 'গড় মূল্য'), num: true, render: r => (r.valued ? <Money v={r.avgCost} decimals={2} /> : <span className="muted small">{t('Qty only', 'শুধু পরিমাণ')}</span>) },
    { key: 'value', label: t('Value', 'মূল্য'), num: true, render: r => (r.valued ? <Money v={r.value} /> : <span className="muted">—</span>) },
    ...(onAdjust ? [{ key: 'act', label: '', render: (r: StockRow) => <button className="btn ghost sm" onClick={() => onAdjust(r.id)}><SlidersHorizontal size={14} />{t('Adjust', 'সমন্বয়')}</button> }] : []),
  ];

  const exportCsv = () => downloadCsv(`stock_on_hand_${ymd()}.csv`, ['SKU', 'Item', 'Item (Bangla)', 'Category', 'Unit', 'Valued', 'On hand', 'Reorder level', 'Avg cost', 'Value', 'Low'],
    (rows ?? []).map(r => [r.sku, r.name, r.nameBn ?? '', r.category, r.unit, r.valued ? 'yes' : 'no', r.qtyOnHand, r.reorderLevel, r.avgCost, r.value, r.low ? 'yes' : '']));

  return (
    <>
      <div className="grid g3">
        <Kpi icon={Wallet} label={t('Stock value', 'মজুদের মূল্য')} value={<Money v={report.data?.totalValue} />} sub={t('Valued items at average cost', 'মূল্যায়িত পণ্য, গড় মূল্যে')} />
        <Kpi icon={Boxes} tone="blue" label={t('Items tracked', 'ট্র্যাককৃত পণ্য')} value={all ? fmtNum(all.length, lang, 0) : '—'}
          sub={all ? t(`${all.filter(r => r.valued).length} valued · ${all.filter(r => !r.valued).length} quantity only`, `${all.filter(r => r.valued).length}টি মূল্যায়িত · ${all.filter(r => !r.valued).length}টি শুধু পরিমাণ`) : undefined} />
        <Kpi icon={AlertTriangle} tone={lowCount ? 'red' : undefined} label={t('Low stock', 'কম মজুদ')} value={all ? fmtNum(lowCount, lang, 0) : '—'}
          sub={lowCount ? t('At or below reorder level', 'পুনঃঅর্ডার সীমায় বা নিচে') : t('All items above reorder level', 'সব পণ্য সীমার উপরে')} />
      </div>

      <Card title={t('Stock on hand', 'হাতে মজুদ')} actions={<>
        <Segmented value={lowOnly ? 'low' : 'all'} onChange={v => setLowOnly(v === 'low')} options={[{ value: 'all', label: t('All', 'সব') }, { value: 'low', label: t(`Low (${lowCount})`, `কম (${lowCount})`) }]} />
        <Select style={{ width: 'auto' }} value={category} onChange={e => setCategory(e.target.value)} placeholder={t('All categories', 'সব শ্রেণি')} options={CATEGORIES.map(c => ({ value: c, label: categoryLabel(t, c) }))} />
        <SearchBox value={search} onChange={setSearch} placeholder={t('Search item or SKU…', 'পণ্য বা এসকেইউ খুঁজুন…')} />
        <button className="btn" onClick={exportCsv} disabled={!rows?.length}><Download size={16} />{t('Export', 'রপ্তানি')}</button>
      </>}>
        <DataTable rows={rows} columns={columns}
          empty={all?.length ? t('No items match these filters.', 'এই ফিল্টারে কোনো পণ্য নেই।') : t('No stock-tracked items yet. Add items in the Items tab.', 'এখনো কোনো মজুদযোগ্য পণ্য নেই। পণ্য তালিকা ট্যাবে যোগ করুন।')}
          footer={rows?.length ? <tr><td colSpan={6}><b>{t('Total', 'মোট')}</b></td><td className="num"><b><Money v={shownValue} /></b></td>{onAdjust && <td />}</tr> : undefined} />
      </Card>
    </>
  );
}

// ───── Items master ─────
function trackingBadge(t: (en: string, bn: string) => string, i: Pick<Item, 'trackInventory' | 'valued'>) {
  if (!i.trackInventory) return <Badge>{t('Not stocked', 'মজুদ নয়')}</Badge>;
  return i.valued ? <Badge tone="blue">{t('Valued stock', 'মূল্যায়িত মজুদ')}</Badge> : <Badge tone="green">{t('Qty only', 'শুধু পরিমাণ')}</Badge>;
}

function Items({ onEdit }: { onEdit?: (i: Item) => void }) {
  const { t, lang } = usePrefs();
  const items = useItems();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState<'active' | 'inactive' | 'all'>('active');
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.data?.data.filter(i => (active === 'all' || (active === 'active') === i.active) && (!category || i.category === category)
      && (!q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || (i.nameBn ?? '').includes(q)));
  }, [items.data, search, category, active]);

  const columns: Column<Item & { status?: string }>[] = [
    { key: 'sku', label: t('SKU', 'এসকেইউ'), render: i => <span className="mono">{i.sku}</span> },
    { key: 'name', label: t('Name', 'নাম'), render: i => <><b>{itemName(lang, i)}</b>{lang !== 'bn' && i.nameBn && <div className="muted small">{i.nameBn}</div>}</> },
    { key: 'cat', label: t('Category', 'শ্রেণি'), render: i => categoryLabel(t, i.category) },
    { key: 'unit', label: t('Unit', 'একক'), hideSm: true, render: i => i.unit },
    { key: 'sale', label: t('Sale price', 'বিক্রয় মূল্য'), num: true, render: i => (i.salePrice ? <Money v={i.salePrice} decimals={2} /> : <span className="muted">—</span>) },
    { key: 'buy', label: t('Purchase price', 'ক্রয় মূল্য'), num: true, hideSm: true, render: i => (i.purchasePrice ? <Money v={i.purchasePrice} decimals={2} /> : <span className="muted">—</span>) },
    { key: 'track', label: t('Stock', 'মজুদ'), render: i => trackingBadge(t, i) },
    { key: 'qty', label: t('On hand', 'হাতে আছে'), num: true, hideSm: true, render: i => (i.trackInventory ? `${fmtNum(i.qtyOnHand, lang, 3)} ${i.unit}` : <span className="muted">—</span>) },
    { key: 'active', label: t('Status', 'অবস্থা'), render: i => (i.active ? <Badge tone="green">{t('Active', 'সক্রিয়')}</Badge> : <Badge>{t('Inactive', 'নিষ্ক্রিয়')}</Badge>) },
    ...(onEdit ? [{ key: 'act', label: '', render: (i: Item) => <button className="btn ghost sm icon" aria-label={t('Edit', 'সম্পাদনা')} onClick={e => { e.stopPropagation(); onEdit(i); }}><Pencil size={14} /></button> }] : []),
  ];

  const exportCsv = () => downloadCsv('items.csv', ['SKU', 'Name', 'Name (Bangla)', 'Category', 'Unit', 'Sale price', 'Purchase price', 'Track inventory', 'Valued', 'Reorder level', 'On hand', 'Active'],
    (rows ?? []).map(i => [i.sku, i.name, i.nameBn ?? '', i.category, i.unit, i.salePrice, i.purchasePrice, i.trackInventory ? 'yes' : 'no', i.valued ? 'yes' : 'no', i.reorderLevel, i.qtyOnHand, i.active ? 'yes' : 'no']));

  return (
    <Card title={t('Items', 'পণ্য তালিকা')} subtitle={t('Products you sell, inputs you buy and services. Accounts set here drive automatic postings.', 'যা বিক্রি করেন, যা কেনেন ও সেবা। এখানে দেওয়া হিসাব অনুযায়ী স্বয়ংক্রিয় পোস্টিং হয়।')}
      actions={<>
        <Segmented value={active} onChange={setActive} options={[{ value: 'active', label: t('Active', 'সক্রিয়') }, { value: 'inactive', label: t('Inactive', 'নিষ্ক্রিয়') }, { value: 'all', label: t('All', 'সব') }]} />
        <Select style={{ width: 'auto' }} value={category} onChange={e => setCategory(e.target.value)} placeholder={t('All categories', 'সব শ্রেণি')} options={CATEGORIES.map(c => ({ value: c, label: categoryLabel(t, c) }))} />
        <SearchBox value={search} onChange={setSearch} placeholder={t('Search item or SKU…', 'পণ্য বা এসকেইউ খুঁজুন…')} />
        <button className="btn" onClick={exportCsv} disabled={!rows?.length}><Download size={16} />{t('Export', 'রপ্তানি')}</button>
      </>}>
      <DataTable rows={rows} columns={columns} onRow={onEdit} empty={t('No items match these filters.', 'এই ফিল্টারে কোনো পণ্য নেই।')} />
    </Card>
  );
}

function ItemDrawer({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const accounts = useAccounts();
  const [f, setF] = useState({
    sku: item?.sku ?? '', name: item?.name ?? '', nameBn: item?.nameBn ?? '', category: item?.category ?? 'FEED', unit: item?.unit ?? 'kg',
    salePrice: item ? String(item.salePrice || '') : '', purchasePrice: item ? String(item.purchasePrice || '') : '',
    trackInventory: item?.trackInventory ?? true, valued: item?.valued ?? true, reorderLevel: item ? String(item.reorderLevel || '') : '',
    incomeAccountId: item?.incomeAccountId ?? '', expenseAccountId: item?.expenseAccountId ?? '', inventoryAccountId: item?.inventoryAccountId ?? '', active: item?.active ?? true,
  });
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));
  const create = useSave('post', '/items', t('Item created.', 'পণ্য তৈরি হয়েছে।'));
  const update = useSave('put', `/items/${item?.id}`, t('Item updated.', 'পণ্য হালনাগাদ হয়েছে।'));
  const busy = create.isPending || update.isPending;
  const all = accounts.data?.data;
  const incomeOpts = accountOptions(all, lang, a => a.type === 'INCOME');
  const expenseOpts = accountOptions(all, lang, a => a.type === 'EXPENSE');
  const inventoryOpts = accountOptions(all, lang, a => a.subtype === 'INVENTORY');
  const nonNeg = (v: string) => v === '' || Number(v) >= 0;
  const valid = f.sku.trim().length >= 2 && f.name.trim().length >= 2 && f.unit.trim().length >= 1 && nonNeg(f.salePrice) && nonNeg(f.purchasePrice) && nonNeg(f.reorderLevel);
  const lockedTracking = !!item && item.trackInventory && item.qtyOnHand !== 0;

  const onCategory = (category: string) => {
    // Sensible defaults: produce you lay is quantity-only; services aren't stocked.
    const d = category === 'SERVICE' ? { trackInventory: false, valued: false } : category === 'PRODUCE' ? { trackInventory: true, valued: false } : category === 'LIVESTOCK' ? {} : { trackInventory: true, valued: true };
    set(item ? { category } : { category, ...d });
  };

  const submit = () => {
    const body = {
      sku: f.sku.trim(), name: f.name.trim(), nameBn: f.nameBn.trim() || null, category: f.category, unit: f.unit.trim(),
      salePrice: Number(f.salePrice || 0), purchasePrice: Number(f.purchasePrice || 0), trackInventory: f.trackInventory, valued: f.trackInventory && f.valued,
      reorderLevel: f.trackInventory ? Number(f.reorderLevel || 0) : 0,
      incomeAccountId: f.incomeAccountId || null, expenseAccountId: f.expenseAccountId || null, inventoryAccountId: f.trackInventory && f.valued ? f.inventoryAccountId || null : null, active: f.active,
    };
    if (item) update.mutate(body, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  return (
    <Drawer title={item ? t(`Edit item ${item.sku}`, `পণ্য ${item.sku} সম্পাদনা`) : t('New item', 'নতুন পণ্য')} subtitle={item ? item.name : t('Anything you buy, sell, produce or stock.', 'যা কেনেন, বিক্রি করেন, উৎপাদন বা মজুদ করেন।')} onClose={onClose}
      footer={<>
        <div className="left"><label className="check"><input type="checkbox" checked={f.active} onChange={e => set({ active: e.target.checked })} />{t('Active', 'সক্রিয়')}</label></div>
        <button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button>
        <button className="btn primary" disabled={!valid || busy} onClick={submit}>{item ? t('Save changes', 'পরিবর্তন সংরক্ষণ') : t('Create item', 'পণ্য তৈরি')}</button>
      </>}>
      <div className="form-grid three">
        <Field label={t('SKU', 'এসকেইউ')} hint={t('Unique short code', 'অনন্য ছোট কোড')}><Input value={f.sku} autoFocus={!item} maxLength={30} onChange={e => set({ sku: e.target.value.toUpperCase() })} placeholder="FEED-LAYER" /></Field>
        <Field label={t('Name (English)', 'নাম (ইংরেজি)')}><Input value={f.name} maxLength={100} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label={t('Name (Bangla)', 'নাম (বাংলা)')}><Input value={f.nameBn} maxLength={100} onChange={e => set({ nameBn: e.target.value })} /></Field>
        <Field label={t('Category', 'শ্রেণি')}><Select value={f.category} onChange={e => onCategory(e.target.value)} options={CATEGORIES.map(c => ({ value: c, label: categoryLabel(t, c) }))} /></Field>
        <Field label={t('Unit', 'একক')} hint={t('e.g. pcs, kg, bag, litre', 'যেমন পিস, কেজি, বস্তা, লিটার')}><Input value={f.unit} maxLength={20} onChange={e => set({ unit: e.target.value })} /></Field>
        <Field label={t('Reorder level', 'পুনঃঅর্ডার সীমা')} hint={t('Flag as low at or below this', 'এর সমান বা কম হলে "কম" দেখাবে')}><Input type="number" min="0" step="any" disabled={!f.trackInventory} value={f.reorderLevel} onChange={e => set({ reorderLevel: e.target.value })} /></Field>
        <Field label={t('Default sale price', 'বিক্রয় মূল্য')} hint={t(`Per ${f.unit || 'unit'}`, `প্রতি ${f.unit || 'একক'}`)}><Input type="number" min="0" step="any" value={f.salePrice} onChange={e => set({ salePrice: e.target.value })} /></Field>
        <Field label={t('Default purchase price', 'ক্রয় মূল্য')} hint={t(`Per ${f.unit || 'unit'}`, `প্রতি ${f.unit || 'একক'}`)}><Input type="number" min="0" step="any" value={f.purchasePrice} onChange={e => set({ purchasePrice: e.target.value })} /></Field>
      </div>

      <div className="card card-pad stack" style={{ background: 'var(--surface-2)' }}>
        <h3>{t('Stock tracking', 'মজুদ ট্র্যাকিং')}</h3>
        <label className="check"><input type="checkbox" checked={f.trackInventory} disabled={lockedTracking} onChange={e => set({ trackInventory: e.target.checked, valued: e.target.checked ? f.valued : false })} />{t('Track quantity on hand', 'হাতে থাকা পরিমাণ ট্র্যাক করুন')}</label>
        <label className="check"><input type="checkbox" checked={f.trackInventory && f.valued} disabled={!f.trackInventory || lockedTracking} onChange={e => set({ valued: e.target.checked })} />{t('Valued — carries purchase cost', 'মূল্যায়িত — ক্রয়মূল্য বহন করে')}</label>
        <small className="muted">
          {t('Valued: stock carries what you paid (feed, medicine bought). It sits in an inventory account and is expensed at average cost when used. ',
            'মূল্যায়িত: মজুদ ক্রয়মূল্য বহন করে (কেনা খাদ্য, ওষুধ)। এটি মজুদ হিসাবে থাকে এবং ব্যবহারের সময় গড় মূল্যে খরচ হয়। ')}
          {t('Unvalued (quantity only): you count it but it has no cost of its own — e.g. eggs you produce, whose cost was already expensed as feed.',
            'অমূল্যায়িত (শুধু পরিমাণ): গণনা হয় কিন্তু নিজস্ব মূল্য নেই — যেমন নিজের উৎপাদিত ডিম, যার খরচ খাদ্য হিসেবে আগেই খরচ হয়েছে।')}
        </small>
        {item && <Alert>{t('Tracking and valuation cannot be changed once the item has stock movements.', 'মজুদ চলাচল হয়ে গেলে ট্র্যাকিং ও মূল্যায়ন পরিবর্তন করা যায় না।')}</Alert>}
      </div>

      <div className="form-grid three">
        <Field label={t('Income account', 'আয়ের হিসাব')} hint={t('Blank = default sales account', 'খালি = ডিফল্ট বিক্রয় হিসাব')}><Select value={f.incomeAccountId} onChange={e => set({ incomeAccountId: e.target.value })} placeholder={t('— Default —', '— ডিফল্ট —')} options={incomeOpts} /></Field>
        <Field label={t('Expense account', 'খরচের হিসাব')} hint={t('Used when consumed or bought as an expense', 'ব্যবহার বা খরচ হিসেবে কেনার সময়')}><Select value={f.expenseAccountId} onChange={e => set({ expenseAccountId: e.target.value })} placeholder={t('— Default —', '— ডিফল্ট —')} options={expenseOpts} /></Field>
        <Field label={t('Inventory account', 'মজুদ হিসাব')} hint={f.trackInventory && f.valued ? t('Asset account holding its value', 'মূল্য যে সম্পদ হিসাবে থাকে') : t('Only for valued stock', 'শুধু মূল্যায়িত মজুদের জন্য')}><Select value={f.inventoryAccountId} disabled={!(f.trackInventory && f.valued)} onChange={e => set({ inventoryAccountId: e.target.value })} placeholder={t('— Default —', '— ডিফল্ট —')} options={inventoryOpts} /></Field>
      </div>
    </Drawer>
  );
}

// ───── Stock movements ─────
function Moves() {
  const { t, lang } = usePrefs();
  const items = useItems();
  const [range, setRange] = useState(thisMonth());
  const [itemId, setItemId] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<{ data: StockMove[]; total: number }>('/stock-moves', { ...range, itemId: itemId || undefined, type: type || undefined, page, pageSize: 50 });
  const rows = list.data?.data.map(m => ({ ...m, status: m.voided ? 'VOID' : undefined }));

  const columns: Column<StockMove & { status?: string }>[] = [
    { key: 'date', label: t('Date', 'তারিখ'), render: m => fmtDate(m.date, lang) },
    { key: 'item', label: t('Item', 'পণ্য'), render: m => <><b>{m.item.name}</b> <span className="mono muted small">{m.item.sku}</span></> },
    { key: 'type', label: t('Movement', 'চলাচল'), render: m => <>{moveLabel(t, m.type)}{m.voided && <> <Badge tone="red">{t('Void', 'বাতিল')}</Badge></>}</> },
    { key: 'qty', label: t('Quantity', 'পরিমাণ'), num: true, render: m => <b className={m.quantity >= 0 ? 'pos' : 'neg'}>{m.quantity > 0 ? '+' : m.quantity < 0 ? '−' : ''}{fmtNum(Math.abs(m.quantity), lang, 3)} <span className="small">{m.item.unit}</span></b> },
    { key: 'cost', label: t('Unit cost', 'একক মূল্য'), num: true, hideSm: true, render: m => (m.unitCost ? <Money v={m.unitCost} decimals={2} /> : <span className="muted">—</span>) },
    { key: 'value', label: t('Value', 'মূল্য'), num: true, render: m => (m.value ? <Money v={m.value} /> : <span className="muted">—</span>) },
    { key: 'notes', label: t('Notes', 'নোট'), hideSm: true, render: m => <span className="muted small">{m.notes || ''}</span> },
  ];

  const exportCsv = () => downloadCsv(`stock_moves_${range.from}_${range.to}.csv`, ['Date', 'SKU', 'Item', 'Type', 'Quantity', 'Unit', 'Unit cost', 'Value', 'Voided', 'Notes'],
    (list.data?.data ?? []).map(m => [iso10(m.date), m.item.sku, m.item.name, m.type, m.quantity, m.item.unit, m.unitCost, m.value, m.voided ? 'yes' : '', m.notes ?? '']));

  return (
    <Card title={t('Stock movements', 'মজুদ চলাচল')} subtitle={t('Every change to stock, with its source. Inflows are positive, outflows negative.', 'মজুদের প্রতিটি পরিবর্তন ও তার উৎস। প্রবেশ ধনাত্মক, বাহির ঋণাত্মক।')} actions={<>
      <Select style={{ width: 'auto' }} value={itemId} onChange={e => { setItemId(e.target.value); setPage(1); }} placeholder={t('All items', 'সব পণ্য')}
        options={(items.data?.data ?? []).filter(i => i.trackInventory).map(i => ({ value: i.id, label: `${i.sku} · ${itemName(lang, i)}` }))} />
      <Select style={{ width: 'auto' }} value={type} onChange={e => { setType(e.target.value); setPage(1); }} placeholder={t('All movements', 'সব চলাচল')} options={MOVE_TYPES.map(m => ({ value: m, label: moveLabel(t, m) }))} />
      <RangePicker value={range} onChange={r => { setRange(r); setPage(1); }} />
      <button className="btn" onClick={exportCsv} disabled={!list.data?.data.length}><Download size={16} />{t('Export', 'রপ্তানি')}</button>
    </>}>
      <DataTable rows={rows} columns={columns} page={page} pageSize={50} total={list.data?.total} onPage={setPage} empty={t('No stock movements in this period.', 'এই সময়ে কোনো মজুদ চলাচল নেই।')} />
    </Card>
  );
}

// ───── Adjust stock ─────
type AdjType = 'ADJUSTMENT' | 'GIFT' | 'WASTE' | 'OPENING';

function AdjustDrawer({ initialItemId, onClose }: { initialItemId?: string; onClose: () => void }) {
  const { t, lang } = usePrefs();
  const items = useItems();
  const tracked = (items.data?.data ?? []).filter(i => i.trackInventory && i.active);
  const [f, setF] = useState({ date: ymd(), itemId: initialItemId ?? '', type: 'ADJUSTMENT' as AdjType, direction: 'in' as 'in' | 'out', quantity: '', unitCost: '', notes: '' });
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));
  const item = tracked.find(i => i.id === f.itemId);
  const save = useSave('post', '/stock-adjustments', t('Stock adjusted.', 'মজুদ সমন্বয় হয়েছে।'));

  const qty = Number(f.quantity || 0);
  const outflow = f.type === 'GIFT' || f.type === 'WASTE' || (f.type === 'ADJUSTMENT' && f.direction === 'out');
  const signed = outflow ? -qty : qty;
  const showCost = !!item?.valued && (f.type === 'OPENING' || (f.type === 'ADJUSTMENT' && f.direction === 'in'));
  const after = item ? item.qtyOnHand + signed : null;
  const unitCost = showCost ? (f.unitCost === '' ? (f.type === 'ADJUSTMENT' ? item!.avgCost : 0) : Number(f.unitCost)) : item?.valued ? item.avgCost : 0;
  const value = Math.abs(qty) * unitCost;
  const valid = !!item && qty > 0 && !!f.date && (f.unitCost === '' || Number(f.unitCost) >= 0) && (f.type !== 'OPENING' || !item.valued || Number(f.unitCost) > 0);

  const typeHelp: Record<AdjType, string> = {
    ADJUSTMENT: t('Physical count differs from the system. Add found stock or remove shrinkage; the difference posts to inventory gain/loss.', 'বাস্তব গণনা সিস্টেমের সাথে মেলেনি। পাওয়া মজুদ যোগ বা ঘাটতি বাদ দিন; পার্থক্য মজুদ লাভ/ক্ষতিতে পোস্ট হবে।'),
    GIFT: t('Given away or used personally (e.g. eggs gifted). Removes stock at average cost.', 'উপহার বা নিজের ব্যবহারে দেওয়া (যেমন ডিম উপহার)। গড় মূল্যে মজুদ কমে।'),
    WASTE: t('Spoiled, broken or lost stock. Removes stock and books the loss.', 'নষ্ট, ভাঙা বা হারানো মজুদ। মজুদ কমে ও ক্ষতি লেখা হয়।'),
    OPENING: t('Stock you already had when you started using FarmLedger. Posts against opening balance equity.', 'FarmLedger শুরুর সময় যে মজুদ ছিল। প্রারম্ভিক মূলধনের বিপরীতে পোস্ট হয়।'),
  };

  const submit = () => save.mutate({
    date: f.date, itemId: f.itemId, type: f.type, quantity: signed,
    ...(showCost && f.unitCost !== '' ? { unitCost: Number(f.unitCost) } : {}),
    notes: f.notes.trim() || null,
  }, { onSuccess: onClose });

  return (
    <Drawer narrow title={t('Adjust stock', 'মজুদ সমন্বয়')} subtitle={t('For counts, gifts, waste and opening stock. Purchases, sales and production update stock on their own.', 'গণনা, উপহার, নষ্ট ও প্রারম্ভিক মজুদের জন্য। ক্রয়, বিক্রয় ও উৎপাদন নিজে থেকেই মজুদ হালনাগাদ করে।')} onClose={onClose}
      footer={<>
        {item?.valued && qty > 0 && <div className="left small">{t('Value', 'মূল্য')}: <b><Money v={outflow ? -value : value} /></b></div>}
        <button className="btn" onClick={onClose}>{t('Cancel', 'বাতিল')}</button>
        <button className="btn primary" disabled={!valid || save.isPending} onClick={submit}><PackagePlus size={16} />{t('Post adjustment', 'সমন্বয় পোস্ট')}</button>
      </>}>
      <Field label={t('Type', 'ধরন')} hint={typeHelp[f.type]}>
        <Select value={f.type} onChange={e => set({ type: e.target.value as AdjType, unitCost: '' })} options={(['ADJUSTMENT', 'GIFT', 'WASTE', 'OPENING'] as const).map(x => ({ value: x, label: moveLabel(t, x) }))} />
      </Field>
      <div className="form-grid">
        <Field label={t('Item', 'পণ্য')} className="full" hint={item ? t(`On hand: ${fmtNum(item.qtyOnHand, lang, 3)} ${item.unit}${item.valued ? ` · avg ${fmtMoney(item.avgCost, lang, { decimals: 2 })}` : ' · quantity only'}`, `হাতে: ${fmtNum(item.qtyOnHand, lang, 3)} ${item.unit}${item.valued ? ` · গড় ${fmtMoney(item.avgCost, lang, { decimals: 2 })}` : ' · শুধু পরিমাণ'}`) : undefined}>
          <Select value={f.itemId} onChange={e => set({ itemId: e.target.value, unitCost: '' })} placeholder={t('Choose a stock item…', 'মজুদ পণ্য বাছাই করুন…')}
            options={tracked.map(i => ({ value: i.id, label: `${i.sku} · ${itemName(lang, i)} (${fmtNum(i.qtyOnHand, lang, 3)} ${i.unit})` }))} />
        </Field>
        <Field label={t('Date', 'তারিখ')}><Input type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
        {f.type === 'ADJUSTMENT' ? (
          <Field label={t('Direction', 'দিক')}>
            <Segmented value={f.direction} onChange={v => set({ direction: v, unitCost: '' })} options={[{ value: 'in', label: t('+ Found', '+ পাওয়া') }, { value: 'out', label: t('− Shrinkage', '− ঘাটতি') }]} />
          </Field>
        ) : <div />}
        <Field label={t(`Quantity${item ? ` (${item.unit})` : ''}`, `পরিমাণ${item ? ` (${item.unit})` : ''}`)}
          hint={after !== null && qty > 0 ? t(`After: ${fmtNum(after, lang, 3)} ${item!.unit}`, `পরে: ${fmtNum(after, lang, 3)} ${item!.unit}`) : undefined}>
          <Input type="number" min="0" step="any" value={f.quantity} onChange={e => set({ quantity: e.target.value })} />
        </Field>
        {showCost && (
          <Field label={t('Unit cost', 'একক মূল্য')} hint={f.type === 'OPENING' ? t('Required — what each unit cost you', 'আবশ্যক — প্রতি এককের দাম') : t(`Blank = current average (${fmtMoney(item!.avgCost, lang, { decimals: 2 })})`, `খালি = বর্তমান গড় (${fmtMoney(item!.avgCost, lang, { decimals: 2 })})`)}>
            <Input type="number" min="0" step="any" value={f.unitCost} onChange={e => set({ unitCost: e.target.value })} />
          </Field>
        )}
        <Field label={t('Notes', 'নোট')} className="full"><textarea className="textarea" maxLength={300} value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder={t('Reason, who counted, etc.', 'কারণ, কে গণনা করেছেন ইত্যাদি')} /></Field>
      </div>
      {after !== null && after < 0 && qty > 0 && <Alert tone="warn">{t('This takes stock below zero. Check the quantity or record the missing purchase first.', 'এতে মজুদ শূন্যের নিচে যাবে। পরিমাণ যাচাই করুন বা আগে বাদ পড়া ক্রয়টি লিখুন।')}</Alert>}
      {items.data && !tracked.length && <Alert tone="warn">{t('No stock-tracked items. Turn on “Track quantity” for an item first.', 'কোনো মজুদযোগ্য পণ্য নেই। আগে কোনো পণ্যে "পরিমাণ ট্র্যাক" চালু করুন।')}</Alert>}
    </Drawer>
  );
}
