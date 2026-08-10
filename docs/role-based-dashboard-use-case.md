# View Role-Based Dashboard

**Users:** Admin, SBO Officer, Department Head, Student

**View Role-Based Dashboard**
├── <<include>> Identify User Role
├── <<include>> Load Authorized Modules
├── <<include>> Load Role-Based Summary
├── <<include>> Display Dashboard
└── <<extend>> Open Selected Module

## Implementation Coverage

- **Identify User Role:** `DashboardIndexRedirect` and `ProtectedRoute` read the stored authenticated user role.
- **Load Authorized Modules:** `Sidebar` filters the module list by role and only renders links allowed for that role.
- **Load Role-Based Summary:** Admin, SBO Officer, Department Head, and Student each have their own dashboard page with role-specific summary data.
- **Display Dashboard:** `DashboardLayout` renders the dashboard shell and the role page through React Router's outlet.
- **Open Selected Module:** module routes are guarded with matching `allowedRoles`, including Department Head access to announcements, events, approvals, finance views, and election results.
