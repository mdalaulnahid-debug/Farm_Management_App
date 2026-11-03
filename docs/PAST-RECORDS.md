# Bringing past records into FarmLedger

The past records template brings the farm's history from before FarmLedger into the books, so reports
show the farm's true position: money in hand and in the bank, what customers owe, what the farm owes,
stock, flocks, and the day-by-day eggs, sales, purchases, payments and grants.

## 1. Fill the template

1. Choose **Download template**. The first sheet, **Instructions**, explains every column.
2. Fill the sheets you have records for, from row 3. Row 2 is an example and is skipped.
   - **Start**: the first day of the books, with cash, bank and mobile banking on that day.
   - **Customers & suppliers**: names, type, and what they owed or were owed on the start date.
   - **Items & stock**: items, and the stock on hand on the start date with its cost.
   - **Flocks**: each flock and its birds.
   - **Daily eggs & sales**, **Purchases & expenses**, **Payments**, **Grants**: one row per record,
     dated on or after the start date.
3. Type dates as day/month/year (15/03/2026). Bangla digits are fine.

## 2. Upload, check, import

1. Choose **Choose .xlsx file** and pick the filled template.
2. The preview lists every problem by sheet, row and column. Fix them in the file and upload it again.
   Nothing is saved until you press **Import past records**.
3. The preview shows the totals per sheet and the books after the import. Check them against your
   paper records.
4. If the books already hold records in the same dates, or opening balances, the preview warns you.
   Tick the box only after checking that you are not entering the same records twice.

The same records cannot be imported twice, and neither can a second file with the same start date while
the first import stands (its opening balances would be counted twice). To correct an import, undo it in
**Import history**, fix the file and import it again. An import cannot be undone while a payment entered
later settles one of its records; void that payment first if it is wrong.

One file takes at most 5,000 rows. For a longer history, use one file per year: the first with the start
balances, the next ones with a later start date and no opening figures. The preview briefly holds other
saves, so check large files outside busy hours.

## How the books record it

- Opening cash, bank, dues and stock are posted on the start date against **Opening balance equity**,
  so the ledger stays balanced.
- Everything else is posted exactly as if it had been typed in: production, sales, purchases, payments
  (dues settled oldest first) and grants (as income, not sales).
- Names that are new are added as customers, suppliers or items, and the preview notes each one.
- Undo voids every record of the import, and sets the customers, items and flocks it added to inactive
  (flocks closed) when nothing else uses them.
