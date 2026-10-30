// Domain vocabulary shared by validation, services and seed data.

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_SUBTYPES = [
  'CASH', 'BANK', 'RECEIVABLE', 'INVENTORY', 'CURRENT_ASSET', 'FIXED_ASSET', 'BIOLOGICAL_ASSET',
  'PAYABLE', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY',
  'EQUITY',
  'SALES', 'OTHER_INCOME',
  'COGS', 'OPERATING_EXPENSE', 'OTHER_EXPENSE',
] as const;

export const CASH_FLOW = ['OPERATING', 'INVESTING', 'FINANCING'] as const;

/** Debit-normal account types: balance = debit − credit. Others: credit − debit. */
export const DEBIT_NORMAL: Record<AccountType, boolean> = {
  ASSET: true, EXPENSE: true, LIABILITY: false, EQUITY: false, INCOME: false,
};

/** System account codes used by automatic postings. Seeded and protected from deletion. */
export const SYS = {
  CASH: '1010',
  BANK: '1020',
  MOBILE: '1030',
  AR: '1100',
  INV_FEED: '1210',
  INV_MEDICINE: '1220',
  INV_PRODUCE: '1230',
  INV_SUPPLIES: '1240',
  LIVESTOCK: '1500',
  AP: '2010',
  OWNER_CAPITAL: '3010',
  OWNER_DRAWINGS: '3020',
  OPENING_EQUITY: '3900',
  RETAINED_EARNINGS: '3950',
  SALES_EGGS: '4010',
  SALES_LIVESTOCK: '4020',
  SALES_OTHER: '4090',
  SALES_DISCOUNT: '4900',
  OTHER_INCOME: '4500',
  COGS: '5010',
  FEED_EXPENSE: '6010',
  MEDICINE_EXPENSE: '6020',
  INVENTORY_LOSS: '6800',
  CASH_SHORTAGE: '6810',
} as const;

export const PARTY_KINDS = ['CUSTOMER', 'SUPPLIER', 'BOTH', 'EMPLOYEE'] as const;
export const ITEM_CATEGORIES = ['PRODUCE', 'FEED', 'MEDICINE', 'LIVESTOCK', 'SUPPLY', 'SERVICE'] as const;
export const PAYMENT_METHODS = ['CASH', 'BANK', 'MOBILE', 'CHEQUE'] as const;
export const ADJUSTMENT_TYPES = ['ADJUSTMENT', 'GIFT', 'WASTE', 'OPENING'] as const;

// ───────────── Permissions (RBAC) ─────────────

export const PERMISSIONS = {
  'dashboard.view': 'View dashboard',
  'sales.view': 'View sales & customers',
  'sales.create': 'Create invoices and receipts',
  'sales.void': 'Void invoices and receipts',
  'purchases.view': 'View purchases, expenses & suppliers',
  'purchases.create': 'Create bills, expenses and payments',
  'purchases.void': 'Void bills and payments',
  'banking.view': 'View cash & bank',
  'banking.manage': 'Transfers, cash counts, owner transactions',
  'inventory.view': 'View inventory',
  'inventory.manage': 'Manage items and stock adjustments',
  'production.view': 'View flocks and production',
  'production.manage': 'Record production and manage flocks',
  'accounting.view': 'View chart of accounts and journals',
  'accounting.manage': 'Manual journals, accounts, opening balances',
  'reports.view': 'View financial reports',
  'parties.manage': 'Create and edit customers/suppliers',
  'settings.manage': 'Organization settings and period close',
  'users.manage': 'Manage users and roles',
  'audit.view': 'View audit trail',
} as const;
export type Permission = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: Permission[] }[] = [
  { key: 'owner', name: 'Owner / Administrator', description: 'Full access including users, settings and period close.', permissions: ALL },
  {
    key: 'manager', name: 'Farm Manager', description: 'Runs daily operations, sales, purchases and stock. No security administration.',
    permissions: ALL.filter(p => !['users.manage', 'settings.manage', 'accounting.manage', 'audit.view'].includes(p)),
  },
  {
    key: 'accountant', name: 'Accountant', description: 'Books, reconciliations, journals and reports.',
    permissions: ALL.filter(p => !['users.manage', 'production.manage'].includes(p)),
  },
  {
    key: 'operator', name: 'Data Entry Operator', description: 'Records daily production, sales and expenses. Cannot void or see financial statements.',
    permissions: ['dashboard.view', 'sales.view', 'sales.create', 'purchases.view', 'purchases.create', 'inventory.view', 'production.view', 'production.manage', 'banking.view'],
  },
  {
    key: 'viewer', name: 'Viewer / Auditor', description: 'Read-only access to records, reports and the audit trail.',
    permissions: ALL.filter(p => p.endsWith('.view')),
  },
];
