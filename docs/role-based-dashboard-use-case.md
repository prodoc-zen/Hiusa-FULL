# View Role-Based Dashboard

**Users:** Super Admin, Admin, SBO Officer, Department Head, Student

**View Role-Based Dashboard**
├── <<include>> Identify User Role
├── <<include>> Load Authorized Modules
├── <<include>> Load Role-Based Summary
├── <<include>> Display Dashboard
└── <<extend>> Open Selected Module

## Implementation Coverage

- **Identify User Role:** `DashboardIndexRedirect` and `ProtectedRoute` read the stored authenticated user role.
- **Load Authorized Modules:** `Sidebar` filters the module list by role and only renders links allowed for that role.
- **Load Role-Based Summary:** Super Admin, Admin, SBO Officer, Department Head, and Student each have their own dashboard page with role-specific summary data. SAO sees registered, active, and inactive SBO totals, received report requests, and unread notifications without organization-ledger totals or a recent-activity feed.
- **Admin Operational Summary:** `GET /admin/dashboard?months=3|6|12` returns organization-scoped pending orders, pending Admin approvals, pending tasks, newly published announcements from the past seven days, monthly ledger income and expenses, and a two-post published announcement preview. The shared dashboard header carries the page title, welcome text, cart, notifications, and profile controls.
- **Display Dashboard:** `DashboardLayout` renders the dashboard shell and the role page through React Router's outlet.
- **Open Selected Module:** module routes are guarded with matching `allowedRoles`. SAO receives only its dedicated organizations, administrators, official announcements, notifications, profile, and financial-approval routes—not ordinary SBO operational modules.
