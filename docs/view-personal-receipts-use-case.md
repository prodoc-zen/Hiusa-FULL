# View Personal Receipts

**Users:** Admin, SBO Officer, Department Head, Student

**View Personal Receipts**
|-- <<include>> Validate Receipt Ownership
|-- <<include>> Load User Transactions
|-- <<include>> Load Approved Payment Records
|-- <<include>> Display Personal Receipt List
|-- <<extend>> Open Receipt Details
|   `-- <<include>> View Details
`-- <<extend>> Download or Print Receipt

## Implementation Coverage

- **Role Access:** all four roles can access personal receipts.
- **Validate Receipt Ownership:** receipt queries return transactions where the authenticated user is payer or recorder.
- **Load User Transactions:** `GET /transactions/personal-receipts` loads owned receipt-bearing transactions.
- **Load Approved Payment Records:** saved receipt references, receipt numbers, and receipt files are treated as approved/saved payment records.
- **Display Personal Receipt List:** `FinancePage` renders personal receipts with amount, date, source, and receipt identifier.
- **Download or Print Receipt:** the receipt list exposes a print action for local receipt output.
