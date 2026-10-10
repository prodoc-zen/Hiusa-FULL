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

- **Role Access:** Super Admin, Admin, and Department Head can access approval review; the backend returns only requests requiring the authenticated reviewer's exact role. Budget requests require another Admin, while Super Admin receives only final-stage financial report requests.
- **Explicit Routing:** request-type routing is defined in `config/approvals.php`. An approval stores its required role and optional assigned approver; reviewers see only requests routed to their exact role and, when assigned, their own account.
- **Final Financial Review:** Super Admin receives only financial reports approved by Department Heads. Report details include the generated PDF, calculated summary, signatories, and supporting documents.
- **Validate Approver Permission:** `ApprovalRequestController@review` checks the required role and prevents requesters from reviewing their own submissions.
- **Load Pending Approval Requests:** the approval list loads pending requests for the current reviewer role by default.
- **Open Request Details:** approval responses include derived title and summary details for each request.
- **View Related Details:** the review API derives details for events, budgets, announcements, elections, merchandise payments, and financial reports.
- **Approve Request:** approving updates the approval request and applies the approval to the related entity when applicable. Financial reports move from Department Head approval to SAO approval before becoming approved.
- **Reject Request:** rejecting requires a reason in both UI and API validation, updates the request, and applies rejection to supported entities.
- **Notify Requester:** review decisions create a notification for the requester.
- **Record Audit Log:** approval decisions write an audit log entry in the approvals module.

## Row Payload and Single Request Endpoint

`GET /api/approval-requests` and `GET /api/approval-requests/{approvalRequest}` return the same row shape: the approval fields, `requester`, `reviewer`, `assignedApprover`, `title` and `summary`. The summary is built from one query per entity type for the whole page, and its key names match the events, elections, budgets and financial reports payloads, so one lifecycle function reads the same stage on every page.

| `entity_type` | Lifecycle keys in `summary` |
|---|---|
| `event` | `status`, `approval_stage` (the `EventApprovalChain` stage, same as `/api/events`), `requirements_required`, `requirements_submitted`, `requires_budget`, `budgets` (`[{id, submission_status}]`), `tasks_count`, `completed_tasks_count`, `present_count`, plus `start_time`, `end_time`, `location`, `requirement_files` |
| `election` | `status`, `finalized_at`, `results_visible`, `approval_status` (status of the election's latest approval request), plus `start_time`, `end_time`, `target_status` |
| `budget` | `submission_status`, `allocated_amount`, `remaining_amount`, `spent_amount`, `department_head_approved_at`, plus `event_title` |
| `financial_report` | `submission_status`, `department_head_approved_at`, plus the existing statement fields |

`GET /api/approval-requests/{approvalRequest}` is open to `SUPER_ADMIN`, `ADMIN`, `DEPARTMENT_HEAD` and `SBO_OFFICER` and throttled like the list. A request is visible when the list would show it to the caller, in either scope: awaiting the caller's role within their organizations (not for `SBO_OFFICER`), or filed for the caller's own organization (`scope=submitted`). Any other request, and any id that does not exist or is not numeric, returns the same `404` body (`{"message": "Approval request not found."}`). Other roles are refused by the role middleware with `403`.
