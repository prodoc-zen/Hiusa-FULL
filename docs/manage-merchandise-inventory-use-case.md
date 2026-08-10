# Manage Merchandise Inventory

**Users:** Admin

**Manage Merchandise Inventory**
|-- <<extend>> Add Merchandise Item
|   |-- <<include>> Enter Item Details
|   |-- <<include>> Set Item Price
|   |-- <<include>> Set Stock Quantity
|   |-- <<extend>> Upload Merchandise Image
|   `-- <<include>> Save Record
|-- <<extend>> Update Merchandise Item
|   |-- <<include>> View Item Details
|   |-- <<include>> Edit Item Information
|   |-- <<extend>> Update Stock Level
|   `-- <<include>> Save Record
`-- <<extend>> Deactivate Merchandise Item
    |-- <<include>> Confirm Deactivation
    `-- <<include>> Record Audit Log

## Implementation Coverage

- **Role Access:** Admin-only inventory route, sidebar entry, and merchandise write API middleware.
- **Add Merchandise Item:** `MerchandisePage` captures name, category, description, price, stock quantity, active status, and optional image.
- **Upload Merchandise Image:** `MerchandiseController` accepts JPEG, PNG, JPG, and WebP image uploads.
- **Update Merchandise Item:** Admin can open existing item details, edit item information, update stock, and save.
- **Deactivate Merchandise Item:** item deactivation requires UI confirmation and sets `is_active` to false instead of deleting the record.
- **Record Audit Log:** merchandise deactivation writes an audit log entry.
