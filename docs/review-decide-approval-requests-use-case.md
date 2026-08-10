# Review and Decide Approval Requests

**Users:** Admin, Department Head

**Review and Decide Approval Requests**
|-- <<include>> Validate Approver Permission
|-- <<include>> Load Pending Approval Requests
|-- <<include>> Open Request Details
|   `-- <<include>> View Details
|-- <<extend>> View Related Event Details
|-- <<extend>> View Related Budget Details
|-- <<extend>> View Related Announcement Details
|-- <<extend>> View Related Election Details
|-- <<extend>> Approve Request
|   |-- <<include>> Update Request Status
|   |-- <<include>> Notify Requester
|   `-- <<include>> Record Audit Log
`-- <<extend>> Reject Request
    |-- <<include>> Enter Rejection Reason
    |-- <<include>> Update Request Status
    |-- <<include>> Notify Requester
    `-- <<include>> Record Audit Log

## Implementation Coverage

- **Role Access:** Admin and Department Head can access approval review; backend authorization also enforces the reviewer role.
- **Validate Approver Permission:** `ApprovalRequestController@review` checks the required role and prevents requesters from reviewing their own submissions.
- **Load Pending Approval Requests:** the approval list loads pending requests for the current reviewer role by default.
- **Open Request Details:** approval responses include derived title and summary details for each request.
- **View Related Details:** the review API derives details for events, budgets, announcements, elections, and merchandise payments.
- **Approve Request:** approving updates the approval request and applies the approval to the related entity when applicable.
- **Reject Request:** rejecting requires a reason in both UI and API validation, updates the request, and applies rejection to supported entities.
- **Notify Requester:** review decisions create a notification for the requester.
- **Record Audit Log:** approval decisions write an audit log entry in the approvals module.
