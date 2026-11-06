# Design system, easy workspace and speed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable design system with BDP Agrofarm as its first theme, an easy big-button workspace with daily reminders for data-entry staff, and a fast first load on slow phones. Deliver it as six PRs for the chief engineer to review.

**Architecture:**
- A new npm workspace `packages/design-system` holds brand-neutral tokens (CSS custom properties plus generated JSON) and React components. The BDP theme is a CSS file inside it.
- `apps/web` consumes the package and keeps only app-specific layout.
- Backend additions sit in `apps/api`, each behind a permission, with Vitest tests in the existing style:
  - user preferences;
  - adding to the day's production;
  - "my entries today";
  - same-day Fix;
  - stock-adjustment void;
  - reminders with Web Push.

**Tech Stack:**
- Web: React 19, Vite 7, TanStack Query, plain CSS custom properties, lucide-react.
- API: Fastify 5, Prisma 6 (SQLite), Vitest, `web-push` (new, API only).

**Spec:** `docs/superpowers/specs/2026-11-06-design-system-easy-workspace-speed-design.md`

## Global Constraints

- Never merge or deploy. Open PRs only. The live app is the office VM: the chief reviews and the backend engineer deploys. Never touch the laptop copy on port 4000.
- Every user-facing string is bilingual, via `t('English','বাংলা')`.
- No Tailwind and no Google-hosted fonts at run time; fonts come from `@fontsource`.
- PR 1 must look pixel-identical to `main`, except where a later PR says otherwise.
- No change to accounting results or posting rules, except the backend items in PR 3, which are flagged for the chief.
- Time zone for "today" and reminders: `Asia/Dhaka` (UTC+6, no daylight saving).
- Reminder defaults: morning `10:00`, evening `17:00`, follow-up +1 h, owner "not done" notice +2 h, farm-wide switch on.
- First-visit budget: at most **170 KB** gzip of JS + CSS before the first screen.
- Font sets: `clean` = Inter + Hind Siliguri (default); `easy` = Atkinson Hyperlegible + Noto Sans Bengali; `friendly` = Nunito + Baloo Da 2. Headings always use Anek Bangla.
- Reference page and reminder settings are visible to the `settings.manage` permission.
- Each PR description has before/after screenshots at 390, 768, 1024 and 1280 px, in light and dark, plus a plain-English summary.
- `npm run typecheck` and `npm test` pass on every PR.

## Review Focus

1. **Two production entries for one flock on one day:** the laying rate must not halve, because birds must be counted once per flock per day. Test in Task 7.
2. **An operator voids someone else's record, or their own from yesterday:** refused with 403 and a plain message. Test in Task 9.
3. **The clock passes midnight Dhaka time while UTC is still "yesterday"** (00:30 Dhaka = 18:30 UTC the day before): "today" and "same day" use Dhaka. Tests in Tasks 8 and 9.
4. **The prefs endpoint is not on the server yet** (old backend): the web keeps working with device-only settings and no error toast. Check in Task 11.
5. **No active flock, or several flocks:** the wizards skip the flock step for one flock, ask for it with several, and with none show a plain "Ask the owner to add a flock" message. Check in Task 13.

---

## PR 1 — `feat/design-system` (from `main`)

### Task 1: Package with tokens and the BDP theme

**Files:**
- Create:
  - `packages/design-system/package.json` (name `@farmledger/design-system`, `"type":"module"`, `exports` for `.`, `./tokens.css`, `./themes/bdp.css`, `./components.css`, `./tokens.json`);
  - `packages/design-system/src/tokens.css` (brand-neutral: spacing, radius, type scale, z-index, motion);
  - `packages/design-system/src/themes/bdp.css` (colours, fonts and accents, light and dark, moved verbatim from `apps/web/src/styles.css`);
  - `packages/design-system/scripts/build-tokens.mjs` (CSS → `tokens.json`);
  - `packages/design-system/test/tokens.test.ts`.
- Modify:
  - root `package.json` workspaces (add `packages/*`);
  - `apps/web/src/main.tsx` (import the package CSS before `styles.css`);
  - `apps/web/src/styles.css` (remove the moved token blocks);
  - CI `npm test` (add the package test);
  - `apps/web/package.json` (dependency `"@farmledger/design-system": "*"`).

