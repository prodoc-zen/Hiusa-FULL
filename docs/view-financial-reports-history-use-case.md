# View Financial Reports and Transaction History

**Users:** Admin, Department Head, SBO Officer

**View Financial Reports and Transaction History**
|-- <<include>> Load Financial Records
|-- <<include>> Display Transaction History
|-- <<extend>> Search Transactions
|-- <<extend>> Filter Transactions
|   |-- <<extend>> Filter by Date
|   |-- <<extend>> Filter by Event
|   `-- <<extend>> Filter by Transaction Type
|-- <<extend>> Generate Financial Report
|   |-- <<include>> Select Report Type
|   |-- <<include>> Select Covered Period
|   |-- <<include>> Retrieve Ledger Records
|   |-- <<include>> Compute Income and Expenses
|   |-- <<extend>> Generate Event-Specific Report
|   |-- <<extend>> Generate AI Financial Summary
|   `-- <<include>> Display Report
|-- <<extend>> Export Report as PDF
`-- <<extend>> Export Report as Excel

## Implementation Coverage

- **Role Access:** Admin, Department Head, and SBO Officer can access transaction history/report routes and read APIs.
- **Load Financial Records:** transaction and summary endpoints load organization-scoped records.
- **Display Transaction History:** `FinancePage` renders transaction tables and summary cards.
- **Search and Filter Transactions:** the UI and API support text search plus event, type, from-date, and to-date filters.
- **Generate Financial Report:** the report builder supports monthly, semester, custom-period, and event-specific reports, computes totals/category data, stores source transaction IDs, and saves the report to history.
- **Generate AI Financial Summary:** report generation sends only calculated facts to Groq and rejects summaries containing unrecognized numeric claims. If Groq fails, the calculated report remains usable with a labelled deterministic summary while the AI attempt is stored with failed status.
- **Display and Export Report:** generated totals/summary are displayed immediately; report data exports as Excel-compatible `.xls` or opens as a print-ready PDF, and saved report summaries remain available in history.
