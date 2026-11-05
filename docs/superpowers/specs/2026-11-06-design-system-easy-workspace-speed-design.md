# Design system, easy workspace and speed — design

Date: 2026-11-06 · Owner: BDP Agrofarm (non-developer) · Written by the UI/frontend session
Status: draft for owner approval

## Why

FarmLedger (BDP Agrofarm's books) should look and behave like software from a serious IT company. It should also be usable by older farm staff who are not comfortable with computers, and fast on slow mobile data and cheap phones.

The owner also wants the look and building blocks to be **reusable**. Their SMS automation site (running, but with a poor site), a paused "tower console" and future SaaS products should be able to import the same system later.

This is three projects, done in this order. Each later project builds on the earlier ones.

1. **Design system**: a reusable, themeable kit; FarmLedger becomes its first theme.
2. **Easy workspace**: big-button home and step-by-step forms for less confident staff.
3. **Speed**: fast first load on slow networks and low-powered phones.

## Goals, non-goals, anti-goals

**Goals**
- One design system package used by FarmLedger, ready to be imported by other projects (React and non-React).
- A real BDP Agrofarm brand: logo, app icon, tab icon, loading and error screens.
- Staff who struggle with computers can record their daily work without help.
- The first screen appears quickly on a slow 3G/4G connection. A second visit opens almost instantly.

**Non-goals (not now)**
- Restyling the SMS automation project or the tower console. Only FarmLedger is touched.
- Offline data entry: saving entries with no connection and syncing later.
- Logo upload by the owner, and per-farm brand colour stored on the server. The BDP logo and theme are built in for now.
- Voice input, read-aloud and help videos. The owner chose text help instead.

**Anti-goals (a failure even if it "works")**
- Any change to accounting results, posting rules or permissions, except the one explicitly listed under Project 2, which the chief engineer must approve.
- Existing users seeing a broken or noticeably different app after Project 1. Project 1 must look the same, apart from the new logo and fonts setting.
- Losing the bilingual behaviour. Every new string must exist in English and Bangla through `t('English','বাংলা')`.
- Anything merged or deployed without the chief engineer's review. The live app is the office VM; the chief reviews, and the backend engineer deploys from GitHub. This session never merges, deploys or touches the laptop copy.
- "AI-made" look: generic gradients, glassmorphism, identical card grids, an eyebrow label on every section.

## Constraints

- Monorepo with npm workspaces: `apps/web` (React 19, Vite, TanStack Query) and `apps/api` (Fastify, Prisma, SQLite).
- Styling today is plain CSS with custom properties in `apps/web/src/styles.css` (about 550 lines). Components live in `apps/web/src/components/ui.tsx` and `forms.tsx`. No Tailwind; keep it that way.
- The owner works with plain-English explanations and screenshots. Each PR description says in plain words what changes for staff.
- Screenshots of every changed screen before and after, on phone (390 px), tablet (768 and 1024 px) and desktop (1280 px), in light and dark.
- Fonts are self-hosted (`@fontsource`), never loaded from Google at run time.
- The repository is public. No farm data, workbooks or secrets go in it.

## Project 1 — Design system

### What it is (decided)
- A new workspace package **`packages/design-system`**, kept in this repository and importable by other projects from GitHub later.
- **Two layers:**
  1. **Tokens:** colours, type scale, spacing, radius, shadows, motion timing and z-index layers. Published as plain CSS custom properties **and** as JSON, so a non-React site can use them.
  2. **Components:** React components built on the tokens.
- **Brand-neutral core plus themes.** Nothing in the core says "farm". The **BDP Agrofarm** theme (deep green `#0e3b2c`, gold `#e3a81b`, light background `#edf1eb`, Anek Bangla headings) is the first theme, with light and dark variants. Today's look must be reproduced exactly by this theme.
- **Contents:** everything in today's `ui.tsx` (buttons, inputs, selects, tables/DataTable, cards, drawer, tabs, badges, toasts, switch, page header, KPI, empty state). Add standard **loading** (skeleton), **empty** (friendly picture plus one action) and **error** (calm message plus retry) states. Add **"Saved ✓ · Undo"** toasts in place of "Are you sure?" pop-ups where the action can be undone.
- **Reference page:** an in-app page showing every component and token, visible only to admins. *(My call: it lives in the app, not a separate site.)*
- **Figma mirror:** after the code, the tokens and main components are copied into the owner's **free Figma** account as a library, for future sessions to design in. Code is the master copy; nobody edits Figma by hand. *(My call: this runs last and is skipped without blocking anything if the Figma connection isn't available.)*

