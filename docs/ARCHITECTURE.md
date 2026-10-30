# FarmLedger architecture and product rules

## Product boundary

The current local prototype supports one duck-and-egg farm, BDT, and English/Bangla. Its entry model is voucher-first: sales vouchers create revenue and customer balances; cost vouchers create expense/payable and cash movements; stock movements record harvest, gifts, waste, feed use, and bird counts; physical cash counts reconcile the book balance. The present browser-only implementation is a foundation, not a production multi-user system.

## Financial views

Keep these figures separate throughout the UI and API:

1. **Cash movement (cash basis):** customer cash received minus farm cash expenses paid for the period. Collections of earlier credit sales increase cash, but do not create new sales revenue.
2. **Realized operating profit (accrual estimate):** sales earned in the period plus other farm income, less operating costs consumed/incurred in the period. Credit sales count when sold. Feed is expensed when consumed, not when purchased. Feed inventory purchases affect cash and stock, not the profit figure until used.
3. **Projected profit:** expected eggs sold × expected selling price + other expected income − forecast operating costs. Label it as an estimate; keep it out of posted actuals and cash balances.

Core calculator formula:

```text
Revenue earned = eggs sold × realized average selling price − discounts + other earned income
Operating costs = feed consumed + medicine/vet + labor + transport/packaging + other operating costs
Realized operating profit = revenue earned − operating costs
Profit margin = realized operating profit ÷ revenue earned (when revenue is non-zero)
```

Capital purchases, owner contributions, loans, and owner withdrawals should not be silently classified as operating expense or income. They belong to separate accounting transaction types. Donations and spoilage reduce egg stock; their accounting treatment should be configurable and visible.

## What the supplied workbook indicates

The workbook has one daily sheet with production, egg sales, expense categories, cash collected, receivables, and egg stock. October rows are actual history and remain in the app under October 2026; they are not treated as November entries. The period selector defaults to November 2026. October ending balances roll forward as November opening balances: BDT 15,897 cash, BDT 7,072 receivables, 0 eggs, and 11,425 feed quantity (unit to be confirmed). One date is entered as 28/10/27; it is normalized to 28 October 2026 for sequential calculations and the source text remains flagged. The workbook sales formulas use produced eggs in some rows, while its cash ledger separately records eggs sold. FarmLedger calculates sales from sold quantities. Feed consumption is missing, so October profit remains incomplete until that cost is supplied.

The redesigned local prototype includes an overview, sales and cost vouchers, cash ledger, stock movements, customer/supplier lists, CSV export, and customizable language, theme, font size, and density. Values are recalculated from saved transactions. October remains visible as historical source data, and the November opening values carry forward from it. Browser local storage is the current persistence layer; the application has no authentication, database, multi-user synchronization, or automatic backups. Feed consumption value and inventory costing still need farm-owner review before profit reporting can be treated as authoritative.

The October rows total 5,440 eggs produced and 5,042 eggs sold. At BDT 16 per egg, less the BDT 54 discount, net sales are BDT 80,618. Cash sales after discount are BDT 73,546; the workbook also records BDT 3,480 collected against earlier receivables. Daily logged expenses total BDT 63,719; the monthly other-cost entry is BDT 7,000. The source cached receivable formula is inconsistent, so the app carries BDT 7,072 as the transparent result of opening receivables + new credit sales − old debt collected. Feed stock is carried at the workbook-reported 11,425, with the quantity unit requiring confirmation.
## Proposed production architecture

Start with a **modular monolith**. It is easier to operate for a small farm team and leaves clean module boundaries for later scaling.

- **Web:** React + TypeScript + Vite SPA. Feature areas: dashboard, daily operations, sales/receivables, expenses, inventory, profit/reports, and administration. Use a typed API client and shared design tokens.
- **API:** FastAPI, organized by domain routers and service layer. Validate all inputs server-side; compute posted financial values on the server. Frontend calculations are previews only.
- **Database:** PostgreSQL. Use UUID primary keys, `numeric`/decimal for money, explicit date fields, UTC timestamps for audit events, and immutable IDs. Store BDT amounts as decimal currency values, not floating-point numbers.
- **Authentication:** short-lived access tokens with secure refresh/session handling, password reset, optional MFA later. Enforce authorization on every API operation, not only in the UI.
- **Hosting:** one private HTTPS web deployment with managed PostgreSQL, automated encrypted backups, error logging, and environment-separated secrets. Keep farm identity in every business record from the first schema migration.
- **Files:** receipt attachments in private object storage, with access checks and retention controls. Do not store public URLs for private records.
- **Scale path:** multiple farm sites, background report exports, scheduled alerts, and read-optimized reporting can be added without splitting the modular monolith prematurely.