**Interfaces:**
- Produces: CSS variables with **unchanged names** (e.g. `--brand`, `--gold`, `--bg`, `--text-3`, `--radius`, `--fs`) and new neutral names (`--z-dropdown:40`, `--z-sticky:45`, `--z-backdrop:50`, `--z-modal:55`, `--z-toast:60`, `--ease-out: cubic-bezier(.22,1,.36,1)`).
- Produces: `tokens.json`, shaped `{ base: Record<string,string>, themes: { bdp: { light: Record<string,string>, dark: Record<string,string> } } }`.

- [ ] Step 1: Write `tokens.test.ts`, which asserts:
  - `tokens.json` equals what `build-tokens.mjs` produces from the CSS;
  - every `var(--x)` used in `apps/web/src/**/*.css|tsx` is defined in `tokens.css`, `bdp.css` or `apps/web/src/styles.css`;
  - `--text` on `--bg` and `--text-2` on `--surface` reach contrast ≥ 4.5 in both light and dark.
- [ ] Step 2: Run `npm test -w packages/design-system`. It should fail, because the files are missing.
- [ ] Step 3: Create the files and move the token blocks across verbatim.
- [ ] Step 4: Run the tests (PASS). Then take before/after screenshots of 6 pages × 2 themes × 2 widths, and pixel-compare them with `scratchpad/pxdiff.mjs`. Expect 0 differing pixels.
- [ ] Step 5: Commit "Design system package: tokens and BDP theme".

### Task 2: Components move into the package

**Files:**
- Create:
  - `packages/design-system/src/components/*.tsx` (Button classes stay CSS; Card, Kpi, Badge, Alert, Empty, Loading, Field, Input, Select, SearchBox, Segmented, Switch, Tabs, Drawer, Dialog, DataTable, ToastProvider/useToast, PageHeader);
  - `packages/design-system/src/i18n.tsx` (`DSTextProvider`, `useDSText`);
  - `packages/design-system/src/components.css` (component rules cut from `styles.css`);
  - `packages/design-system/src/index.ts`.
- Modify:
  - `apps/web/src/components/ui.tsx` becomes `export * from '@farmledger/design-system'` plus the app-only parts: `StatusBadge`, `RangePicker`, `VoidDialog`, `Range`, `thisMonth`, `iso10`;
  - `apps/web/src/main.tsx` (wrap with `<DSTextProvider t={…}>` inside `PrefsProvider`).

**Interfaces:**
- Produces: `useDSText(): (en: string, bn: string) => string`. It defaults to returning `en`.
- Produces: the same component names and props as today's `ui.tsx`. Pages are not edited.

- [ ] Step 1: `npm run typecheck` gives the baseline (PASS).
- [ ] Step 2: Move the components. Replace `useT` with `useDSText` in the package. Move the component CSS rules into the package unchanged.
- [ ] Step 3: Run `npm run typecheck` and `npm run build -w apps/web` (both PASS). Pixel-compare as in Task 1 (0 differing pixels), including an open drawer, a toast and a phone card table.
- [ ] Step 4: Commit "Design system package: components".

### Task 3: Reference page

**Files:**
- Create: `apps/web/src/pages/SystemReference.tsx`, which shows every token swatch, the type scale and each component in its states.
- Modify: `apps/web/src/App.tsx` (route `/system`, guarded by `settings.manage`); `apps/web/src/pages/MyAccount.tsx` About section (link "Design reference", shown only with `settings.manage`).

- [ ] Step 1: Build the page.
- [ ] Step 2: Screenshot at 390 and 1280 px; check by eye that nothing overflows.
- [ ] Step 3: Commit. Open PR 1 with screenshots and the pixel-diff result.

## PR 2 — `feat/brand` (based on PR 1)

### Task 4: BDP Agrofarm logo and icons

**Files:**
- Create:
  - `apps/web/src/brand/Logo.tsx`, exporting `LogoMark({size})` and `LogoLockup({tone:'light'|'dark', size})`. Logo A: a rounded green tile, a gold egg and a green duck, with "BDP Agrofarm" and "Barishal";
  - `scratchpad/render-icons.mjs` (headless Edge renders the SVG to PNG).
- Modify:
  - `apps/web/public/icons/icon.svg`, plus `icon-192.png`, `icon-512.png`, `maskable-512.png` and `apple-touch-icon.png` at the sizes the manifest lists;
  - the sidebar brand in `apps/web/src/layout/Shell.tsx`;
  - the `Login.tsx` crest;
  - the invoice/receipt print header.

- [ ] Step 1: Refine the mark. It must read clearly at 16 px; zoom-check it.
- [ ] Step 2: Render the PNGs, then run `npm test -w apps/api -- web-manifest` (PASS: sizes and files).
- [ ] Step 3: Screenshot the sidebar, sign-in and a printed invoice. Commit.

