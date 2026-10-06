# Manage Financial Transactions and Ledger

**Users:** Admin (records and changes); SBO Officer and Department Head (read-only)

**Manage Financial Transactions and Ledger**
|-- <<extend>> Add Financial Transaction
|   |-- <<include>> Select Transaction Type
|   |-- <<include>> Enter Transaction Details
|   |-- <<extend>> Link Transaction to Event
|   |-- <<include>> Validate Transaction Entry
|   `-- <<include>> Save Record
|-- <<extend>> Edit Financial Transaction
|   |-- <<include>> View Transaction Details
|   |-- <<include>> Update Transaction Information
|   `-- <<include>> Save Record
|-- <<extend>> Generate Receipt
|   |-- <<include>> Validate Approved Payment
|   |-- <<include>> Generate Receipt Number
|   |-- <<include>> Save Receipt Record
|   `-- <<include>> Notify User
`-- <<include>> Update Financial Balance

## Implementation Coverage

- **Role Access:** only the Admin can create, update or delete a transaction, in the API middleware and in the page controls. The Digital Ledger page and the ledger and summary endpoints can be read by the Admin, SBO Officer and Department Head for their own organization (decision (a) in `PAPER_SCOPE_ADDENDUM.md`). The SAO and students cannot read the ledger; students see only their own receipts.
- **Add Financial Transaction:** the ledger form captures type, description, amount, category, date, budget link, event link, and receipt reference.
- **Edit Financial Transaction:** Admin can open a transaction, update fields, and save through `PUT /transactions/{id}`.
- **Validate Transaction Entry:** server validation enforces positive amounts and organization-scoped budget/event/payer links.
- **Generate Receipt:** event-linked transactions can receive generated receipt numbers and manual receipt references.
- **Update Financial Balance:** transaction create/update/delete applies budget movement to remaining funds.
- **Student Financial Accounts:** Admin has a paginated accountability workspace with search, academic filters, clearance/overdue status, invoice and merchandise balances, detailed account history, charge creation, and payment recording. An Admin can cancel a charge that was made in error or waive one the student is excused from, with a required reason, as long as no payment has been approved on it. The action is audited. When an order is cancelled by the buyer or rejected by staff, its unpaid invoice is cancelled with it and the reason names the order.
- **Financial Privacy:** organization-wide student balances are Admin-only; other authenticated roles can retrieve only their own invoice records.
- **Collections and Remittances:** Admin has a dedicated custody workspace with organization-scoped totals, collection recording, second-admin verification, and partial remittance. Verification adds the collection once to the ledger; remittance changes custody totals without adding income again. The Collections and Advances page is in the Admin menu only. The SBO Officer and Department Head can read the same records through the API for their own organization and cannot change them; in the app they use the Digital Ledger, personal receipts and statements.
- **Entries made by other records:** the ledger entry a verified collection, a released cash advance, a repayment or an approved invoice payment creates carries the event that record was for, so the money shows on that event's ledger filter, summary and report. Those entries cannot be edited or deleted from the ledger; change the source record instead.
