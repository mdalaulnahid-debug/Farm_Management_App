# FarmLedger ERP

Business management and accounting software for a farm (built first for a duck & egg farm in Bangladesh). It covers the whole business — sales, purchases and expenses, cash and bank, inventory, daily production, and full double-entry accounting with real financial statements — in English and বাংলা.

## What it does

| Area | Features |
|---|---|
| **Dashboard** | Revenue, expenses, net profit and margin, cash & bank, receivables, payables, eggs collected, laying rate, 12-month income-vs-expense trend, expense breakdown, daily egg chart, stock on hand, top customers, overdue/low-stock alerts, recent activity. |
| **Sales** | Sales invoices with multiple lines and discounts, cash/credit/partial payment at the counter, receipts allocated to invoices (oldest first), customer statements, receivables aging, printable invoices. |
| **Purchases & expenses** | Supplier bills and quick cash expenses, payables, supplier payments, payables aging. Feed and other stocked items go into inventory; everything else is expensed to the chosen account. |
| **Cash & bank** | Cash, bank and mobile-banking (bKash/Nagad) accounts, receipts and payments register, transfers, owner capital/drawings, loans, physical cash counts with variance posting. |
| **Production** | Flocks (bird counts, survival), daily production log: eggs collected/broken, mortality and culls, feed consumed. Laying rate, feed per egg and feed cost per egg. |
| **Inventory** | Items master, perpetual stock with weighted-average cost, stock ledger, adjustments (gifts, waste, shrinkage, opening stock), low-stock alerts. |
| **Accounting** | Farm chart of accounts (bilingual), general ledger per account, journal entries, manual and opening-balance journals, period close (lock date). |
| **Reports** | Profit & loss (with previous-period comparison), balance sheet, cash flow (direct method), trial balance, AR/AP aging, inventory valuation, production performance. Print/PDF and CSV (Excel-ready, Bangla-safe). |
| **Administration** | Users, five built-in roles with an editable permission matrix, organization settings, fiscal year (July–June default), period lock, full audit trail, database backup download. |

### Accounting integrity

- Every document (invoice, bill, receipt, payment, production log, stock adjustment, transfer) posts a **balanced double-entry journal** in the same database transaction as the document and its stock movements. Reports are computed only from the ledger, so they always reconcile.
- Posted records are **never deleted** — they are voided with a reason, which posts a reversing entry and restores stock and balances. Invoices/bills with live payments cannot be voided until the payments are.
- **Period close**: nothing can be posted, voided or back-dated on or before the lock date.
- Money is stored as exact decimals; selling more stock than is on hand is blocked.
- Feed is expensed **when consumed** (through the production log), not when bought, so monthly profit reflects real cost.

### Security

- Sign-in with scrypt-hashed passwords, server-side sessions in http-only cookies, lockout after 5 failed attempts, forced password change on first sign-in and after resets.
- Role-based access enforced on **every API endpoint** (the UI only hides what the role cannot use).
- Audit trail of every create, void, sign-in, settings and user change.

## Daily use

| When | Who | What they do in FarmLedger |
|---|---|---|
| Every morning/evening | Farm worker / operator | **New → Daily production**: eggs collected, broken, deaths, feed used. |
| Every sale | Whoever sells | **New → Sales invoice (চালান)**: type the buyer's mobile number — a returning customer is recognised, a new one is added to the customer list with the name you type. Choose *paid in full*, *part payment* or *on credit*, and how they paid (cash, bKash/Nagad/Rocket, card, bank). |
| Every expense | Whoever pays | **New → Expense**: what it was for and the amount (paid now). For things bought on credit or into stock (feed), use **New → Purchase bill**. |
| When a buyer pays old dues | Manager | **New → Receive payment** and apply it to their open চালান. |
| When paying a supplier | Manager | **New → Pay supplier**. |
| When medicine, vaccine, trays etc. are used | Farm worker | **New → Use stock**: item and quantity; it leaves stock and is booked as that expense. |
| End of day | Manager | **Cash & bank → Cash count**: count the cash box; the app shows any shortage/excess. |
| Weekly | Owner | Dashboard, receivables (who owes us), low feed stock. |
| Monthly | Manager | **Inventory → Use / count stock → Physical stock count**: enter what is actually there; only the difference is posted. |
| Month end | Owner / accountant | Reports → P&L, balance sheet, cash flow; download a backup; **close the month** (period lock). |

All bookkeeping (journals, ledgers, receivables, payables, stock, profit) is produced automatically from these entries.

**Display settings** (any user, only affects their own screen): sidebar → *Display & language*, or the user menu → A− / A+. Language, light/dark theme, accent colour, text size and row density.

## Importing past months (backlog)

*Users & settings → Import past data.* Upload a month in the same workbook layout as the October sheet. The app shows a preview, checks its closing cash against the sheet, and only posts when you press **Import**. If that month already has records, tick *Replace existing records* (they are voided, not deleted). Every import can be undone from **Import history**.

## Run it on Windows (single computer or office network)

1. Install [Node.js 20+](https://nodejs.org).
2. Double-click **`start-farmledger.bat`**. The first run installs, creates the database (`apps/api/prisma/farmledger.db`), loads the chart of accounts and the October 2026 workbook history, and builds the app.
3. Open <http://localhost:4000>. Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `apps/api/.env` (default `owner@farm.local` / `ChangeMe!2026`); you will be asked to set a new password.
4. Other devices on the same network (phones, laptops) can open `http://<this-computer's-IP>:4000`.

**Back up regularly:** *Users & settings → Organization → Download backup* (or copy `apps/api/prisma/farmledger.db` while the app is stopped).

## Develop

```bash
npm run setup     # install + create database + seed
npm run dev       # API on :4000, web on :5173 (proxying /api)
npm test          # API integration tests (accounting, permissions, voids, period lock)
npm run build     # production build; `npm start` serves everything on :4000
```

## Deploy (cloud / server)

`docker compose up -d --build` runs the production image on port 4000 with the database on a persistent volume. Put it behind HTTPS (Caddy, Nginx, or your host's load balancer) and set a strong `ADMIN_PASSWORD`. For multiple sites or heavy use, switch to PostgreSQL — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project layout

```
apps/api   Fastify + Prisma API (TypeScript) — auth, RBAC, ledger, documents, reports
  prisma/schema.prisma   database schema
  src/services/          ledger, inventory, sales, purchases, payments, operations, reports
  src/routes/            REST endpoints under /api/v1
  test/                  integration tests
apps/web   React + TypeScript SPA — dashboard, modules, reports (English / বাংলা, light/dark)
docs/      architecture and accounting notes
upload/    October 2026 source workbook
```

## October 2026 history

The October workbook is imported through the same posting services as live data. Closing figures reconcile exactly with the workbook: cash BDT 15,897, receivables BDT 7,072, net sales BDT 80,618, expenses BDT 70,719, net profit BDT 9,899 (the integration tests assert these). Items for the owner to confirm are listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#decisions-for-the-farm-owner).