### Task 5: Loading, empty, error, not-found and offline states

**Files:**
- Create in the package:
  - `Skeleton({lines?, height?})`;
  - `EmptyState({icon, title, body?, action?})`;
  - `ErrorState({title?, body?, onRetry?})`;
  - `ErrorBoundary({fallback})`.
- Create: `apps/web/src/pages/NotFound.tsx`; `apps/web/src/components/OfflineBanner.tsx` (uses `navigator.onLine` and online/offline events).
- Modify:
  - `App.tsx`: the `*` route goes to NotFound instead of redirecting; ErrorBoundary wraps the routes;
  - `Loading` keeps its API but renders a skeleton;
  - `useToast` gains `success(msg, {actionLabel?, onAction?})`, with "Saved ✓" styling.

- [ ] Step 1: Build the components and wire them in.
- [ ] Step 2: Screenshot the not-found route, offline (simulated with `Network.emulateNetworkConditions offline`) and an empty list. Commit. Open PR 2.

## PR 3 — `feat/operator-workflows-api` (from `main`, backend, for the chief)

### Task 6: Preferences saved with the person

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma`: `User.preferences String?` (JSON);
  - `apps/api/src/routes/auth.ts`: `/auth/me` returns `user.preferences` (object or null); `PATCH /auth/preferences` also accepts `prefs`.
- Test: `apps/api/test/preferences.test.ts`.

**Interfaces:**
- Produces: the `prefs` shape `{ theme?: 'light'|'dark'|'system'; density?: 'comfortable'|'compact'; fontSize?: 12..20; accent?: 'green'|'blue'|'purple'|'amber'; motion?: 'full'|'reduce'; banglaCalendar?: boolean; home?: string; fontSet?: 'clean'|'easy'|'friendly'; simple?: boolean; lite?: boolean }`. Unknown keys are rejected with 400.

- [ ] Step 1: Write the tests:
  - PATCH `{prefs:{fontSet:'easy',simple:true}}`, then GET `/auth/me` returns those values;
  - `fontSize: 40` gives 400;
  - user A's prefs never appear for user B;
  - `locale` still works on its own.
- [ ] Step 2: Run them (FAIL). Implement. Run them (PASS). Commit.

### Task 7: Add to the day's production record

**Files:**
- Modify:
  - `apps/api/src/services/operations.ts`: `ProductionInput.addToDay?: boolean`. When true and a posted log already exists for that flock and date, create an additional log instead of returning 409. When false, keep the 409.
  - `apps/api/src/routes/transactions.ts`: accept `addToDay`.
  - `apps/api/src/services/reports.ts` `productionSummary`: count `birds` once per flock per day.
- Test: `apps/api/test/production-sessions.test.ts`.

- [ ] Step 1: Write the tests:
  - morning `{eggsCollected:420, eggsBroken:5}` then evening `{eggsCollected:0, mortality:2, feedQty:10, addToDay:true}` gives two logs; the day totals are 420/5/2/10; flock count drops by 2; feed stock drops by 10;
  - the laying rate equals 420 ÷ birds of that flock (not ÷ 2×);
  - a second entry without `addToDay` still returns 409;
  - voiding the evening log restores the 2 birds and the 10 feed.
- [ ] Step 2: Run them (FAIL). Implement. Run them (PASS). Commit.

### Task 8: "My entries today"

**Files:**
- Create: `apps/api/src/lib/farm-time.ts`, exporting:
  - `FARM_TZ_OFFSET_MIN = 360`;
  - `farmDayStart(now: Date): Date`, the UTC instant of 00:00 Dhaka;
  - `isSameFarmDay(a: Date, b: Date): boolean`.
- Create: route `GET /me/today` in `apps/api/src/routes/transactions.ts`, open to anyone signed in.
- Test: `apps/api/test/my-today.test.ts`.

**Interfaces:**
- Produces: `GET /me/today` → `{ entries: { kind: 'production'|'invoice'|'receipt'|'bill'|'payment'|'adjustment'; id: string; summary: string; amount?: number; createdAt: string; canFix: boolean }[] }`. Only the signed-in user's non-void records created since `farmDayStart(now)`, newest first.

- [ ] Step 1: Write the tests:
  - another user's entry is excluded;
  - an entry created at 23:50 Dhaka yesterday is excluded;
  - at 00:30 Dhaka today (18:30 UTC the day before), an entry created at 00:10 Dhaka is included;
  - void entries are excluded.
- [ ] Step 2: Run them (FAIL). Implement. Run them (PASS). Commit.

### Task 9: Same-day Fix and stock-adjustment void

**Files:**
- Create in `apps/api/src/services/common.ts`: `ownSameDay(actor: Actor, rec: { createdById: string|null; createdAt: Date }, now?: Date): boolean`.
- Modify the void routes in `apps/api/src/routes/transactions.ts` (invoice, receipt/payment, bill, production):
  - allow when the actor has the existing permission and the record is not an operator's out-of-window production;
  - **or** when the actor's role is `operator` and `ownSameDay` holds;
  - operators' void of production is allowed **only** when `ownSameDay` holds.
- Create: `voidAdjustment(db, actor, sourceId, reason)` in `operations.ts` (reverse the stock moves, reverse the journal entry, audit `void stock_adjustment`) and route `POST /inventory/adjustments/:sourceId/void`. Permission: `inventory.manage`, or operator plus `ownSameDay`.
- Modify: `apps/api/test/permissions.test.ts` (new rows); `sales.ts` (voiding a cash invoice by its creator on the same day voids its receipt first, in one transaction).
- Test: `apps/api/test/same-day-fix.test.ts`.

- [ ] Step 1: Write the tests:
  - an operator voids their own invoice paid in cash today: the invoice and receipt are void and cash returns to before;
  - another operator's invoice gives 403;
  - their own from yesterday (Dhaka) gives 403;
  - an older production log gives 403 for an operator but is allowed for the owner;
  - an adjustment void restores the qty and avg cost and reverses the journal;
  - the permission matrix covers the new route.
- [ ] Step 2: Run them (FAIL). Implement. Run them (PASS). Commit.

### Task 10: Daily reminders (settings, subscriptions, scheduler, push)

**Files:**
- Modify `apps/api/prisma/schema.prisma`:
  - `Organization.remindersOn Boolean @default(true)`, `reminderMorning String @default("10:00")`, `reminderEvening String @default("17:00")`;
  - new model `PushSubscription { id, userId, endpoint @unique, p256dh, auth, createdAt }`;
  - new model `ReminderLog { id, day String, slot String, kind String, sentAt }` with `@@unique([day, slot, kind])`.
- Create: `apps/api/src/services/reminders.ts`, exporting:
  - `dueSlots(now: Date, cfg: {morning: string; evening: string; on: boolean}): ('morning'|'morning-again'|'morning-owner'|'evening'|'evening-again'|'evening-owner')[]`, pure; a slot is due during the minute it starts;
  - `isDone(db, slot: 'morning'|'evening', dayStart: Date): Promise<boolean>`. Morning: every ACTIVE flock has today's eggs logged. Evening: every ACTIVE flock has `feedQty > 0` today **or** a "none today" mark exists for feed, medicine and expenses;
  - `runReminders(db, now, send)`, where `send` is injectable;
  - `startReminderScheduler(db)`, a 60 s interval, not started when `NODE_ENV==='test'`.
- Create: `apps/api/src/routes/reminders.ts`:
  - `GET/PUT /settings/reminders` (`settings.manage`), validating `HH:MM`;
  - `GET /push/key` (signed-in), `POST /push/subscribe` and `DELETE /push/subscribe` (signed-in);
  - `POST /me/today/none` with `{what: 'feed'|'medicine'|'expenses'}` (signed-in), which stores a `ReminderLog` with kind `none-<what>`.
- VAPID keys come from env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`. If those are absent, they are generated once and saved to `<data dir>/vapid.json`.
- Add the dependency `web-push` to `apps/api`.
- Test: `apps/api/test/reminders.test.ts`.

