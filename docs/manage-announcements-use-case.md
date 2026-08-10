# Manage Announcements

**Users:** Admin, SBO Officer

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

- **Generate Announcement Draft:** `POST /announcements/generate-draft` sends the prompt to Groq when `GROQ_API_KEY` is configured and stores the generated text in `ai_outputs`.
- **Create Announcement:** Admin and SBO Officer can create announcements from the create page.
- **Edit Announcement:** manage announcements now opens existing details, updates content, and saves the record.
- **Submit Announcement for Approval:** SBO Officer announcements create an Admin approval request.
- **Review Approval Request:** Admin reviews announcement approval requests through the approval workflow.
- **Publish Approved Announcement:** direct Admin publishing and approval publishing update status and dispatch notifications.
- **Record Audit Log:** draft generation, create, update, delete, publish, and unpublish actions write audit log entries.
