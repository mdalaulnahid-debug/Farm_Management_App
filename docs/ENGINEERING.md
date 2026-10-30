# FarmLedger ERP — engineering handbook

The rules every change to FarmLedger follows. It is written for the developers (human or AI) who build features and for the reviewer who accepts them. `docs/ARCHITECTURE.md` explains *what* the system is; this file explains *how we change it safely*. `docs/ROADMAP.md` says *what we build next*.

When this handbook and the code disagree, the code is wrong or this file is out of date. Fix one of them in the same pull request.

---

## 1. Non-negotiables

1. **The ledger is the truth.** Every financial event posts a balanced journal entry through `postEntry` (`apps/api/src/services/ledger.ts`). Reports read only journal lines of `POSTED` entries.
2. **Nothing financial is deleted.** Mistakes are voided; a void posts a mirror-image reversal and marks both entries `VOID`. No `delete`/`deleteMany` on business tables, ever.
3. **The period lock holds.** No posting on or before `Organization.lockDate`. `postEntry` enforces it; do not post around it.
4. **One unit of work, one transaction.** A document, its stock moves, its journal entry and its audit row are written inside one `tx()` call, or not at all.
5. **The server decides who may do what.** Every route has a `can('<permission>')` guard. Hiding a button in the UI is never the security control.
6. **The owner's live data is sacred.** Never modify, reset or migrate `apps/api/prisma/farmledger.db` in the main checkout, never change the owner's password, never run `prisma db push --accept-data-loss` or `--force-reset` against it.
7. **Bilingual by default.** Every visible string is `t('English', 'বাংলা')`.

---

## 2. Module boundaries

```
apps/api/src
├─ server.ts          app wiring: plugins, error handler, route registration, static web
├─ db.ts              Prisma client + tx()
├─ auth/auth.ts       passwords, sessions, loadUser, can() guard
├─ lib/               pure helpers — no database access
│   ├─ money.ts       rounding: money(), qty(), sum(), isZero()
│   ├─ validate.ts    parse() + shared Zod atoms (zDate, zMoney, zId, zReason …)
│   ├─ errors.ts      AppError + badRequest/notFound/conflict/forbidden
│   ├─ constants.ts   SYS account codes, enums, PERMISSIONS, DEFAULT_ROLES
│   └─ dates.ts, phone.ts, xlsx.ts
├─ services/          business logic — the only place that writes business tables
│   ├─ ledger.ts      postEntry, reverseEntry, accountBalance, assertOpenPeriod
│   ├─ inventory.ts   receiveStock, issueStock, reverseStockForSource
│   ├─ sales.ts · purchases.ts · payments.ts · operations.ts · projects.ts
│   ├─ reports.ts     read-only, ledger-based statements
│   ├─ importer.ts    Excel backlog import (calls the other services; never writes tables itself)
│   ├─ reference.ts   idempotent reference data, run on every start
│   └─ common.ts      nextNumber (document numbers), audit()
└─ routes/            HTTP only: guard → parse → call a service inside tx() → return
```

Dependency direction is **routes → services → (ledger, inventory, common) → lib**. Never the other way.

- **Routes** contain no business rules and no direct writes to business tables. Simple reads (lists, lookups) may use `prisma` directly.
- **Services** take `db: Db` as their first argument and an `Actor` second, so they run inside the caller's transaction. They never call `tx()` or `prisma` themselves.
- **A service may call another service** (sales → payments, importer → everything). It passes its own `db` along.
- **`lib/`** is pure: no Prisma client, no I/O.
- **New domain = new service file** (e.g. `services/dairy.ts`) plus a new route file registered in `server.ts`. Don't grow `operations.ts` into a catch-all.

Web (`apps/web/src`):

```
├─ main.tsx, App.tsx     router, providers, route table
├─ layout/Shell.tsx      navigation, header, phone menu
├─ lib/                  api.ts (fetch wrapper), hooks.ts (useApi/useSave + TanStack Query), i18n.tsx (usePrefs/useT → t, statusLabel …), format.ts (fmtMoney, fmtDate …), auth.tsx
├─ components/ui.tsx     layout & display kit (page header, cards, tables, badges, modals …)
├─ components/forms.tsx  form kit (fields, selects, money/date inputs, line-item editors …)
├─ pages/*.tsx           one file per screen; compose the kit, no bespoke design system
└─ styles.css            the only stylesheet: tokens (colours, spacing, density, dark mode) + classes
```

---

## 3. Posting rules (accounting)

### 3.1 How a document posts

Every document service follows the same shape. `sales.ts › createInvoice` is the reference:

1. Validate business rules (customer kind, positive quantities, discount ≤ subtotal …). Throw `badRequest` / `conflict` with a message the farm staff can act on.
2. Round at the boundary: `money()` for amounts (2 dp), `qty()` for quantities (3 dp). Compute totals with `sum()` and `round2()`, never with raw `+` across many floats.
3. Take a document number with `nextNumber(db, 'PREFIX')` **inside** the transaction (gap-free).
4. Create the document row.
5. Move stock with `receiveStock` / `issueStock` (they return the cost value for valued items).
6. Build `LineInput[]` and call `postEntry(db, actor, { date, memo, sourceType, sourceId, lines })`.
7. Store `journalEntryId` on the document.
8. `audit(db, actor, 'create', '<entity>', id, '<human summary>')`.

### 3.2 Line rules

- Look up system accounts by code: `accountId(db, SYS.X)`. Never hard-code ids. New system accounts are added to `SYS` in `constants.ts` and created in `reference.ts`.
- **Projects:** every line carries a `projectId`. Omit it only when the main (duck) project is meant; `postEntry` fills it in. A document that belongs to a side project passes that project's id on **every** line, including the cash/AR/AP side, so project P&L and balances stay right.
- **Parties:** AR and AP lines always carry `partyId`; the aging reports depend on it.
- Prefer one line per income/expense account per document. `postEntry` nets a line that has both a debit and a credit.

### 3.3 Voids

- A void function is the exact inverse of its create: `void<Thing>(db, actor, id, reason)`.
- Order: check the status (`conflict` if already void) → refuse if dependent live documents exist (e.g. receipts applied to an invoice) → reverse stock (`reverseStockForSource`) → `reverseEntry` → set status `VOID` and append `VOID: reason` to notes → `audit(..., 'void', ...)`.
- Voids post on the **original date**, so a void inside a locked period is refused. That is intended: the owner reopens the period or posts a correcting entry in the open period.
- Every route that voids takes `zReason` (at least 3 characters).
- **Every new document type ships with its void path and a test that voids it and checks the ledger and stock return to where they were.**

### 3.4 Inventory

- Valued items (feed, medicine, vaccines, supplies) use the weighted-average cost: `receiveStock` updates the average, `issueStock` issues at the average.
- Quantity-only items (eggs, later milk) carry no cost; their cost was expensed as feed/medicine/labour.
- Issuing more than is on hand is refused unless `allowNegative` is passed explicitly by a service that has a reason (document it in a comment).
- Any change to `Item.qtyOnHand` / `Item.avgCost` goes through `inventory.ts`. Nowhere else.

### 3.5 Money and Decimal

- The database stores amounts as Prisma `Decimal`. In code, amounts travel as JS numbers and are rounded with `lib/money.ts` at every boundary (input, before storing, before posting).
- Convert a Decimal with `num()` / `money()`, never with `+value` or arithmetic on the Decimal object.
- Compare amounts with `isZero(a - b)`, never `===`.
- The API serialises Decimals as numbers (see `server.ts`). The web formats them with `lib/format.ts` only.
- **Don't** introduce a second money library or floating totals in reports; sum lines then `round2()` once.

### 3.6 Concurrency

SQLite serialises all writes, so the single-PC install is safe today. On PostgreSQL, read-modify-write updates of `Item.qtyOnHand/avgCost`, `SalesInvoice.amountPaid` and `Bill.amountPaid` can lose updates under concurrent requests. Until the hardening item in the roadmap lands:

- New code must not add more read-modify-write counters. Prefer Prisma atomic updates (`{ increment: x }`) or derive the value from child rows.
- When you must read-then-write a balance, read it inside the same `tx()` and add a `// CONCURRENCY:` comment so it is found when row locking is introduced.

---

## 4. API and validation pattern

Every route looks like this:

```ts
app.post('/invoices', { preHandler: can('sales.create') }, async req => {
  const body = parse(z.object({ date: zDate, lines: z.array(lineSchema).min(1), /* … */ }), req.body);
  return tx(db => createInvoice(db, actorOf(req), body));
});

app.post('/invoices/:id/void', { preHandler: can('sales.void') }, async req => {
  const { reason } = parse(zReason, req.body);
  await tx(db => voidInvoice(db, actorOf(req), (req.params as any).id, reason));
  return { ok: true };
});
```

- **Guard first.** `preHandler: can('<area>.<action>')`. Permissions live in `PERMISSIONS` (`constants.ts`); a new permission is added there **and** to the right `DEFAULT_ROLES`, and `reference.ts` must grant it to existing roles idempotently so live installs keep working.
- **Compound permissions** (one route, different rights by input — see `POST /payments` and `POST /stock-adjustments`) are allowed only with a minimum guard in `preHandler` and the extra check immediately after `parse`, with a comment explaining it.
- **Validate everything** with `parse(schema, req.body | req.query)` using the shared atoms in `lib/validate.ts` (`zDate`, `zMoney`, `zQty`, `zId`, `zText`, `zOptText`, `zReason`, `zRange`). Bound every string and array length.
- **Errors** are thrown as `AppError` helpers. The error handler turns them into `{ error, message, details }`. Messages are plain English sentences a farm worker understands; the web shows them as-is.
- **Lists** accept `from`, `to`, `search`, `status`, `page`, `pageSize` and return `{ data, total }`.
- **REST naming:** plural nouns under `/api/v1`, actions as sub-resources (`/:id/void`). No breaking changes to existing endpoints; add fields, don't rename them.
- **No secrets in responses** (strip `passwordHash`, tokens). No personal data in URLs or query strings.

