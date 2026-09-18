# Review and Decide Approval Requests

**Users:** Super Admin, Admin, Department Head

**Review and Decide Approval Requests**
|-- <<include>> Validate Approver Permission
|-- <<include>> Load Pending Approval Requests
|-- <<include>> Open Request Details
|   `-- <<include>> View Details
|-- <<extend>> View Related Event Details
|-- <<extend>> View Related Budget Details
|-- <<extend>> View Related Announcement Details
|-- <<extend>> View Related Election Details
|-- <<extend>> View Related Financial Report
|   |-- <<include>> View Inflows and Outflows
|   |-- <<include>> View Required Signatories
|   `-- <<include>> View Supporting Documents
|-- <<extend>> Set Financial Report Submission Deadline [Super Admin Only]
|   |-- <<include>> Select Submission Deadline
|   |-- <<include>> Publish Official Announcement
|   `-- <<include>> Notify Organization Admins
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

- **Role Access:** Super Admin, Admin, and Department Head can access approval review; the backend returns only requests requiring the authenticated reviewer's exact role. Budget requests require Super Admin.
- **Explicit Routing:** request-type routing is defined in `config/approvals.php`. An approval stores its required role and optional assigned approver; reviewers see only requests routed to their exact role and, when assigned, their own account.
- **Final Financial Review:** the Super Admin Financial Approval Center combines pending budget requests, financial reports approved by Department Heads, unverified collections, and pending cash advances. Financial-report details include calculated inflows/outflows, signatories, and supporting documents.
- **Financial Report Deadline:** Super Admin can set or update the submission deadline. Saving it publishes an important SAO announcement to all organizations and creates a notification for every active organization Admin.
- **Validate Approver Permission:** `ApprovalRequestController@review` checks the required role and prevents requesters from reviewing their own submissions.
- **Load Pending Approval Requests:** the approval list loads pending requests for the current reviewer role by default.
- **Open Request Details:** approval responses include derived title and summary details for each request.
- **View Related Details:** the review API derives details for events, budgets, announcements, elections, merchandise payments, and financial reports.
- **Approve Request:** approving updates the approval request and applies the approval to the related entity when applicable. Financial reports move from Department Head approval to SAO approval before becoming approved.
- **Reject Request:** rejecting requires a reason in both UI and API validation, updates the request, and applies rejection to supported entities.
- **Notify Requester:** review decisions create a notification for the requester.
- **Record Audit Log:** approval decisions write an audit log entry in the approvals module.
