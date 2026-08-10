# Order Merchandise and Claim Items

**Users:** Admin, SBO Officer, Department Head, Student

**Order Merchandise and Claim Items**
|-- <<include>> Browse Merchandise Catalog
|-- <<include>> View Item Details
|-- <<include>> Check Item Availability
|-- <<extend>> Reserve Merchandise Item
|   |-- <<include>> Enter Order Details
|   |-- <<include>> Save Order as Pending
|   `-- <<include>> Notify Officer
|-- <<extend>> Submit GCash Payment Proof
|   |-- <<include>> Upload Payment Proof
|   |-- <<include>> Enter Reference Number
|   `-- <<include>> Save Payment Submission
|-- <<include>> Track Order Status
|-- <<extend>> Receive Digital Receipt
|-- <<extend>> Receive Claim Token
`-- <<extend>> Present Claim Token for Validation

## Implementation Coverage

- **Role Access:** all four documented roles can browse, order, view personal orders, and view claim tokens.
- **Browse Merchandise Catalog:** catalog views only show active in-stock merchandise for ordering.
- **View Item Details:** item cards display image, name, description, price, and stock status.
- **Check Item Availability:** cart validation prevents ordering beyond available stock.
- **Reserve Merchandise Item:** checkout creates pending orders and decrements stock.
- **Submit GCash Payment Proof:** checkout requires a reference number and image upload, then stores the proof URL on the pending order.
- **Track Order Status:** personal order views load only the current user's orders using `mine=1`.
- **Receive Digital Receipt:** approved payments create linked receipt transactions.
- **Receive Claim Token:** the reserved token remains hidden from the buyer until Admin approves payment.
- **Present Claim Token for Validation:** personal token views show active tokens for pickup.
