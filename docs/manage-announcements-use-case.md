# Manage Announcements

**Users:** Super Admin, Admin, SBO Officer

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
- **Create Announcement:** Admin and SBO Officer use organization announcements. SAO uses the separate official-announcement endpoints and page, with no AI generation or organization approval step.
- **Edit Announcement:** manage announcements now opens existing details, updates content, and saves the record.
- **Submit Announcement for Approval:** SBO Officer announcements create an Admin approval request.
- **Review Approval Request:** Admin reviews announcement approval requests through the approval workflow.
- **Publish Approved Announcement:** Admin publishes organization announcements according to the existing workflow. SAO can publish or schedule an identifiable official SAO announcement to selected organizations, departments, or roles.
- **Record Audit Log:** draft generation, create, update, delete, publish, and unpublish actions write audit log entries.
