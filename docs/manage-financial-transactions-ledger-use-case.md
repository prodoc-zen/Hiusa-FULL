# Manage Financial Transactions and Ledger

**Users:** Admin

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

- **Role Access:** Admin-only ledger route and create/update/delete transaction API middleware.
- **Add Financial Transaction:** the ledger form captures type, description, amount, category, date, budget link, event link, and receipt reference.
- **Edit Financial Transaction:** Admin can open a transaction, update fields, and save through `PUT /transactions/{id}`.
- **Validate Transaction Entry:** server validation enforces positive amounts and organization-scoped budget/event/payer links.
- **Generate Receipt:** event-linked transactions can receive generated receipt numbers and manual receipt references.
- **Update Financial Balance:** transaction create/update/delete applies budget movement to remaining funds.
- **Student Financial Accounts:** Admin has a paginated accountability workspace with search, academic filters, clearance/overdue status, invoice and merchandise balances, detailed account history, charge creation, and payment recording.
- **Financial Privacy:** organization-wide student balances are Admin-only; other authenticated roles can retrieve only their own invoice records.
