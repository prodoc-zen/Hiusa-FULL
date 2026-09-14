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
- **Load User Notifications:** the top bar loads the current user's notifications, and SAO also has a dedicated notification page.
- **Open Notification Details:** selecting a notification opens its detail view; approval and announcement notifications provide role-correct links to the related workspace.
- **Mark Notification as Read:** opening a notification marks it as read, and the panel also supports marking all as read.