### 4.1 Schema changes

- **Additive only.** New tables, new nullable columns, or columns with defaults. The Windows launcher runs `prisma db push` on every start without `--accept-data-loss`, so a destructive change would stop the owner's app from starting.
- On new nullable columns use `@@index`, not `@unique`.
- Money columns are `Decimal`; quantities `Decimal`; enums are `String` with the allowed values in `constants.ts` (SQLite has no enums).
- New reference data (accounts, items, roles, projects) goes in `services/reference.ts`, idempotent by `code` / `sku` / `key`, so it is created on the next start of every install.
- Run `prisma db push` against a **copy** of a realistic database before opening the PR, and say so in the PR.

---

## 5. Web: UI kit and bilingual strings

- **Start from `pages/Sales.tsx`.** It is the reference page: `PageHeader`, `RangePicker` + `SearchBox` filters, a `DataTable` list, the create form in a `Drawer`, the detail view, and `VoidDialog` for voids.
- **Use the kit.**
  - `components/ui.tsx`: `PageHeader`, `Card`, `Kpi`, `Badge`/`StatusBadge`, `Alert`, `Empty`, `Loading`, `Field`, `Input`, `Select`, `SearchBox`, `Segmented`, `Tabs`, `RangePicker`, `Drawer`, `Dialog`, `VoidDialog`, `DataTable`, `useToast`.
  - `components/forms.tsx`: `Money`, `accountOptions`, `CashAccountSelect`, `methodOptions`, and the document drawers (`InvoiceDrawer`, `BillDrawer`, `PaymentDrawer`, `ProductionDrawer`).
  - Lists use `DataTable`, not a hand-written `<table>`. Option lists (payment methods, accounts) come from the kit helpers, never a local copy.
  - If the kit is missing something, add it to the kit in the same PR (with a short comment); don't build a one-off in the page. Two pages with the same block of JSX means it belongs in the kit.
- **Bangla names of records** (accounts, items, projects have `nameBn`) are picked with one shared helper, not an inline `lang === 'bn' && x.nameBn` in each page. Lookup tables of strings (months, permission names) are built with `t()`, not with a separate Bangla array.
- **Styles only from `styles.css`.** Use its classes and CSS variables (colours, spacing, density, accent). No hex colours or pixel styling inside `.tsx`; small layout-only `style` props (e.g. `gridColumn`) are tolerated.
- **Data** goes through `useApi` / `useSave` in `lib/hooks.ts` (built on `lib/api.ts` and TanStack Query). No raw `fetch()` in pages. Invalidate the affected queries after a mutation (lists, dashboard, reports).
- **Money and dates** are displayed with `<Money>` or `lib/format.ts` (`fmtMoney`, `fmtDate`, `fmtDateTime`), always passing the current `lang`. Never `toLocaleString()` directly.
- **Enum values** (status, payment method, category) are shown through the label helpers (`statusLabel`, `methodOptions` …), never raw (`CASH`, `MOBILE`).
- **Every string** is `t('English', 'বাংলা')` (from `useT()` / `usePrefs()`), including button labels, table headers, empty states, toasts, confirm dialogs and `title`/`aria-label`. Use the farm's words: invoice = **চালান**, export/download = **ডাউনলোড**, receipt = **রসিদ**, expense = **খরচ**, stock = **মজুদ**. Ask the reviewer when unsure of a term; don't machine-translate silently.
- **Phone first.** Every screen must work at **375 px** wide: tables inside the scroll wrapper, forms in one column, no fixed widths, tap targets ≥ 40 px.
- **Permissions in the UI** mirror the server (`useAuth().can('…')`) to hide actions the user can't take; the server still enforces.
- **Destructive or financial actions** (void, replace import, period lock) always confirm and ask for a reason.

---

## 6. Testing requirements

- **API integration tests** live in `apps/api/test/` and run against a throwaway SQLite database (`prisma/test.db`, recreated by `global-setup.ts`). They call the real routes with `app.inject`.
- **Every new behaviour gets a test.** Minimum for a new document type:
  1. create it and assert the journal lines (accounts, amounts, project, party);
  2. assert stock quantity/value changes if it moves stock;
  3. void it and assert the ledger and stock return to the starting point;
  4. assert a user without the permission gets **403**;
  5. assert posting into a locked period is refused.
