# FarmLedger ERP — roadmap

Prioritised delivery plan, owned by the chief engineer and approved by the farm owner. Written 2026-10-31 after an audit of `main` at PRs #1–#4. Sizes are rough: **S** ≈ 1–2 days of focused work, **M** ≈ 3–5 days, **L** ≈ 1–2 weeks, **XL** = several pieces of L.

The order is: **protect what exists → fix what is fragile → build the cow business → collect money digitally → everything else.**

---

## 1. Audit summary (2026-10-31)

### What is solid

- Clean modular monolith with a clear direction: routes → services → ledger/inventory → lib.
- Every financial document posts a balanced entry through one function (`postEntry`), inside one transaction, with period lock, voids by reversal, gap-free numbers and an audit row.
- Permission guard on every route; scrypt passwords, hashed session tokens in http-only cookies, login lockout and rate limiting.
- Consistent-copy SQLite backup (`VACUUM INTO`), additive schema policy, idempotent reference data.
- Web pages all use the kit's drawers and dialogs, the shared `<Money>` formatter and `t()`; none calls `fetch()` directly.

### Risks and technical debt (highest first)

| # | Risk | Where | Impact | Fix (roadmap item) |
|---|---|---|---|---|
| R1 | **No CI.** Nothing stops a broken type check, failing test or build from reaching `main`. | repo | High — every future PR depends on it | P0-1 |
| R2 | **Voiding a purchase after its stock was used drives stock negative**, and voiding a sale restores quantity at today's average cost while the ledger restores the original cost. The stock list and the ledger's inventory balance can drift apart silently. | `inventory.ts › reverseStockForSource`, `voidBill`, `voidInvoice` | High — wrong stock value and COGS | P0-3 |
| R3 | **Backups are manual only.** One SQLite file on one PC; if the disk dies, everything since the last manual download is lost. | `admin/backup`, launcher | High — total data loss | P0-2 |
| R4 | **Lost updates on PostgreSQL.** `Item.qtyOnHand/avgCost` and `amountPaid` on invoices/bills are read-then-written. SQLite serialises writes so today's single-PC install is safe; on PostgreSQL two people saving at once can corrupt stock or over-collect an invoice. | `inventory.ts`, `payments.ts` | High once hosted; none today | P1-2 (before any PostgreSQL move) |
| R5 | **"PostgreSQL-ready" is untested.** Tests only run on SQLite. `contains` search is case-insensitive on SQLite but case-sensitive on PostgreSQL; Decimal columns have no precision set; the backup button is SQLite-only. | schema, routes | Medium | P1-2 |
| R6 | **SQLite stores DECIMAL as floating point.** Exact on PostgreSQL, approximate on SQLite; mitigated by rounding with `money.ts` everywhere. Sums of thousands of lines can be off by a paisa before rounding. | schema | Low–medium | P1-3 (invariant tests catch it) |
| R7 | **Plain HTTP on the farm network.** The server listens on `0.0.0.0:4000`; the session cookie is `secure` only when `NODE_ENV=production`, and the launcher runs in development mode. Anyone on the Wi-Fi can read a session cookie. Helmet's Content-Security-Policy is switched off; `trustProxy: true` lets a client fake its IP to dodge the login rate limit when not behind a proxy. | `server.ts`, `.env.example`, launcher | Medium (small trusted network today) | P1-4 |
| R8 | **Test coverage is thin for a ledger.** 20 integration tests, one file, one shared database. Missing: a 403 test per permission, void-and-compare tests for every document type, project tagging on bills/production, AR aging "as of" a past date (it uses today's `amountPaid`), and ledger invariants (trial balance, balance sheet, inventory vs ledger). No web tests. | `apps/api/test` | Medium | P1-3 |
| R9 | **Web pages drifted apart.** Duplicated invoice/bill detail drawers (Sales ≈ Purchases); Accounting and Reports hand-write tables with fixed pixel widths; Admin has its own Bangla arrays instead of `t()`; Banking re-implements the payment-method list; raw enum values (`MOBILE`) shown in payment rows; ~13 inline `nameBn` ternaries; hex colours in Login. | `apps/web/src/pages` | Low–medium (maintenance cost, small mobile glitches) | P1-5 |
| R10 | **Customer lookup loads every customer** to match a phone number. Fine for hundreds, slow for tens of thousands. | `sales.ts › resolveCustomer` | Low | store `phoneNormalized` + index, with P1-2 |

---

## 2. Phases

### Phase 0 — protect what exists (do first, ~1 week)

| ID | Item | Size | Depends on | Notes |
|---|---|---|---|---|
| P0-1 | **CI pipeline** (GitHub Actions): install, API + web type check, API tests, web build on every PR and on `main`. Required check before merge. | S | — | Ubuntu runner, Node 20, SQLite. Cache npm. Later add a PostgreSQL job (P1-2). |
| P0-2 | **Automatic daily backup**: on start and every night, `VACUUM INTO` a dated file in a `backups/` folder (keep 30 days); a screen showing the last backup; owner guidance to copy to a USB drive or Google Drive. Restore instructions in README. | S | — | Never touches the live file except to read it. |
| P0-3 | **Inventory void safety**: refuse to void a bill whose received stock has since been used (or post the cost difference explicitly); make voided sale/usage returns post at the cost they left at; add an *Inventory vs ledger* check to Reports and to the tests. | M | P0-1 | Accounting change — chief engineer reviews postings line by line. |

### Phase 1 — harden (~2 weeks, can overlap Phase 2)

| ID | Item | Size | Depends on | Notes |
|---|---|---|---|---|
| P1-1 | **Test suite split and coverage**: one file per area; shared helpers; a permission matrix test (every write route × viewer/operator → 403). | M | P0-1 | Unblocks safe juniors' work. |
| P1-2 | **PostgreSQL readiness**: row locking (`SELECT … FOR UPDATE` via `$queryRaw`) or atomic increments for stock and paid amounts; `@db.Decimal(18,2)`/`(18,4)` precision behind a PostgreSQL schema variant; case-insensitive search helper; CI job running the suite on PostgreSQL. | L | P1-1 | Only needed before hosting for multiple sites. Not urgent for one PC. |
| P1-3 | **Ledger invariant tests**: after each scenario, trial balance = 0, balance sheet balances, inventory valuation = ledger inventory accounts, AR/AP subledger = control accounts; AR aging as of a past date. | S | P1-1 | Catches R2/R6 class bugs automatically. |
| P1-4 | **Network security**: secure cookie whenever served over HTTPS; turn on a Content-Security-Policy; `trustProxy` only when configured; optional HTTPS on the farm PC (self-signed or Tailscale) for phones on Wi-Fi; session list + "sign out everywhere". | M | — | |
| P1-5 | **UI consistency pass**: one shared document-detail component for invoices/bills; Accounting and Reports tables on `DataTable`; Admin strings through `t()`; one `nameOf(record)` Bangla helper; payment-method labels from the kit; utility classes in `styles.css` replacing repeated inline styles; check every page at 375 px. | M | — | Pure web; no API change. Good first junior task. |

### Phase 2 — cow business (next big feature, ~4–6 weeks)

Design notes are in `docs/ARCHITECTURE.md → Projects → Planned: cow module`. Built in four PRs, each usable on its own. All lines tagged with project **COW**.

| ID | Item | Size | Depends on | Accounting |
|---|---|---|---|---|
| P2-1 | **Animal register + herds**: tag no., breed, sex, birth/purchase date, cost, status (milking, dry, heifer, fattening, sold, dead); photos later. Death/sale writes status, not delete. | M | P0-1 | Purchase of a breeding cow: Dr 1500 Livestock / Cr AP or Cash. |
| P2-2 | **Dairy**: morning/evening milk log per cow or herd → milk stock (quantity-only, like eggs) → milk sales চালান (reuses the sales service); fodder/feed usage expensed at average cost to COW. KPIs: litres per cow per day, feed cost per litre. | M | P2-1 | Same as eggs: no cost on milk; feed expensed when used. |
| P2-3 | **Fattening batches**: buy a batch → capitalised per animal; feed/medicine/labour for the batch capitalised to the batch (Dr *new* 1510 Livestock – fattening batches / Cr Inventory or Cash; account added in `reference.ts`); on sale, the animal's accumulated cost moves to COGS → profit per animal and per batch; weight records for daily gain. | L | P2-1 | New capitalisation flow — needs its own void path and invariant test. |
| P2-4 | **Health schedule**: vaccination/deworming plan per animal or herd; due list on the dashboard; medicine issued from stock. Reused later for duck flock health. | S | P2-1 | Medicine usage = existing USAGE adjustment. |
| P2-5 | **Cow reports**: project P&L (already works), dairy report, batch profitability report. | S | P2-2, P2-3 | Read-only. |

### Phase 3 — getting paid digitally (~3–4 weeks)

| ID | Item | Size | Depends on | Notes |
|---|---|---|---|---|
| P3-1 | **Payment link + QR on the চালান** through one gateway (recommend **SSLCommerz** first: one integration covers bKash, Nagad, Rocket and cards; direct bKash merchant API later if fees justify it). Webhook verifies and posts the receipt automatically; gateway fee posted to 7020. | L | P1-4 (HTTPS), public URL | **Needs the owner**: merchant account, business documents, and a public HTTPS address (hosting or a tunnel). Idempotent webhook; sandbox keys only in tests. |
| P3-2 | **Settlement report**: gateway payouts matched to receipts; fees and differences. | S | P3-1 | |
| P3-3 | **SMS / WhatsApp**: send the চালান and due reminders to the buyer's phone (BD SMS gateway first — cheap and reliable; WhatsApp Business API later). Opt-out respected; every send logged. | M | — | Outward-facing; owner approves templates and the provider (cost per SMS). |

### Phase 4 — operations and planning (pick by owner priority)

| ID | Item | Size | Depends on | Notes |
|---|---|---|---|---|
| P4-1 | **Barcode / POS sales screen**: scan (USB/Bluetooth scanner acts as a keyboard) → line on the চালান; buyer by phone; thermal receipt print; tray labels. `Item.barcode` already exists. | M | P1-5 | Mainly a fast web screen over the existing sales service. |
| P4-2 | **Receipt photo attachments** on bills, expenses and payments; stored on disk next to the database (included in backups) or object storage when hosted; size/type limits. | M | P0-2 | |
| P4-3 | **Fixed assets & depreciation**: asset register (sheds, ponds, pumps), monthly straight-line depreciation posted to 6080 / 1690; disposal. | M | P1-3 | |
| P4-4 | **Payroll**: employees (Party kind EMPLOYEE exists), attendance, monthly wages → wages payable → payment; advances. | L | P1-3 | Per project (duck/cow) for correct project P&L. |
| P4-5 | **Budgets & feed planning**: monthly budget per account/project vs actual; feed usage rate → days of stock left and reorder suggestion. | M | — | |
| P4-6 | **Offline-first production entry**: installable web app (PWA) that saves daily egg/feed logs on the phone when there is no signal and syncs later, with duplicate protection. | L | P1-4 | Highest complexity per screen; do after the rest is stable. |
| P4-7 | **Multi-farm / sites**: per-site stock locations and per-site P&L. | L | P1-2 | Only if the farm opens a second site. |

---

## 3. Dependency picture

```
P0-1 CI ──┬─> P0-3 Inventory void safety ──> P1-3 Invariant tests
          ├─> P1-1 Test split ──┬─> P1-2 PostgreSQL readiness ──> P4-7 Multi-farm
          │                     └─> P1-3
          └─> P2-1 Animals ──┬─> P2-2 Dairy ──┐
                             ├─> P2-3 Fattening ┴─> P2-5 Cow reports
                             └─> P2-4 Health
P0-2 Backups ──> P4-2 Attachments
P1-4 Network security ──> P3-1 Payment links ──> P3-2 Settlement
P1-5 UI pass ──> P4-1 POS
```

## 4. First assignments for junior developers

Run in parallel, each in its own worktree and branch, no shared files:

| Junior | Item | Owns | Why first |
|---|---|---|---|
| A | P0-1 CI pipeline | `.github/workflows/ci.yml`, root `package.json` scripts | Every later PR needs it. |
| B | P0-2 Automatic daily backup | `apps/api/src/services/backup.ts` (new), backup route in `routes/reports.ts`, `start-farmledger.bat`, README section, one Admin card | Protects the owner's data now. |
| C | P1-5 UI consistency pass (part 1: Sales/Purchases detail drawer, Banking methods, Admin `t()`) | `apps/web/src/pages/{Sales,Purchases,Banking,Admin}.tsx`, `components/forms.tsx` | Pure web, low risk, sets the standard before the cow screens are built. |

**P0-3 (inventory void safety)** is accounting-critical; it goes to a junior after CI lands, with a tight brief and a line-by-line posting review.

Then **Phase 2 (cow)** starts with P2-1, one junior on the API + one on the screens once the API contract is fixed.

## 5. Decisions needed from the owner

- Approve this order (or move the cow module or digital payments earlier).
- **Backups**: where the daily copy should also go (USB drive, Google Drive folder, or both).
- **Digital payments**: whether to open an SSLCommerz (or bKash merchant) account — needed before P3-1 can go live.
- **SMS**: willingness to pay a small fee per message to a local SMS gateway (we will get exact quotes first) before P3-3.
- Still pending from earlier: flock bird count, feed unit (kg/bag), naming October credit customers, re-import of the October workbook with "Replace", opening stock.
