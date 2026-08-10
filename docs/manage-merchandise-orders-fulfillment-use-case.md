# Manage Merchandise Orders and Fulfillment

**Users:** Admin, SBO Officer

**Manage Merchandise Orders and Fulfillment**
|-- <<include>> Load Pending Orders
|-- <<include>> View Order Details
|   `-- <<include>> View Details
|-- <<include>> Verify Payment Submission
|   |-- <<include>> View Payment Proof
|   |-- <<include>> Match Payment Amount
|   |-- <<include>> Validate GCash Reference
|   `-- <<extend>> Mark Payment as Invalid
|-- <<extend>> Approve Payment
|   |-- <<include>> Generate Digital Receipt
|   |-- <<include>> Generate Claim Token
|   `-- <<include>> Notify Buyer
|-- <<extend>> Reject Payment
|   |-- <<include>> Enter Rejection Reason
|   `-- <<include>> Notify Buyer
|-- <<include>> Validate Claim Token
|   |-- <<include>> Check Token Ownership
|   |-- <<include>> Check Token Status
|   `-- <<extend>> Reject Used or Invalid Token
|-- <<include>> Release Merchandise Item
`-- <<include>> Update Order Status

## Implementation Coverage

- **Role Access:** Admin and SBO Officer can access order fulfillment and token validation.
- **Load Pending Orders:** `GET /orders` loads organization orders for fulfillment roles.
- **View Order Details:** order rows include buyer, item, quantity, total, review status, payment reference, proof, and claim token for fulfillment staff.
- **Verify Payment Submission:** order records store payment method, payment reference, and payment proof URL.
- **Approve Payment:** an SBO Officer submits the payment review to Admin; Admin approval creates/links a receipt transaction, releases the claim token, and notifies the buyer.
- **Reject Payment:** cancelling an order stores review remarks, restores stock when needed, and notifies the buyer.
- **Validate Claim Token:** `POST /orders/claim` rejects invalid, unpaid, or already claimed tokens.
- **Release Merchandise Item:** successful claim marks the order as claimed and records verifier/timestamp.
- **Update Order Status:** fulfillment actions update order status through `OrderController`.