- [ ] Step 1: Write the tests:
  - `dueSlots` at 04:00 UTC (10:00 Dhaka) returns `['morning']`; at 05:00 UTC `['morning-again']`; at 06:00 UTC `['morning-owner']`; at 11:00 UTC `['evening']`;
  - remindersOn false gives `[]`;
  - with custom times 09:30/18:00, the same pattern applies;
  - `runReminders` sends to operators' subscriptions only for `morning` and `-again`, and to the owner only for `-owner`, and only when not done;
  - a slot is never sent twice in one day (the `ReminderLog` unique key);
  - PUT `/settings/reminders` with `25:00` gives 400; an operator gives 403;
  - the permission matrix rows are added.
- [ ] Step 2: Run them (FAIL). Implement. Run them (PASS).
- [ ] Step 3: Run `npm test` (all PASS) and `npm run typecheck`. Commit. Open PR 3, marked **"For the chief — backend changes the easy workspace needs"**. The description lists every permission change in plain words.

## PR 4 — `feat/fonts-and-synced-settings` (based on PR 2)

### Task 11: Font sets, and settings that follow the person

**Files:**
- Modify `apps/web/src/lib/i18n.tsx`:
  - `Prefs` gains `fontSet: 'clean'|'easy'|'friendly'` (default `'clean'`), `simple: boolean`, `lite: boolean`;
  - add `syncFromServer(p: Partial<Prefs>)`;
  - on `set`, call `PATCH /auth/preferences {prefs}`, debounced 800 ms, ignoring 400/404 silently.
