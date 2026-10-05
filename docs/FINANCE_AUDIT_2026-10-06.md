# Finance audit, 2026-10-06

An end-to-end check of the financial module: every way money moves, whether every screen's totals agree, approvals, forecasts, reports, dates, and who can see what. Each item was reproduced with a test against the API.

## Fixed and pushed

| Problem | Fix | Commit |
|---|---|---|
| Editing a transaction, a forecast or a task failed with a server error (500) | The partial-update rule was written as one string instead of a list | 0f981b1 |
| Dates in the ledger, personal receipts and reports showed one day early, and re-saving a transaction moved it back a day each time | Finance models now send dates in Manila time (`2026-10-05T00:00:00+08:00`) instead of UTC | f991664 |
| Approving a budget again after an edit reset its remaining amount to the full allocation, erasing the spending already recorded; deleting an entry afterwards pushed it above its allocation | Approval now recomputes remaining as allocation + linked income − linked expense | e91d23f |
| The overspending risk stayed stale after the allocation or warning threshold changed | Risk is recomputed on edits and on approval, with one shared rule on the Budget model | e91d23f |
| The dashboard's "spent" figure was wrong when a budget had both income and expenses | Spending and income now come from the entries recorded against approved budgets | 6398761 |
| Ledger entries made by a verified collection, a released cash advance or its repayment, an approved invoice payment or a paid merchandise order could be edited or deleted like manual ones, leaving the source record saying verified, released or paid with the money gone | Editing or deleting one now returns a 409 that names the source record and the page to change it from; manual entries stay editable | d75ebcc |
| An order billed on an invoice was owed twice on Student Financial Accounts, paying the invoice left the order pending, and marking the order paid posted a second income entry | The debt counts the invoice only. Paying the invoice in full marks the order paid and links it to that payment's ledger entry. Marking such an order paid from the order side or the approvals queue is refused while the invoice has a balance. Only a pending order can be billed on an invoice | b4a04e6 |
| A verified collection linked to an event showed ₱0 income on the event's ledger filter, summary and event financial report | Verifying the collection copies its event to the ledger entry | e6fbcdc |
| An event's financial summary counted pending and rejected budgets in its allocated and remaining amounts | Only approved budgets count | 20d9373 |
| Budget advice, financial reports and event summaries used the forecast with the highest period text, so an old "Q4 2024 (Oct-Dec)" beat a new "2026-11" | One lookup picks the forecast generated most recently (created time, then id) | 8401d94 |
| Forecasts were made for the month after the last month with entries, which was often the month in progress | Generation targets the next calendar month after today in Asia/Manila. The PHP fallback and the Python engine project to the same month, and an answer from an engine that predates the target is ignored | a9c1fad |

After pulling, restart the AI service with `HIUSA_AI_RELOAD=false` so it uses the new forecast month; until then the PHP fallback answers with the same numbers. Run `php artisan migrate` too: a one-off migration gives collections verified before the fix their event on the ledger.

## Still open

Listed most important first. File pointers are where the fix belongs.

1. **The Department Head's approval card disagrees with the report.** The card recomputes totals from the live ledger, while the report, its PDF and its Excel file use the snapshot taken when it was generated. The card should show the snapshot.
2. **Cash advances are treated as spending and earning.** Releases and repayments land in the income statement and the forecast input as ordinary expense and income, which distorts both. Exclude them or show them separately.
3. **No checks against available funds.** A budget can be allocated, and a cash advance released, beyond the money in the ledger.
4. **Financial semesters cannot be edited or removed.** Only list and create routes exist, so a wrong end date cannot be fixed.
5. **Some use-case documents describe the old access rules.** `docs/view-financial-reports-history-use-case.md` and `docs/manage-financial-transactions-ledger-use-case.md` say officers and department heads cannot read the ledger, and that the SAO cannot read the audit log. Both changed (see decisions (a) and (f) in `docs/PAPER_SCOPE_ADDENDUM.md`).
6. **Event-linked cash advances, repayments and invoice payments do not carry the event to their ledger entries,** so they are missing from that event's ledger filter and report (the same gap item 3 fixed for collections).
7. **An invoice stays open when its order is cancelled or rejected.** There is no way to cancel or waive an invoice, so the student keeps owing it.

## Checked and working

- Who can see and do what in finance, for all five roles and across organizations: no leaks found.
- Ledger net balance equals income minus expense, and the summary cards, collections page and reports agree on a clean dataset.
- Only approved budgets accept entries; budget approval follows `config/approvals.php` (Department Head, single stage).
- Report generation and the Department Head then SAO review chain, including return and resubmission (covered by `FinancialReportSubmissionWorkflowTest`).
- Forecast math with no history, gap months and a partial month; the PHP fallback matches the AI service.