### Brand (decided)
- **Logo: direction A, "duck in the egg".** A gold egg containing a deep-green duck, on a rounded green tile, with the wordmark "BDP Agrofarm" and "Barishal" underneath. It must be refined into a clean, balanced SVG that reads at 16 px. Deliverables:
  - full lockup in light and dark versions;
  - the mark alone;
  - browser-tab icon (`favicon.svg` plus `.ico`);
  - app icons at 192 and 512 px (normal and "maskable", for phones);
  - loading screen.
- Designed pages for **page not found**, **no internet** and **something went wrong**.
- The logo appears in the sidebar, on the sign-in page and on printed invoices and receipts.

### Customisation "knobs" (decided)
- **Each person**, in My settings, sets:
  - reading font;
  - text size, light/dark/match device, density and motion (these already exist).
- **Reading font sets**, each an English font paired with a Bangla font:
  - **Clean** (default): Inter + Hind Siliguri, as today.
  - **Easy to read:** Atkinson Hyperlegible + Noto Sans Bengali. Suggested to older staff.
  - **Friendly:** Nunito + Baloo Da 2.
- Headings always keep Anek Bangla. A font set downloads only when someone picks it.
- *(My call: the "Classic" serif set is not offered in the app; it may be used on printed reports.)*
- The **owner** setting the farm name, logo and brand colour for everyone is a non-goal for now. Today's organisation name setting stays as it is.
- **Personal settings follow the person, not the device (owner's decision).** The office PC is shared, so when someone signs in they get their own settings.
  - This covers font, text size, theme, density, motion, start page, Simple workspace and Lite mode.
  - Settings are saved on the server with the user (a new preferences field and endpoint, in the backend PR).
  - The device keeps a copy so the app paints correctly before sign-in.
  - Operators default to Simple workspace on, until they save their own choice.
- **Accent colours** (green, blue, purple, amber, already in My settings) stay as accent options *inside* the BDP theme. *(My call.)*
- **"Saved ✓ · Undo"**:
  - Undo is used only for actions that are not accounting entries, such as settings and filters.
  - Financial records are never delayed or silently reversed. After saving they show "Saved ✓" with a **Fix** link where Fix is allowed.
  - Existing "Are you sure?" checks on voids stay. *(My call.)*
- **Reference page** is visible to users with the `settings.manage` permission. *(My call.)*
- **How other projects will import it:** for now it is an npm workspace package inside this repository. Publishing it (GitHub Packages or its own repository) is decided when the SMS project starts. *(My call; out of scope now.)*

## Project 2 — Easy workspace (for staff not comfortable with computers)

### Who gets it (decided)
- Users with the **Data Entry Operator** role (`operator`) get it automatically.
- Anyone, including the owner, can switch it on or off in My settings ("Simple workspace").

### Home screen (decided)
- A greeting, then **"What do you want to record?"** with four **large picture buttons**:
  1. **Eggs collected:** daily eggs per flock, and broken eggs.
  2. **Sale & money received:** selling eggs or ducks, paid now (cash or bKash) or on credit, plus recording money received against older dues.
  3. **Bought feed / medicine:** a purchase or expense, paid now or on credit.
  4. **Deaths & feed used:** birds that died or were culled, and feed or medicine taken from stock.
- **Eggs and deaths/feed stay two buttons (owner's decision), because staff record in several sessions a day.**
  - Today the books keep one production record per flock per day, and refuse a second one.
  - New rule: the second entry of the day **adds to that day's record** rather than being refused.
    - Eggs entered in the morning, deaths and feed in the evening, all end up on one record.
    - The stock and ledger effects are posted for only the added amounts.
  - This is a backend change for the chief engineer to approve (backend PR, below). Until it is approved, the second button tells the person to ask the owner. It does not fail silently.
- Below that, **"What I recorded today"**: the person's own entries today, newest first, each with a **Fix** action (see Mistakes).
- No money totals or charts on this home screen.
- The four buttons replace the "+ New" menu for these users. *(My call: "+ New" stays for everyone else.)*

### Forms (decided)
- **One question per screen**, with Back and Next buttons, a step counter ("Step 2 of 3") and a big number pad for numbers.
- The last step is a **plain-sentence check**, e.g. "You collected 420 eggs from Flock A today. Correct?", with "Yes, save" and "Change".
- After saving: "Saved ✓" and back to the home screen.
- **Pictures on every button and step**, drawn as one consistent in-house set of simple pictograms.
- A **"?" button on every step** opens a short text explanation of the job. There is no video.
- Choices the system can guess are filled in already: today's date, the only active flock, the usual payment account. The person can still change them.
- Must work on **phones and the office PC** (staff use both). On PC: the keyboard number keys work, Enter means Next, and Esc means Back.
- These flows call **the same API endpoints** as today's drawers: production log, invoice with payment, bill/expense, payment, stock adjustment. **No new accounting logic.**

### Mistakes (decided; needs backend approval)
- People can **fix or cancel their own entries until midnight of the same day**. After that only the owner or an admin can change them, and every change stays in the audit trail.
- "Fix" means **void and re-enter**, pre-filled with the old answers. There is no in-place editing.
- **"Same day"** means the record was *created* (`createdAt`) today in **Asia/Dhaka** time. *(My call: a fixed constant, not a setting.)*
- What the code allows today, as found by checking it:
  - Operators **can** already void *any* production log from any day.
  - They **cannot** void sales, receipts or bills.
  - Voiding a cash sale requires voiding its receipt first.
  - Stock adjustments (medicine/feed taken from stock) have **no void at all**.
- The backend change, for the chief engineer to approve:
  - an operator may void a sale (with its receipt), a bill, a payment or a production log only if **they created it and it was created today**;
  - operators' existing power to void older production logs is **narrowed** to match the owner's rule ("after that only the owner or an admin");
  - a **new stock-adjustment void** (a reversing stock movement) is proposed. Until it is approved, Fix is hidden for stock adjustments.
- Until the backend change is approved, **Fix** is hidden for operators.
- **"What I recorded today"** comes from a new read-only endpoint: "my entries created today". *(My call: read-only, so no accounting logic changes.)*

### Daily reminders and "Today" checklist (decided)
Staff shouldn't have to remember to open the app. The app asks them at the right time.

- **Who:** everyone with the Data Entry Operator role. The owner gets only the "not done" notices.
- **How:** a **phone notification** (Web Push) that arrives even when the app is closed, and opens straight into the right step-by-step questions.
  - This needs FarmLedger added to the home screen once. On iPhone that is required (iOS 16.4+); on Android it is recommended.
  - The app shows a plain-words "Turn on reminders" step with pictures.
  - Requires the installable-app service worker (moved forward from Project 3) and https, which the VM already has.
- **10:00 (Asia/Dhaka), morning reminder:** "How many eggs were collected today?". It opens eggs collected → broken eggs → any ducks died, saved to today's production record.
- **Sales get no reminder.** They are recorded through the website as they happen, so they add up on their own.
- **17:00, evening reminder:** "Please record today's expenses, feed and medicine used." It opens feed used, medicine used and expenses. Each step offers a big **"None today"** answer, so a day with nothing to record can still be completed.
- **If missed:**
  - the staff are reminded again one hour later (11:00 and 18:00);
  - if a reminder is still not done by **12:00** (morning) or **19:00** (evening, *my call*), the owner gets a notice such as "Morning eggs not recorded yet".
- **"Done" means**, *my call*:
  - **morning:** every active flock has today's eggs recorded;
  - **evening:** feed used is recorded for every active flock (or answered "None"), and expenses and medicine are recorded or answered "None today".
- **"Today" checklist** on the easy home screen, above the four big buttons. It lists morning eggs and evening feed/medicine/expenses, each ticking green when done, so anyone can see at a glance what's left.
- **Reminder times are a setting that only the owner or an admin can change (owner's decision).**
  - "Admin" means anyone with the `settings.manage` permission.
  - It lives in Users & settings › Organization, as "Daily reminders".
  - It covers the morning time (default 10:00) and the evening time (default 17:00).
  - The follow-up reminder is always one hour later, and the owner's "not done" notice two hours later. *(My call.)*
  - It also has an on/off switch for the whole farm.
  - The times are saved on the server for the whole farm and apply to everyone. Staff cannot change them.
- **Backend (chief approval, part of the backend PR):**
  - storing each phone's notification subscription;
  - a small scheduler inside the API that runs at those times and checks "done";
  - sending the notifications, using a standard Web Push library, which is one new dependency.
- **Non-goals:** SMS or WhatsApp reminders. That waits for the SMS automation project.

### Sign-in (decided)
- Fingerprint or face sign-in uses the **passkeys** feature that already exists.
- After a password sign-in on a phone, offer to set up fingerprint or face sign-in once, in plain words.
- On the sign-in page, make "Sign in with fingerprint / face" the big, obvious button.

## Project 3 — Speed on slow networks and low-powered phones

### Measured today
- The first visit downloads about **330 KB compressed**: app code 59 KB, React 83 KB, **charts library (Recharts) 114 KB**, styles 12.5 KB, plus fonts and a page photo of 45–70 KB.

### Targets (my call; the builder may tune them)
- The first screen **without the charts library**: charts load only when a chart is shown, or Recharts is replaced by small in-house SVG charts.
- **First visit:** at most **170 KB** of compressed code (JS + CSS) before the first screen. The first screen appears within **4 seconds on a slow 3G connection** (as simulated in Chrome).
- **Fonts:** fewer files, using variable fonts where available. Load only the scripts and weights actually used.
- **Photos:** a smaller version for phones (about 640 px wide). **Lite mode** turns photos and animation off. It switches on automatically when the phone's data saver is on (`Save-Data` / `prefers-reduced-data`), and anyone can also switch it on in My settings.
- **Installable app (PWA):** a manifest using the new icons, plus a service worker that caches the app's own files. The second visit opens instantly, and with no connection the app shows the "no internet" screen. Data requests always go to the server; the service worker never caches API responses.
- **Size budget check:** a script that fails the automatic GitHub check when the first-visit code goes over the budget.

## Delivery

- Separate PRs, in order, each with before/after screenshots and a plain-English summary for the owner:
  1. design-system package (no visual change);
  2. brand and logo, plus loading, empty and error states;
  3. **backend, for the chief:** settings saved with the person; "add to today's production record"; "my entries today"; same-day Fix permissions; the stock-adjustment void; daily reminders (subscriptions, scheduler, push sending);
  4. font setting, and settings that follow the person;
  5. easy workspace, including the "Today" checklist, the installable-app service worker and turning on reminders;
  6. speed.
- The backend PR is opened with a clear note that the chief must approve it, and may hand it to the backend engineer.
- The frontend PRs work whether or not it is merged yet. Anything that depends on it stays hidden, or shows a plain message, until it is merged.
- PRs are **opened, never merged** by this session. Each PR is based on the previous one when it depends on it.
- All existing tests (`npm test`) and type checks pass on every PR.

## Left to the builder
- Exact token names and file layout inside `packages/design-system`, and how the CSS is bundled.
- Whether to lazy-load Recharts or replace it, as long as the budget is met and charts look the same or better.
- The final pictogram drawings and the exact wording of help text (bilingual, short, plain).
- Service-worker implementation: hand-written or a small plugin.