- **Invariants** that a test should check after any multi-step scenario: trial balance debits = credits; balance sheet balances; inventory value in the ledger equals the inventory valuation report.
- New features may add a new test file (`test/<area>.test.ts`) rather than growing `erp.test.ts` without bound; tests run sequentially (`fileParallelism: false`) and share one seeded database, so each test creates its own data and does not assume a clean slate.
- **The suite must stay green.** A PR with a failing or skipped test is not reviewed.
- Web: type check and production build must pass. Component tests are welcome but not yet required.

### 6.1 Commands (Windows sandbox)

Inside the Claude sandbox npm/npx cannot spawn `cmd.exe`, so call the tools with node directly from the repo root:

```bash
node node_modules/typescript/bin/tsc --noEmit -p apps/api
node node_modules/typescript/bin/tsc --noEmit -p apps/web
cd apps/api && node ../../node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build apps/web
```

Fresh worktree setup:

```bash
npm install --script-shell "C:\Program Files\Git\usr\bin\bash.exe"
cp apps/api/.env.example apps/api/.env
cd apps/api && node ../../node_modules/prisma/build/index.js db push
```

Stop any running API server before `prisma generate` (it locks the engine DLL). Outside the sandbox the normal `npm test`, `npm run typecheck`, `npm run build` work.

---

## 7. Branch and pull-request workflow

1. **One unit of work = one branch** named `feat/<short-name>` (or `fix/…`, `docs/…`, `chore/…`) from the latest `main`. Never commit to `main` directly. Never force-push.
2. **Small PRs.** One feature or fix per PR; aim for under ~600 changed lines excluding tests and lockfile. Split large features into backend and screen PRs.
3. **Commits** have a clear imperative subject (`Add milk log and daily milk sales`) and end with the co-author trailer:
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
4. **PR description**: what and why in plain language; accounting impact (which accounts are debited/credited); schema changes (additive? pushed against a copy?); permissions added; screenshots at desktop and 375 px for UI; how it was tested. It ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
5. **Checks**: type checks, tests and build must pass locally and (once it exists) in CI.
6. **Review** by the chief engineer (section 8). Fixes go on the same branch as new commits.
7. **Merge only with the owner's explicit approval.** The owner approves features; the chief engineer approves code.
8. **Docs** (`README.md`, `ARCHITECTURE.md`, this file, `ROADMAP.md`) are updated in the same PR when behaviour, accounts or workflows change.

---

## 8. How junior developers are briefed and reviewed

### 8.1 The brief

Each piece of work is handed to one junior developer with a written brief containing:

- **Goal** in one paragraph, in business terms (what the farm can do afterwards).
- **Ownership:** the exact files/areas the junior may change. Two juniors never own the same file at the same time; shared files (`schema.prisma`, `constants.ts`, `reference.ts`, `App.tsx`, `Shell.tsx`, `ui.tsx`, `forms.tsx`) are assigned to one junior per round or changed by the chief engineer.
- **Contract:** the Prisma models/columns to add, the endpoints with request/response shapes, the permissions, the journal entries to post (debit/credit table).
- **Conventions:** a link to this handbook plus anything specific.
- **Definition of done:** the tests listed in section 6, green checks, PR opened on its own branch from its own worktree, a short report of what changed and what was not done.

### 8.2 The review

A junior's report is a claim, not proof. Before anything lands the reviewer:

1. Reads the full diff, not the summary.
2. Runs the type checks, the tests and the build personally.
3. Checks accounting: each posting balanced and on the right accounts and project; void path reverses ledger **and** stock; period lock respected; no deletes; Decimal/rounding via `money.ts`.
4. Checks security: `can()` on every new route, correct permission, input bounded by Zod, nothing sensitive returned.
5. Checks schema changes are additive and push cleanly on a copy of a real database.
6. Checks the UI at 375 px and in both languages and both themes.
7. Sends specific fixes back to the same junior, or reassigns. Repeated misses mean a smaller next brief.

### 8.3 Review checklist (copy into the PR)

```
- [ ] Every financial event goes through postEntry, inside tx()
- [ ] Void path reverses journal and stock; test covers it
- [ ] Period lock respected; no deletes of business records
- [ ] Amounts rounded with lib/money.ts; Decimals converted with num()/money()
- [ ] projectId and partyId correct on every journal line
- [ ] can('<permission>') on every route; 403 test for an unprivileged user
- [ ] Zod validation with bounded strings/arrays
- [ ] Schema change is additive; db push tested on a copy
- [ ] UI uses ui.tsx/forms.tsx and styles.css tokens; every string t('…','…')
- [ ] Works at 375 px; light and dark
- [ ] Type checks, tests, build green
- [ ] Docs updated
```
