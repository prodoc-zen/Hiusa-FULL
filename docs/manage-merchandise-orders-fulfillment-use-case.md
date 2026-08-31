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

## Preconditions

- **GCash payment requires an admin-configured QR code.** Fulfillment staff cannot expect GCash proof or references until an ADMIN uploads the organization's official QR code at `/dashboard/merchandise/gcash-payment` (`POST /api/merchandise/gcash-settings`). Until that upload exists, buyers are blocked from paying by GCash: `POST /api/orders` with `payment_method: gcash` and `POST /api/orders/{id}/payment` both return 422 with the message "GCash payment is unavailable until an administrator uploads the official QR code." Cash orders reach the fulfillment queue normally regardless of this precondition.

## Implementation Coverage

- **Role Access:** Admin and SBO Officer can access order fulfillment and token validation.
- **Load Pending Orders:** `GET /orders` loads organization orders for fulfillment roles.
- **View Order Details:** order rows include buyer, item, quantity, total, review status, payment reference, proof, and claim token for fulfillment staff.
- **Verify Payment Submission:** order records store payment method, payment reference, and payment proof URL.
- **Approve Payment:** an SBO Officer may submit payment review to Admin through the approval queue. An Admin may also approve or reject directly from Manage Orders, bypassing the officer review. Direct Admin approval remains amount/proof validated, audit logged, resolves any pending payment approval request, creates/links the receipt transaction, releases the claim token, and notifies the buyer.
- **Reject Payment:** cancelling an order stores review remarks, restores stock when needed, and notifies the buyer.
- **Validate Claim Token:** `POST /orders/claim` rejects invalid, unpaid, or already claimed tokens.
- **Release Merchandise Item:** successful claim marks the order as claimed and records verifier/timestamp.
- **Update Order Status:** fulfillment actions update order status through `OrderController`.
