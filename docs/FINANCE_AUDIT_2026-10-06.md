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
| The Department Head's approval card disagreed with the report, because it recomputed totals from the live ledger | The card reads the rows saved when the report was generated, the same rows the report view, its PDF and its Excel file use | ca99e39 |
| Cash advances counted as spending and earning in the income statement, the financial report and the forecast history | Releases and repayments stay in the ledger but are left out of income, expense and the forecast history. Reports total them in their own "Cash advances released" and "Cash advance repayments" section, in the PDF and Excel too, and the closing balance still matches the ledger. They are found through the records that created them, not the category text. Reports saved before this keep their saved totals | 6271278 |
| Cash advances, repayments and invoice payments for an event were missing from that event's ledger filter, summary and report | Their ledger entries now carry the event, and a one-off migration fills in the older ones | d6d4dc2 |
| An invoice stayed open when its order was cancelled or rejected, and there was no way to cancel or waive one | An Admin can cancel or waive an unpaid invoice from Student Financial Accounts with a required reason, audited, and refused once a payment is approved. Cancelling or rejecting an order cancels its unpaid invoice with a reason naming the order. A cancelled or waived invoice shows no balance and takes no payment | 2e1e46f |
| Two use-case documents said officers and department heads cannot read the ledger and that the SAO cannot read the audit log | Both now match decisions (a) and (f) of the paper scope addendum | 2a24279 |

After pulling, restart the AI service with `HIUSA_AI_RELOAD=false` so it uses the new forecast month; until then the PHP fallback answers with the same numbers. Run `php artisan migrate` too: one-off migrations give collections, cash advances, repayments and invoice payments recorded before the fixes their event on the ledger, and one adds the reason column that cancelled and waived invoices use.

## Still open

Listed most important first. File pointers are where the fix belongs.

1. **No checks against available funds.** A budget can be allocated, and a cash advance released, beyond the money in the ledger.
2. **Financial semesters cannot be edited or removed.** Only list and create routes exist, so a wrong end date cannot be fixed.

## Checked and working

- Who can see and do what in finance, for all five roles and across organizations: no leaks found.
- Ledger net balance equals income minus expense, and the summary cards, collections page and reports agree on a clean dataset. Cash advance entries are the one difference by design: the ledger cards still count them because they move cash, while reports total them in their own section.
- Only approved budgets accept entries; budget approval follows `config/approvals.php` (Department Head, single stage).
- Report generation and the Department Head then SAO review chain, including return and resubmission (covered by `FinancialReportSubmissionWorkflowTest`).
- Forecast math with no history, gap months and a partial month; the PHP fallback matches the AI service.
