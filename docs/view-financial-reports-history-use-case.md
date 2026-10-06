# View Financial Reports and Transaction History

**Users:** Admin; SBO Officer (read-only); Department Head (read-only, and report reviewer); SAO / Super Admin (report reviewer)

**View Financial Reports and Transaction History**
|-- <<include>> Load Financial Records
|-- <<include>> Display Transaction History
|-- <<extend>> Search Transactions
|-- <<extend>> Filter Transactions
|   |-- <<extend>> Filter by Date
|   |-- <<extend>> Filter by Event
|   `-- <<extend>> Filter by Transaction Type
|-- <<extend>> Generate Financial Report [Admin Only]
|   |-- <<include>> Choose Financial Report or Income Statement
|   |-- <<include>> Select Report Type
|   |-- <<include>> Select Covered Period
|   |-- <<include>> Retrieve Ledger Records
|   |-- <<include>> Compute Income and Expenses
|   |-- <<include>> Add Treasurer, President, Adviser, and SBO Adviser Signatories
|   |-- <<extend>> Generate Event-Specific Report
|   |-- <<extend>> Generate AI Financial Summary
|   `-- <<include>> Save Financial Report
|-- <<extend>> Submit Financial Report for Approval [Admin Only]
|   |-- <<include>> Submit to Department Head
|   |-- <<include>> Submit to SAO / Super Admin
|   |-- <<include>> Upload Supporting Documents
|   |-- <<include>> Update Submission Status
|   `-- <<include>> Notify Approvers and Requester
|-- <<extend>> Export Report as PDF
`-- <<extend>> Export Report as Excel

## Implementation Coverage

- **Role Access:** Admin owns the financial workspace and is the only role that records or changes anything, including generating and submitting reports. SBO Officers and Department Heads can read the ledger, budgets, forecasts and saved reports of their own organization and cannot change any of it (decision (a) in `PAPER_SCOPE_ADDENDUM.md`). A Department Head sees only reports that have been submitted. SAO / Super Admin receives only reports the Department Head has approved and cannot read any organization's ledger, budgets, forecasts, collections, cash advances or invoices. The audit log is open to the Admin for their own organization and to the SAO across all organizations, with the ledger modules left out of the SAO's view (decision (f)).
- **Load Financial Records:** the transaction and summary endpoints can be read by the Admin, SBO Officer and Department Head for their own organization, and only the Admin can write. The SAO and students cannot read them. Students see only their own receipts and invoices. SAO views load saved report documents instead.
- **Display Transaction History:** `FinancePage` renders transaction tables and summary cards.
- **Search and Filter Transactions:** the UI and API support text search plus event, type, from-date, and to-date filters.
- **Generate Financial Report or Income Statement:** the Admin report builder creates each as a separate saved document. Admins add named semesters with start and end dates, including an end date set to today, then select a saved semester or an event for coverage. Both documents require four signatories. The Financial Report PDF contains the detailed inflow/outflow ledger with opening and closing balances. The Income Statement PDF contains a formal submission letter plus income, expense, and net-income category totals.
- **Letterhead:** Admin may upload a PNG or JPG letterhead while generating either document. The server stores it privately and repeats it on each PDF page. Income Statements also accept the letter date, subject, recipient, body, and closing; factual defaults apply when those fields are blank.
- **Generate AI Financial Summary:** report generation sends only calculated facts to Groq and rejects summaries containing unrecognized numeric claims. If Groq fails, the calculated report remains usable with a labelled deterministic summary while the AI attempt is stored with failed status.
- **Submit and Approve Report:** Admin can attach supporting documents and submit a draft directly for review. It moves through Department Head review and then SAO review, with status changes, requester notifications, and audit logs at each decision.
- **Display and Export Report:** generated totals/summary, document type, signatories, supporting documents, and approval state are displayed. Saved reports remain available in Admin history and can be previewed for printing or downloaded as Times New Roman PDF files for the Admin, the SBO Officer, the receiving Department Head, and SAO reviewers.
- **Snapshot integrity:** new reports save the selected ledger rows, opening balance, and custody totals at generation. Viewing or downloading one of these reports uses those saved values even if a source transaction is edited later. The totals on the Department Head's approval card come from the same saved rows, so the card, the report, its PDF and its Excel file always agree. Existing reports created before the snapshot migration continue to use their original source transaction IDs.
- **Cash advances:** a cash advance release and its repayments move cash but are money lent out and returned, not income or expense. A report leaves them out of income, expenses and net income and totals them in their own "Cash advances released" and "Cash advance repayments" section, in the PDF and the Excel file too. The closing balance still matches the ledger. Reports saved before this change keep the totals they were saved with.
- **Custody context:** verified collections and recorded remittances are shown separately from ledger income. A remittance does not create another income entry. Custom report dates and event selection are validated and passed from the report form; Admin can filter saved report history and export saved details to an Excel-readable sheet.
