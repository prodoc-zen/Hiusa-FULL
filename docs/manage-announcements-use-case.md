# Manage Announcements

**Users:** Super Admin, Admin, SBO Officer, Department Head

**Manage Announcements**
├── <<extend>> Generate Announcement Draft
│   ├── <<include>> Enter Announcement Details
│   ├── <<include>> Use Groq LLM
│   └── <<include>> Save AI Output
├── <<extend>> Create Announcement
│   ├── <<include>> Enter Announcement Content
│   └── <<include>> Save Record
├── <<extend>> Edit Announcement
│   ├── <<include>> View Announcement Details
│   ├── <<include>> Update Announcement Content
│   └── <<include>> Save Record
├── <<include>> Submit Announcement for Approval
├── <<include>> Review Approval Request
├── <<extend>> Publish Approved Announcement
│   ├── <<include>> Update Announcement Status
│   └── <<include>> Notify User
└── <<include>> Record Audit Log

## Implementation Coverage

- **Generate Announcement Draft:** `POST /announcements/generate-draft` sends only supplied title/audience/category/details to Groq, records structured context and output, and returns a retryable error instead of placeholder copy when Groq fails.
- **Accept Generated Draft:** saving the editable announcement links the versioned AI output to the new announcement and marks it accepted.
- **Create Announcement:** Admin and SBO Officer use organization announcements. A Department Head chooses an active student organization in their own college, then publishes immediately or saves a draft through College announcements. They may edit, publish/unpublish, or delete only their own posts while the target organization remains active. SAO uses the separate official-announcement endpoints and page, with no AI generation or organization approval step.
- **SAO Photos:** official announcements accept a JPEG, PNG, or WebP photo up to 5 MB. The editor previews the photo and the notice displays it. Multipart requests carry nested audience fields in a validated JSON `payload`; updates use `POST` with `_method=PUT` so PHP receives the uploaded file.
- **Edit Announcement:** manage announcements now opens existing details, updates content, and saves the record.
- **Content Formatting:** organization and official SAO announcement editors offer bold and alternate post fonts with a live preview. Formatting is stored as plain-text markers and rendered as React text, so existing posts and API fields remain compatible.
- **Submit Announcement for Approval:** SBO Officer announcements create an Admin approval request.
- **Review Approval Request:** Admin reviews announcement approval requests through the approval workflow.
- **Publish Approved Announcement:** Admin publishes organization announcements according to the existing workflow. SAO can publish or schedule an identifiable official SAO announcement to selected organizations, departments, or roles.
- **Record Audit Log:** draft generation, create, update, delete, publish, and unpublish actions write audit log entries.

## Department Head announcement contract

`GET /announcements?managed=1` returns the authenticated Head's own organization posts, including drafts, with the existing paginator and summary. The normal feed remains published-only and audience-filtered. `POST /announcements` requires an `organization_id` for Department Heads, checked against server-side college scope and active organization state. Organization Admin and Officer callers continue to use their authenticated organization; they cannot supply another organization ID. The existing PUT, DELETE, and publish PATCH routes allow a Head only for posts they created in their college. All write routes retain Sanctum, role checks, and write throttling; AI-generation permissions remain Admin/Officer-only. Notifications include active secondary organization profiles and use their destination role for audience matching. The audit belongs to the selected organization.