- Create: `apps/web/src/lib/fonts.ts`, exporting `loadFontSet(set): Promise<void>`. It uses dynamic `import()` of the `@fontsource` CSS for `easy` and `friendly` and sets `--font` on `:root`.
- Modify: `apps/web/src/lib/auth.tsx` (after `/auth/me`, `syncFromServer(me.user.preferences)`; for the operator role with no saved `simple`, set `simple: true`); `MyAccount.tsx` Appearance (a "Reading font" row with three preview buttons).
- Modify `apps/web/package.json`: add `@fontsource/atkinson-hyperlegible`, `@fontsource/noto-sans-bengali`, `@fontsource/nunito`, `@fontsource/baloo-da-2`.

- [ ] Step 1: Implement.
- [ ] Step 2: Verify:
  - against PR 3's API, a font chosen on one browser profile appears after signing in on a second profile;
  - against `main`'s API (no prefs), there is no error toast;
  - the network tab shows the `easy` font files downloaded only after choosing it.
- [ ] Step 3: Screenshots. Commit. Open PR 4.

## PR 5 — `feat/easy-workspace` (based on PR 4)

### Task 12: Wizard building blocks (package)

**Files:**
- Create in the package `src/wizard/`:
  - `Wizard({steps, onDone, onCancel})`, where `steps: WizardStep[]`, `WizardStep = { key: string; title: string; help: string; picture: ReactNode; render: (ctx) => ReactNode; valid?: (data) => boolean; skip?: (data) => boolean }`;
  - `NumberPad({value, onChange, allowDecimal?})`;
  - `ChoiceButtons({options:{value,label,picture?}[], value, onChange})`;
  - `ConfirmSentence({sentence, onYes, onChange})`;
  - `HelpButton({text})`.
- Keyboard: digits type into the pad, Enter = Next, Esc = Back. Step counter "Step n of m". Large type: `--fs-wizard: 28px` for values.

- [ ] Step 1: Implement. Add a demo on the reference page. Check on a phone (390) and with the PC keyboard. Commit.

### Task 13: Easy home and the four flows

**Files:**
- Create:
  - `apps/web/src/easy/EasyHome.tsx`: greeting, Today checklist (Task 14), four big buttons, "What I recorded today";
  - `apps/web/src/easy/pictures.tsx`: one consistent pictogram set, egg/basket/sack/duck/coin/medicine;
  - flows `apps/web/src/easy/flows/{Eggs,SaleMoney,Bought,DeathsFeed}.tsx`.
- Each flow posts to the existing endpoints, the same as `forms.tsx`:
  - production log, with `addToDay: true` for DeathsFeed;
  - invoice with payment;
  - bill/expense;
  - stock usage for medicine.
- If the API answers 409 for DeathsFeed (PR 3 not merged), show the plain message "Ask the owner — evening entries need an update".
- Modify:
  - `App.tsx`: when `prefs.simple`, the `/` route renders `EasyHome`;
  - `Shell.tsx`: hide "+ New" when `prefs.simple`;
  - `MyAccount.tsx`: a "Simple workspace" switch.

- [ ] Step 1: Implement.
- [ ] Step 2: Walk through each flow against PR 3's API with an operator test user. Check:
  - the numbers land correctly on the Production, Sales, Purchases and Inventory pages;
  - with no flock, one flock and two flocks (Review Focus 5).
- [ ] Step 3: Screenshots on phone and PC, in Bangla and English. Commit.

### Task 14: Today checklist, "What I recorded today" and Fix

**Files:**
- Create: `apps/web/src/easy/TodayChecklist.tsx` (morning eggs and evening feed/medicine/expenses, with "None today" buttons that call `POST /me/today/none`); `apps/web/src/easy/RecordedToday.tsx` (from `GET /me/today`, with Fix where `canFix`: void, then reopen the flow pre-filled).
- Both are hidden gracefully when those endpoints return 404 (old backend).