## Database domains and first entities

| Domain | Initial entities | Main rules |
|---|---|---|
| Organization | `organizations`, `farms`, `farm_units` | One owner organization and one site initially; every operational record belongs to a farm. |
| Access | `users`, `memberships`, `roles`, `permissions`, `audit_events` | A user can have farm-scoped roles. Never rely on frontend-only access checks. |
| Operations | `daily_batches`, `production_records`, `stock_movements` | Record production, broken/donated eggs, opening and closing egg stock, and units. |
| Sales | `customers`, `sales`, `sale_lines`, `receipts`, `receivable_allocations` | Sale date, quantity, price, discount, payment terms, collection date, and allocations remain distinct. |
| Expenses | `suppliers`, `expenses`, `expense_lines`, `payments` | Record incurred date, payment date, category, purpose, and whether it is operating, capital, financing, or owner activity. |
| Inventory | `items`, `inventory_movements`, `stock_counts`, `cost_layers` | Feed purchases add stock; feed use removes stock and posts consumed cost. Use a documented costing method. |
| Planning | `forecast_scenarios`, `forecast_inputs` | Forecast records are versioned and never included in realized actuals. |
| Reporting | SQL views/materialized summaries as needed | Reports derive from posted transactions and reconcile to source records. |

### First schema constraints

- Every row includes `organization_id`, `farm_id`, `created_by`, `created_at`, `updated_by`, `updated_at`; posted/closed rows also retain posting metadata.
- Money uses `NUMERIC(14,2)` (or a reviewed precision appropriate to BDT use). Quantities use explicit units and a suitable decimal precision.
- Use soft deletion only for setup records where appropriate. Financial transactions are voided/reversed with a reason, never silently deleted.
- Add database constraints for non-negative quantities, unique membership, valid farm ownership, and valid posting states.
- Keep source import batches and original row references so imported records can be audited and re-imports deduplicated.

## Roles for the first team

| Role | Access |
|---|---|
| Owner / administrator | Farm settings, user/role management, all financial and operational records, approvals, reports, and period close. |
| Farm manager | Daily operations, sales, inventory, expenses, and operational reports; no security administration. |
| Accountant | Sales, receipts, expenses, inventory valuation, reconciliations, reports, and period close preparation. |
| Data entry operator | Create daily entries and attach source documents; edit own unposted records within policy. |
| Viewer / auditor | Read-only access to explicitly granted records and audit history. |

For the initial 1–5 users, role assignment can stay simple. Add approval thresholds, maker-checker separation, and site-scoped delegation as the team grows.

## API shape

Use versioned REST endpoints with organization/farm authorization from the authenticated membership:

```text
/api/v1/farms
/api/v1/daily-entries
/api/v1/production
/api/v1/sales and /api/v1/receipts
/api/v1/expenses and /api/v1/payments
/api/v1/inventory/items and /api/v1/inventory/movements
/api/v1/reports/dashboard, /api/v1/reports/profit, /api/v1/reports/cash
/api/v1/users, /api/v1/memberships, /api/v1/audit-events
```

Daily entry should be a convenience command that creates linked production, sale, receipt, expense, and inventory movements in one database transaction. The API must validate quantities and stock effects and return a reconciliation summary. Keep each persisted transaction independently reportable and auditable.

## Release sequence

1. Confirm opening balances, customers, products, units, and feed inventory from the owner’s records.
2. Implement schema, authentication, farm membership, audit events, and reference data.
3. Implement daily entry with server-side validation, sales/receipts, expense categories, and egg/feed stock movements.
4. Implement Excel import mapping and reconciliation preview before posting imported rows.
5. Implement dashboard and the three separately defined financial views, then exportable reports.
6. Add approvals, period close, backups/restore drills, and multi-site support before broad staff rollout.

## Decisions still needed before production accounting

- Feed item units, opening quantity/value, purchase unit cost, and how to handle mixed feed batches. Proposed initial costing method: weighted average, subject to confirmation.
- Whether to include labor, utilities, farm rent, and depreciation, and how unpaid/family labor should be valued.
- Treatment/value of donated eggs, spoilage, and other non-sale output.
- Opening cash, customer receivables, supplier payables, and feed/egg stock balances.
- Whether daily entry should support multiple egg prices/customers and partial collections on one date (recommended: yes, with a quick-entry summary that can expand to details).
- Hosting provider, data residency/backups, and whether the site must support offline entry during internet outages.
