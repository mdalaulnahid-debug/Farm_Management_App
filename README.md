# FarmLedger

FarmLedger is a bilingual local prototype for recording a duck and egg farm's sales, costs, cash, customers, suppliers, production, and stock. The dashboard calculates its totals from the recorded vouchers and stock movements.

## Run on Windows

1. Extract the ZIP to a folder you can find, such as `C:\FarmLedger`.
2. Open that folder and double-click `start-farmledger.bat`.
3. On first start, the script installs dependencies. Keep the terminal open and visit the `Local` address it prints, normally [http://localhost:5173](http://localhost:5173).

The app saves data in the current browser on that computer. Keep using the same browser profile. Browser storage is not a shared database or a backup.

## Main modules

- **Overview:** October source closing balances carry into November 2026. Monthly sales, cost, cash, and stock summaries recalculate from entries.
- **Sales vouchers:** Sale quantity, unit price, discount, total, cash received, and customer balance due are connected. Sales reduce egg stock.
- **Cost vouchers:** Accrued cost and amount paid are separate. Inventory purchases add stock; operating costs feed expense totals.
- **Cash ledger:** Records subsequent customer collections and supplier payments, calculates expected book cash, and compares it with recorded physical cash counts.
- **Production & stock:** Records egg harvest, gifts/contributions, waste/loss, feed received/used, and duck additions/mortality.
- **Customers and suppliers:** Stores names and contact numbers, and shows balances from this month's vouchers.
- **Reports:** Downloads selected-month vouchers as CSV.
- **Settings:** English/Bangla, light/dark/farm-green themes, font size, compact/comfortable layout, and opening balances.

## October workbook data

October 2026 workbook activity is retained as historical source data; it is not copied into November. The workbook's 28/10/27 date typo is preserved in the source note and normalized to 28 October 2026 for ordering. Current November opening figures are BDT 15,897 cash, BDT 7,072 receivables, zero eggs, and 11,425 feed quantity (unit needs confirmation). Verify the October feed quantity and cost treatment before relying on profit totals. The workbook is also included under `upload/`.

## Current project stage

This is a local browser prototype, not yet a production multi-user farm system. It has no server database, login/user roles, cloud sync, automated backups, receipt attachment storage, approval/audit trail, or production accounting review. Keep regular exports/backups before entering important new records. GitHub publishing remains separate and has not been done.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the proposed database and production foundation.
