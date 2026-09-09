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

- **Role Access:** Admin and SBO Officer open **Submit Request** from the sidebar and only see request types they are authorized to create. Route guards independently protect every destination form.
- **Select Request Type:** `/dashboard/approval-requests/new` is the common request-type selector. Admin can start announcements, budgets, events, and elections; SBO Officers can start announcements and budgets. Payment approvals continue to originate from submitted merchandise payment proof because the payer owns that submission flow.
- **Enter Request Details:** the originating module captures the request details before creating the approval request.
- **Attach Supporting Information:** modules can attach supporting fields such as event planning details, budget information, announcement content, or payment proof.
- **Validate Request Information:** originating controllers validate request payloads before saving the target record.
- **Save Request as Pending:** `ApprovalRequest::create` saves approval requests with pending status.
- **Notify Approver:** the `ApprovalRequest` model notifies active users with the required approver role when a request is created.
- **Record Audit Log:** approval submissions write an audit log entry in the approvals module.

The selector does not create free-form or entity-less approval rows. It opens the existing module form so server validation, organization scoping, pending-state creation, approver notification, and audit logging remain authoritative.
