# View Financial Reports and Transaction History

**Users:** Admin; SAO / Super Admin for final review

**View Financial Reports and Transaction History**
|-- <<include>> Load Financial Records
|-- <<include>> Display Transaction History
|-- <<extend>> Search Transactions
|-- <<extend>> Filter Transactions
|   |-- <<extend>> Filter by Date
|   |-- <<extend>> Filter by Event
|   `-- <<extend>> Filter by Transaction Type
|-- <<extend>> Generate Financial Report [Admin Only]
|   |-- <<include>> Select Report Type
|   |-- <<include>> Select Covered Period
|   |-- <<include>> Retrieve Ledger Records
|   |-- <<include>> Compute Income and Expenses
|   |-- <<include>> Add Treasurer, President, Adviser, and SBO Adviser Signatories
|   |-- <<extend>> Generate Event-Specific Report
|   |-- <<extend>> Generate AI Financial Summary
|   `-- <<include>> Save Financial Report
|-- <<extend>> Submit Financial Report for Approval [Admin Only]
|   |-- <<include>> Check SAO Submission Deadline
|   |-- <<include>> Submit to Department Head
|   |-- <<include>> Submit to SAO / Super Admin
|   |-- <<include>> Upload Supporting Documents
|   |-- <<include>> Update Submission Status
|   `-- <<include>> Notify Approvers and Requester
|-- <<extend>> Export Report as PDF
`-- <<extend>> Export Report as Excel

## Implementation Coverage

- **Role Access:** Admin can read the organization's financial workspace and generate or submit reports. SAO / Super Admin has a dedicated cross-organization final-review workspace. Department Heads review routed report requests through the approval center without receiving general finance access; SBO Officers cannot access organization financial records.
- **Load Financial Records:** transaction and summary endpoints load organization-scoped records. SAO can view all organizations or filter to one organization.
- **Display Transaction History:** `FinancePage` renders transaction tables and summary cards.
- **Search and Filter Transactions:** the UI and API support text search plus event, type, from-date, and to-date filters.
- **Generate Financial Report:** the Admin report builder supports monthly, semester, custom-period, and event-specific reports, requires the four signatories, computes totals/category data, stores source transaction IDs, and saves a draft report to history.
- **Generate AI Financial Summary:** report generation sends only calculated facts to Groq and rejects summaries containing unrecognized numeric claims. If Groq fails, the calculated report remains usable with a labelled deterministic summary while the AI attempt is stored with failed status.
- **Submit and Approve Report:** before the current SAO deadline, Admin can attach supporting documents and submit the draft. It moves through Department Head review and then SAO review, with status changes, requester notifications, and audit logs at each decision.
- **Display and Export Report:** generated totals/summary, signatories, supporting documents, and approval state are displayed; report data exports as Excel-compatible `.xls` or opens as a print-ready PDF, and saved reports remain available in history.