- [ ] Step 1: Implement. Verify Fix on a cash sale (cash returns), on a production log, and that yesterday's entry shows no Fix. Commit.

### Task 15: Installable app, reminders on the phone, and reminder-time settings

**Files:**
- Create: `apps/web/public/sw.js`, which:
  - caches the app shell and the hashed `/assets/*` (cache-first) and `/` (network-first, falling back to the cached shell);
  - **never caches `/api/*`**;
  - handles `push` with `showNotification(title, {body, icon, data:{url}})` and `notificationclick` with `clients.openWindow(data.url)`.
- Create: `apps/web/src/lib/push.ts`, exporting `registerSW()` and `enableReminders(): Promise<'on'|'denied'|'unsupported'|'needs-install'>`. `needs-install` applies on iOS when not standalone.
- Create: `apps/web/src/easy/TurnOnReminders.tsx`, picture steps that differ for iPhone and Android.
- Modify:
  - `main.tsx` (`registerSW()` in production builds only);
  - the Admin › Organization tab gains a "Daily reminders" card (on/off, morning time, evening time, a "Send me a test" button), visible with `settings.manage`.
- The notification `data.url` values are `/?flow=eggs` (morning) and `/?flow=evening`. `EasyHome` opens that flow.

- [ ] Step 1: Implement.
- [ ] Step 2: Verify in Edge with the preview server:
  - the SW installs;
  - a test push (`POST` from "Send me a test") shows a notification, and clicking it opens the eggs flow;
  - offline reload shows the app shell and the offline banner;
  - `/api` is not in the cache.
- [ ] Step 3: Commit. Open PR 5 (based on PR 4; needs PR 3 for Fix, reminders and the evening entry).

## PR 6 — `feat/speed` (based on PR 5)

### Task 16: Charts off the first screen

**Files:**
- Create in the package: `src/charts/{BarChart,LineChart,AreaChart}.tsx`. Small SVG charts with an axis, gridlines, a tooltip on hover/tap and a legend, coloured from `--chart-1..3`.
- Modify: `Dashboard.tsx`, `Reports.tsx` and `Production.tsx` to use them; remove `recharts`; remove the `charts` chunk from `vite.config.ts`.

- [ ] Step 1: Screenshot every chart before the change.
- [ ] Step 2: Replace the charts. Screenshot after; check by eye that the bars and lines match and the tooltip works on phone tap.
- [ ] Step 3: Run `npm run build`: no `charts-*.js` chunk. Commit.

### Task 17: Fonts, photos and Lite mode

**Files:**
- Modify `main.tsx`: use Inter as one variable file (`@fontsource-variable/inter`) instead of 4 weights; Hind Siliguri at 400 and 600 only; Latin and Bengali subsets only.
- Photos: make `*-640.webp` variants with `scratchpad/resize.mjs` (Edge canvas). `PageHeader` uses `image-set()`/media queries to load the 640 version under 700 px.
- Lite mode: `:root[data-lite='true']` hides `.page-head.photo` images and turns off animation. It is on when `prefs.lite`, or `navigator.connection?.saveData`, or `matchMedia('(prefers-reduced-data: reduce)')`. Add a switch in My settings.

- [ ] Step 1: Implement. Compare the before/after network totals for the dashboard (cold cache) and record them in the PR. Commit.

### Task 18: Size budget check

**Files:**
- Create: `scripts/check-budget.mjs`. It reads `apps/web/dist/index.html`, follows the module and modulepreload/stylesheet links of the entry, gzips each, and sums them. It fails above 170 × 1024 bytes and prints a table.
- Modify: root `package.json` (`"budget": "node scripts/check-budget.mjs"`); `.github/workflows/ci.yml` (a step after build: `npm run build -w apps/web && npm run budget`).

- [ ] Step 1: Run it locally (PASS, under budget). Temporarily set the budget to 10 KB to see it fail, then restore it. Commit. Open PR 6 with a slow-3G timing (Edge CDP `Network.emulateNetworkConditions` at 400 kbps / 400 ms) before and after.

## Optional — Task 19: Figma mirror
If the Figma tools are connected:
- create the file "BDP Design System" in the owner's account, with variables from `tokens.json` (light and dark) and a components page drawn from the reference page (`generate_figma_design`/`use_figma`);
- put the link in the package README.

Skip silently if they are not connected.
