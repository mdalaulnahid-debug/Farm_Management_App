# FarmLedger ERP — architecture

## Overview

A **modular monolith**: one TypeScript API and one React SPA, deployed as a single service on port 4000. Simple to run on one farm computer, and ready to host for a team.

```
Browser (React SPA, en/bn) ──HTTPS──> Fastify API /api/v1 ──Prisma──> SQLite (single site) | PostgreSQL (hosted)
                                         │
                                         ├─ auth: sessions, RBAC guard on every route, audit log
                                         ├─ services: ledger · inventory · sales · purchases · payments · operations · reports
                                         └─ serves the built SPA in production
```

| Layer | Choice | Why |
|---|---|---|
| Web | React 19, TypeScript, Vite, TanStack Query, React Router, Recharts | Typed, fast, cached data fetching; one design system in `styles.css` with light/dark and density tokens. |
| API | Fastify 5, Zod validation, Helmet, rate limiting | Every input validated server-side; consistent error shape `{ error, message, details }`. |
| Data | Prisma ORM; SQLite by default, PostgreSQL for hosted | Same schema on both (string enums, DECIMAL money). |
| Auth | scrypt password hashes, opaque session tokens (SHA-256 at rest) in http-only SameSite cookies | No tokens readable by JavaScript; sessions revocable; lockout after 5 failures. |

## Accounting model

**The general ledger is the single source of truth.** Business documents are the user-facing records; each one posts a balanced `JournalEntry` inside the same database transaction (`tx()` in `src/db.ts`). Reports read only `JournalLine`s of `POSTED` entries.

| Event | Debit | Credit |
|---|---|---|
| Sales invoice | Accounts receivable (total), Sales discounts | Income account per line (egg sales, duck sales…) |
| … valued stock sold | Cost of goods sold | Inventory |
| Receipt from customer | Cash / bank | Accounts receivable |
| Purchase bill — stocked item | Inventory (feed, medicine…) | Accounts payable |
| Purchase bill / expense — other | Expense or asset account | Accounts payable |
| Payment to supplier | Accounts payable | Cash / bank |
| Production log — feed used | Feed expense | Feed inventory (weighted-average cost) |
| Gift / waste of valued stock | Inventory loss | Inventory |
| Opening stock | Inventory | Opening balance equity |
| Owner contribution / drawing, loan | Cash ↔ Owner capital / drawings / loan account | |
| Cash count variance (optional) | Cash ↔ Cash over/short | |
| Void | Mirror image of the original entry, same date; both marked VOID | |

Rules enforced in `src/services/ledger.ts`:
- Entries must balance to the paisa and have ≥ 2 non-zero lines.
- No posting on or before `Organization.lockDate` (period close).
- Voids reverse the journal, restore stock (`reverseStockForSource`) and payment allocations. Documents with live payments must have those voided first.

**Inventory** (`src/services/inventory.ts`): perpetual, weighted-average cost. *Valued* items (purchased feed, medicine) carry cost; *quantity-only* items (eggs you produce) carry no cost because their cost is already expensed as feed/labour when consumed. Issuing more than is on hand is blocked.

**Financial statements** (`src/services/reports.ts`):
- *P&L*: Sales − COGS = gross profit; − operating expenses = operating profit; + other income − other expenses = net profit.
- *Balance sheet*: assets = liabilities + equity, where equity includes retained earnings (prior fiscal years) and current-year profit computed from the ledger (no closing entries required).
- *Cash flow (direct)*: every movement on cash/bank accounts is classified by its counter accounts' `cashFlow` category (operating / investing / financing). Opening-balance entries count as opening cash.
- *Aging*: open invoices/bills by days past due (current, 1–30, 31–60, 61–90, 90+).

## Data model (main tables)

`Organization` (settings, fiscal year start, lock date) · `User`, `Role` (JSON permission list), `Session`, `AuditLog` · `Account` (chart of accounts, bilingual), `JournalEntry`, `JournalLine` · `Party` (customer / supplier / employee) · `Item`, `StockMove` · `SalesInvoice` + lines · `Bill` + lines · `Payment` + `PaymentAllocation` · `CashCount` · `Site`, `Flock`, `ProductionLog` · `Sequence` (gap-free document numbers INV-000001, BILL-…, EXP-…, RCPT-…, PAY-…, JE-…).

