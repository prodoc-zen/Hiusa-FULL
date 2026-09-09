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
- **Open Receipt Details:** each receipt opens an accessible details dialog with the saved amount, date, type, category, event, budget, payer, recorder, and receipt identifier.
- **Download or Print Receipt:** users can print a receipt-specific record from either the list or details dialog, and open the saved receipt file when one is attached.
