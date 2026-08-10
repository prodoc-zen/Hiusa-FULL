# Submit Requests for Approval

**Users:** Admin, SBO Officer

**Submit Requests for Approval**
|-- <<include>> Select Request Type
|-- <<include>> Enter Request Details
|-- <<extend>> Attach Supporting Information
|-- <<include>> Validate Request Information
|-- <<include>> Save Request as Pending
|-- <<include>> Notify Approver
|   `-- <<include>> Notify User
`-- <<include>> Record Audit Log

## Implementation Coverage

- **Role Access:** Admin and SBO Officer submit approval-backed requests through the modules they are authorized to create.
- **Select Request Type:** approval requests store the entity type for events, budgets, elections, announcements, and payments.
- **Enter Request Details:** the originating module captures the request details before creating the approval request.
- **Attach Supporting Information:** modules can attach supporting fields such as event planning details, budget information, announcement content, or payment proof.
- **Validate Request Information:** originating controllers validate request payloads before saving the target record.
- **Save Request as Pending:** `ApprovalRequest::create` saves approval requests with pending status.
- **Notify Approver:** the `ApprovalRequest` model notifies active users with the required approver role when a request is created.
- **Record Audit Log:** approval submissions write an audit log entry in the approvals module.