## Roles

| Role | Access |
|---|---|
| Owner / Administrator | Everything: users, roles, settings, period close, backups. |
| Farm Manager | Daily operations, sales, purchases, stock, reports; no users/settings/manual journals/audit. |
| Accountant | Books, journals, reconciliations, reports, voids; no users or production entry. |
| Data Entry Operator | Records production, sales, expenses; cannot void or see financial statements. |
| Viewer / Auditor | Read-only, including the audit trail. |

Permissions are editable per role in *Users & settings → Roles* (the owner role is fixed). The API checks permissions on every route (`can()` in `src/auth/auth.ts`).

## API

Versioned REST under `/api/v1`: `auth/*`, `users`, `roles`, `settings`, `accounts`, `parties`, `items`, `sites`, `flocks`, `cash-accounts`, `invoices`, `bills`, `payments`, `transfers`, `cash-counts`, `journals`, `stock-adjustments`, `stock-moves`, `production`, `dashboard`, `reports/{profit-loss,balance-sheet,cash-flow,trial-balance,general-ledger/:id,ar-aging,ap-aging,inventory,production}`, `audit`, `admin/backup`. Lists accept `from`, `to`, `search`, `status`, `page`, `pageSize`.

## Moving to PostgreSQL (hosted, multi-user at scale)

1. In `apps/api/prisma/schema.prisma` set `provider = "postgresql"`.
2. Set `DATABASE_URL=postgresql://user:pass@host:5432/farmledger` in `apps/api/.env`.
3. `npm run db:setup -w apps/api`.
4. Use the host's automated backups / `pg_dump` (the in-app backup button is for SQLite).

## Quality

`npm test` runs API integration tests against a throwaway database: authentication, permission enforcement, October reconciliation, weighted-average costing through production, partial payments and aging, void rules, unbalanced journal rejection, period lock, audit trail.

## Roadmap (next phases)

### Phase 2 — digital payments
Today bKash / Nagad / Rocket, card and bank payments are **recorded** with their transaction ID (method on every receipt and চালান).
Next: collect them **through** the app.
- bKash / Nagad merchant APIs and/or a gateway (SSLCommerz, aamarPay) for cards and wallets.
- Payment link and QR code printed on each চালান; the webhook marks it paid automatically.
- Daily settlement report matching gateway payouts to receipts (gateway fees posted to 7020 Bank & mobile charges).

### Phase 2 — barcode / POS sales
Groundwork in place: every item has an optional **barcode** field.
- Fast POS screen: a USB or Bluetooth scanner (acts as a keyboard) adds the item to the চালান; the buyer's phone links the sale to the customer.
- Printed barcode labels for egg trays/packs; thermal receipt printing.
- Stock updates instantly on every scan (already true for every sale).

### Later
1. **Payroll**: employees, attendance, monthly wages → wages payable.
2. **Fixed assets & depreciation** schedule posting monthly to 6080/1690.
3. **Budgets & feed planning** vs actuals; reorder suggestions from usage rate.
4. **Attachments** (receipt photos) in private object storage.
5. **SMS / WhatsApp**: send the চালান to the buyer's phone; due reminders.
6. **Multi-farm**: per-site stock locations and per-site P&L.
7. **Offline-first** mobile entry for production logs.
8. **Flock health**: vaccination schedule with reminders, linked to vaccine stock.

## Decisions for the farm owner

- **Bird count**: the seeded flock `FLK-01` has 0 birds because the workbook does not state it. Set it so laying rate and mortality % are meaningful.
- **Feed**: October feed purchases (BDT 31,505) were expensed directly because consumption was not recorded. From November, buy feed into stock (bill) and record usage in the daily production log. Confirm the unit (kg vs bag) of the reported 11,425 feed figure and enter it as opening stock if it is a quantity on hand.
- **Credit customers**: October credit sales are on one aggregate customer; split into named customers when known (receive payments against them).
- Treatment of donated eggs (currently quantity-only, no cost), labour (family labour not valued), and depreciation of sheds/ponds.
