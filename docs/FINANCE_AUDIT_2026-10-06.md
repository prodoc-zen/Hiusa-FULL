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

## Still open

Listed most important first. File pointers are where the fix belongs.

1. **System-created ledger entries can be edited or deleted.** Entries created by a verified collection, a released cash advance, an invoice payment or a paid merchandise order can be deleted from the ledger like manual ones. The source record then still says verified, released or paid, but the money is gone from the ledger. Block edit and delete for these in `TransactionController` (return a clear message pointing to the source record).
2. **An order paid through an invoice is counted twice.** Linking an invoice to a pending order makes the student owe it twice on Student Financial Accounts. Paying the invoice leaves the order pending, and marking the order paid then records a second income entry for the same money. See the invoice and order payment paths in `FinancialAccountabilityController` and `OrderController`.
3. **Event-linked collections are not attributed to the event.** A verified collection with an event does not carry the event to its ledger entry, so the event's ledger filter and event financial report show ₱0 income. Copy `event_id` when the collection is verified.
4. **The event financial summary counts unapproved budgets.** Pending and rejected budgets are included in an event's allocated and remaining amounts. Only approved budgets should count (`EventController` financial summary).
5. **Budget advice, financial reports and event summaries use an old forecast.** They pick the forecast with the highest period text, so "Q4 2024 (Oct-Dec)" wins over a newly generated "2026-11". Choose the most recent forecast by when it was generated.
6. **Forecasts are made for the current month instead of the next.** Generated on October 6, the forecast period is October, which is mostly empty; it should be November.
7. **The Department Head's approval card disagrees with the report.** The card recomputes totals from the live ledger, while the report, its PDF and its Excel file use the snapshot taken when it was generated. The card should show the snapshot.
8. **Cash advances are treated as spending and earning.** Releases and repayments land in the income statement and the forecast input as ordinary expense and income, which distorts both. Exclude them or show them separately.
9. **No checks against available funds.** A budget can be allocated, and a cash advance released, beyond the money in the ledger.
10. **Financial semesters cannot be edited or removed.** Only list and create routes exist, so a wrong end date cannot be fixed.
11. **Some use-case documents describe the old access rules.** `docs/view-financial-reports-history-use-case.md` and `docs/manage-financial-transactions-ledger-use-case.md` say officers and department heads cannot read the ledger, and that the SAO cannot read the audit log. Both changed (see decisions (a) and (f) in `docs/PAPER_SCOPE_ADDENDUM.md`).

## Checked and working

- Who can see and do what in finance, for all five roles and across organizations: no leaks found.
- Ledger net balance equals income minus expense, and the summary cards, collections page and reports agree on a clean dataset.
- Only approved budgets accept entries; budget approval follows `config/approvals.php` (Department Head, single stage).
- Report generation and the Department Head then SAO review chain, including return and resubmission (covered by `FinancialReportSubmissionWorkflowTest`).
- Forecast math with no history, gap months and a partial month; the PHP fallback matches the AI service.
