export const formatMoney = (value, lang = 'en') => `BDT ${new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-BD', { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
export const formatNumber = (value, lang = 'en') => new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-BD').format(Number(value || 0));
export const toMonth = date => String(date || '').slice(0, 7);
export const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const openingBalances = {
  cash: -5410,
  receivables: 3480,
  payables: 0,
  eggs: 0,
  feed: 11425,
  ducks: 0,
};

const oldOctoberRows = [
  { date: '2026-10-27', sourceDate: '27/10/26', produced: 4993, cashEggs: 4229, creditEggs: 402, discount: 54, feed: 31505, snails: 23030, other: 350, medicine: 5234, donated: 362, loss: 0 },
  { date: '2026-10-28', sourceDate: '28/10/27', dateIssue: true, produced: 151, cashEggs: 148, creditEggs: 0, discount: 0, feed: 0, snails: 900, other: 0, medicine: 0, donated: 0, loss: 0 },
  { date: '2026-10-29', sourceDate: '29/10/26', produced: 152, cashEggs: 119, creditEggs: 0, discount: 0, feed: 0, snails: 900, other: 0, medicine: 0, donated: 36, loss: 0 },
  { date: '2026-10-30', sourceDate: '৩০/১০/২৬', produced: 144, cashEggs: 104, creditEggs: 40, discount: 0, feed: 0, snails: 900, other: 0, medicine: 0, donated: 0, loss: 0 },
  { date: '2026-10-31', sourceDate: '৩১/১০/২৬', produced: 0, cashEggs: 0, creditEggs: 0, discount: 0, feed: 0, snails: 900, other: 0, medicine: 0, donated: 0, loss: 0 },
];

const historicalSales = oldOctoberRows.filter(row => row.cashEggs + row.creditEggs > 0).map((row, index) => {
  const quantity = row.cashEggs + row.creditEggs;
  const rate = 16;
  const total = quantity * rate - row.discount;
  const cashReceived = row.cashEggs * rate - row.discount;
  return {
    id: `oct-sale-${index + 1}`, number: `OCT-S-${String(index + 1).padStart(3, '0')}`,
    type: 'sale', date: row.date, sourceDate: row.sourceDate, source: true,
    customer: 'October workbook summary', product: 'Duck eggs', quantity, rate,
    discount: row.discount, total, cashReceived, due: total - cashReceived,
    notes: row.dateIssue ? 'Source date retained as entered; normalized to 28 October 2026.' : 'Imported from October workbook.', status: 'posted',
  };
});

const historicalCosts = oldOctoberRows.flatMap((row, index) => [
  ['Feed purchase (historical)', row.feed, 'Inventory/cost treatment needs review'],
  ['Snails / supplementary feed', row.snails, ''],
  ['Transport / packaging / other', row.other, ''],
  ['Medicine / veterinary', row.medicine, ''],
].filter(([, amount]) => amount > 0).map(([category, amount, note], line) => ({
  id: `oct-cost-${index + 1}-${line}`, number: `OCT-C-${String(index * 4 + line + 1).padStart(3, '0')}`,
  type: 'cost', date: row.date, sourceDate: row.sourceDate, source: true,
  supplier: 'October workbook summary', category, amount, paidNow: amount, due: 0,
  classification: category.startsWith('Feed purchase') ? 'review' : 'expense', stockItem: category.startsWith('Feed purchase') ? 'Feed' : '', stockQuantity: null,
  notes: note || 'Imported from October workbook.', status: 'posted',
})));

historicalCosts.push({
  id: 'oct-cost-monthly-other', number: 'OCT-C-020', type: 'cost', date: '2026-10-31', source: true,
  supplier: 'October workbook summary', category: 'Other monthly costs', amount: 7000, paidNow: 7000, due: 0,
  classification: 'expense', stockItem: '', stockQuantity: null, notes: 'Monthly expense recorded in workbook.', status: 'posted',
});

const historicalReceipts = [
  { id: 'oct-receipt-ar', number: 'OCT-R-001', type: 'receipt', date: '2026-10-31', source: true, party: 'Opening receivable collection', category: 'Receivable collection', amount: 3480, allocation: 'receivable', notes: 'Monthly total from October workbook.', status: 'posted' },
  { id: 'oct-receipt-contribution', number: 'OCT-R-002', type: 'receipt', date: '2026-10-31', source: true, party: 'Farm contribution', category: 'Contribution', amount: 15000, allocation: 'other', notes: 'Monthly total from October workbook.', status: 'posted' },
];

const historicalMovements = oldOctoberRows.flatMap((row, index) => [
  row.produced > 0 && { id: `oct-egg-harvest-${index}`, date: row.date, item: 'Duck eggs', movement: 'harvest', quantity: row.produced, source: true, notes: 'Imported production quantity.' },
  row.donated > 0 && { id: `oct-egg-gift-${index}`, date: row.date, item: 'Duck eggs', movement: 'gift', quantity: row.donated, source: true, notes: 'Imported donation quantity.' },
  row.loss > 0 && { id: `oct-egg-loss-${index}`, date: row.date, item: 'Duck eggs', movement: 'waste', quantity: row.loss, source: true, notes: 'Imported egg loss.' },
].filter(Boolean));

const safeRead = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

function migrateLegacyRecords() {
  const old = safeRead('fl-records', []);
  const migratedRows = Array.isArray(old) ? old.filter(row => !row.source).flatMap((row, index) => {
    const quantity = Number(row.cashEggs ?? row.eggsSold ?? 0) + Number(row.creditEggs ?? 0);
    const rate = Number(row.price ?? row.unitPrice ?? 0);
    const discount = Number(row.discount || 0);
    const cashQuantity = Number(row.cashEggs ?? Math.max(0, Number(row.eggsSold || 0) - Number(row.creditEggs || 0)));
    const sales = quantity > 0 ? [{
      id: `migrated-sale-${index}-${row.date}`, number: `MIG-S-${index + 1}`, type: 'sale', date: row.date,
      customer: 'Migrated daily record', product: 'Duck eggs', quantity, rate, discount,
      total: quantity * rate - discount, cashReceived: Number(row.cashCollected ?? cashQuantity * rate - discount),
      due: Number(row.creditSales ?? Number(row.creditEggs || 0) * rate), notes: 'Migrated from previous daily-entry workflow.', status: 'posted',
    }] : [];
    const costs = [
      ['Feed purchase', row.feedPurchaseCost ?? row.feedPurchasedCost ?? 0, 'review'],
      ['Feed consumed', row.feedUsedCost ?? 0, 'expense'],
      ['Snails / supplementary feed', row.snails ?? 0, 'expense'],
      ['Transport / packaging / other', row.otherExpense ?? row.transport ?? 0, 'expense'],
      ['Medicine / veterinary', row.medicine ?? 0, 'expense'],
    ].filter(([, amount]) => Number(amount) > 0).map(([category, amount, classification], line) => ({
      id: `migrated-cost-${index}-${line}`, number: `MIG-C-${index + 1}-${line + 1}`, type: 'cost', date: row.date,
      supplier: 'Migrated daily record', category, amount: Number(amount), paidNow: Number(amount), due: 0,
      classification, notes: 'Migrated from previous daily-entry workflow.', status: 'posted',
    }));
    const movements = [
      Number(row.eggsProduced || 0) > 0 && { id: `migrated-harvest-${index}`, date: row.date, item: 'Duck eggs', movement: 'harvest', quantity: Number(row.eggsProduced), notes: 'Migrated production.' },
      Number(row.donated || 0) > 0 && { id: `migrated-gift-${index}`, date: row.date, item: 'Duck eggs', movement: 'gift', quantity: Number(row.donated), notes: 'Migrated donation.' },
      Number(row.spoiled || 0) > 0 && { id: `migrated-waste-${index}`, date: row.date, item: 'Duck eggs', movement: 'waste', quantity: Number(row.spoiled), notes: 'Migrated loss.' },
    ].filter(Boolean);
    const receipts = Number(row.oldCollection || 0) + Number(row.otherIncome || 0) + Number(row.cashGrant || 0) > 0 ? [{
      id: `migrated-receipt-${index}`, number: `MIG-R-${index + 1}`, type: 'receipt', date: row.date, source: false,
      party: 'Migrated daily record', category: Number(row.oldCollection || 0) ? 'Receivable collection' : 'Other receipt',
      amount: Number(row.oldCollection || 0) + Number(row.otherIncome || 0) + Number(row.cashGrant || 0),
      allocation: Number(row.oldCollection || 0) ? 'receivable' : 'other', notes: 'Migrated from previous daily-entry workflow.', status: 'posted',
    }] : [];
    return [...sales, ...costs, ...movements, ...receipts];
  }) : [];
  const oldExpenses = safeRead('fl-expenses', []);
  const migratedExpenses = Array.isArray(oldExpenses) ? oldExpenses.filter(row => !row.source && row.id !== 'october-monthly-other').map((row, index) => ({
    id: `migrated-expense-${row.id || index}`, number: `MIG-E-${index + 1}`, type: 'cost',
    date: row.date || '2026-11-01', supplier: 'Migrated expense record', category: row.category || row.description || 'Other',
    amount: Number(row.amount || 0), paidNow: row.paid === false ? 0 : Number(row.amount || 0),
    due: row.paid === false ? Number(row.amount || 0) : 0, classification: 'expense',
    notes: 'Migrated from previous expense module.', status: 'posted',
  })) : [];
  return [...migratedRows, ...migratedExpenses];
}

export const loadVouchers = () => {
  const saved = safeRead('farmledger-vouchers', null);
  return Array.isArray(saved) ? saved : [...historicalSales, ...historicalCosts, ...historicalReceipts, ...migrateLegacyRecords()];
};
export const loadStockMovements = () => {
  const saved = safeRead('farmledger-stock-movements', null);
  return Array.isArray(saved) ? saved : [...historicalMovements, ...migrateLegacyRecords().filter(row => row.movement)];
};
export const loadCashCounts = () => {
  const saved = safeRead('farmledger-cash-counts', []);
  return Array.isArray(saved) ? saved : [];
};
export const loadCustomers = () => {
  const saved = safeRead('farmledger-customers', []);
  return Array.isArray(saved) ? saved : [];
};
export const loadSuppliers = () => {
  const saved = safeRead('farmledger-suppliers', []);
  return Array.isArray(saved) ? saved : [];
};
export const loadOpeningBalances = () => {
  const modern = safeRead('farmledger-opening-balances', {}) || {};
  const legacy = safeRead('fl-settings', {}) || {};
  return {
    ...openingBalances,
    ...legacy,
    ...modern,
    cash: modern.cash ?? legacy.openingCash ?? openingBalances.cash,
    receivables: modern.receivables ?? legacy.openingReceivable ?? openingBalances.receivables,
    payables: modern.payables ?? legacy.openingPayables ?? openingBalances.payables,
    eggs: modern.eggs ?? legacy.openingEggStock ?? openingBalances.eggs,
    feed: modern.feed ?? legacy.openingFeedStock ?? openingBalances.feed,
    ducks: modern.ducks ?? legacy.openingDucks ?? openingBalances.ducks,
  };
};
export const loadPreferences = () => {
  const saved = safeRead('farmledger-preferences', {}) || {};
  return {
    fontSize: 15, density: 'comfortable', theme: safeRead('fl-theme', 'light'), language: safeRead('fl-lang', 'en'),
    ...saved,
    theme: saved.theme || safeRead('fl-theme', 'light'),
    language: saved.language || safeRead('fl-lang', 'en'),
  };
};

export const buildHistoricalOctober = () => ({ vouchers: [...historicalSales, ...historicalCosts, ...historicalReceipts], movements: historicalMovements });
