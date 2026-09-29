# View Financial Reports and Transaction History

**Users:** Admin; Department Head and SAO / Super Admin as report recipients and reviewers

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

- **Role Access:** Admin owns the financial workspace and generates or submits reports. Department Heads receive submitted reports from their organization. SAO / Super Admin receives only reports already approved by the Department Head. Neither recipient role can access the financial ledger, budgets, forecasts, collections, cash advances, invoices, audit log, or report generation controls.
- **Load Financial Records:** transaction and summary endpoints are Admin-only. Recipient views load saved report documents rather than the underlying finance module.
- **Display Transaction History:** `FinancePage` renders transaction tables and summary cards.
- **Search and Filter Transactions:** the UI and API support text search plus event, type, from-date, and to-date filters.
- **Generate Financial Report or Income Statement:** the Admin report builder creates each as a separate saved document. Admins add named semesters with start and end dates, including an end date set to today, then select a saved semester or an event for coverage. Both documents require four signatories. The Financial Report PDF contains the detailed inflow/outflow ledger with opening and closing balances. The Income Statement PDF contains a formal submission letter plus income, expense, and net-income category totals.
- **Letterhead:** Admin may upload a PNG or JPG letterhead while generating either document. The server stores it privately and repeats it on each PDF page. Income Statements also accept the letter date, subject, recipient, body, and closing; factual defaults apply when those fields are blank.
- **Generate AI Financial Summary:** report generation sends only calculated facts to Groq and rejects summaries containing unrecognized numeric claims. If Groq fails, the calculated report remains usable with a labelled deterministic summary while the AI attempt is stored with failed status.
- **Submit and Approve Report:** Admin can attach supporting documents and submit a draft directly for review. It moves through Department Head review and then SAO review, with status changes, requester notifications, and audit logs at each decision.
- **Display and Export Report:** generated totals/summary, document type, signatories, supporting documents, and approval state are displayed. Saved reports remain available in Admin history and can be previewed for printing or downloaded as Times New Roman PDF files for Admin, the receiving Department Head, and SAO reviewers.
- **Snapshot integrity:** new reports save the selected ledger rows, opening balance, and custody totals at generation. Viewing or downloading one of these reports uses those saved values even if a source transaction is edited later. Existing reports created before the snapshot migration continue to use their original source transaction IDs.
- **Custody context:** verified collections and recorded remittances are shown separately from ledger income. A remittance does not create another income entry. Custom report dates and event selection are validated and passed from the report form; Admin can filter saved report history and export saved details to an Excel-readable sheet.
