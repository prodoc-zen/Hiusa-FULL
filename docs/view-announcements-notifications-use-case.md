# View Announcements and Notifications

**Users:** Super Admin, Admin, SBO Officer, Department Head, Student

**View Announcements and Notifications**
├── <<include>> Load Published Announcements
├── <<include>> Display Announcement List
├── <<extend>> Open Announcement Details
│   └── <<include>> View Details
├── <<include>> Load User Notifications
├── <<extend>> Open Notification Details
└── <<extend>> Mark Notification as Read

## Implementation Coverage

- **Load Published Announcements:** organization users use the role-scoped feed; SAO uses its official-announcement register with draft, published, scheduled, and archived states.
- **Display Announcement List:** the feed lists published announcements and supports expanding each announcement for details.
- **Open Announcement Details:** selecting an announcement expands the full body.
- **Load User Notifications:** the top bar loads the current user's notifications when the application loads; a browser refresh retrieves newer notifications. SAO also has a dedicated notification page.
- **Open Notification Details:** selecting a notification opens its detail view; report approvals take Department Heads to their approval inbox and Super Admins to Financial reports without exposing the finance workspace.
- **Mark Notification as Read:** opening a notification marks it as read, and the panel also supports marking all as read.
- **Outcome colors:** the shared notification classifier gives cancelled, rejected, returned, failed, expired, overdue, and stock-alert notices red treatment. Approved, endorsed, verified, completed, paid, claimed, and restored outcomes use green. Neutral updates retain the blue treatment. Top-bar notifications and the SAO inbox use the same rules; reading a notice removes the unread background while retaining the outcome icon color.
- **React to Announcement:** eligible readers can add or remove one heart reaction. The API scopes reactions to published announcements visible to the reader's organization and role, and returns the current count and reader state.
