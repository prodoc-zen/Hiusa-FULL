# Manage User Accounts and Permissions

**Users:** Super Admin, Admin

**Manage User Accounts and Permissions**
├── <<include>> View User List
│   ├── <<extend>> Search User
│   └── <<extend>> Filter User by Role
├── <<extend>> Add User Account
│   ├── <<include>> Enter User Information
│   ├── <<include>> Assign Role
│   ├── <<include>> Assign SBO Position
│   └── <<include>> Save Record
├── <<extend>> Update User Account
│   ├── <<include>> View User Details
│   ├── <<include>> Edit User Information
│   └── <<include>> Save Record
└── <<extend>> Deactivate User Account
    ├── <<include>> Confirm Deactivation
    ├── <<include>> Update Account Status
    └── <<include>> Record Audit Log

## Implementation Coverage

- **View User List:** `AdminUsersPage` loads and displays organization-scoped accounts for Admins. SAO uses separate organization and administrator registers.
- **Search User:** the search input filters by name, school ID, or email.
- **Filter User by Role:** the role selector filters the visible user list.
- **Filter User by Academic Profile:** department, course/program, year level, and section selectors filter the visible user list.
- **Managed Academic Profile:** department is derived from the logged-in manager's organization college (PSITS defaults to College of Computer Studies). Programs and year-level section counts are configured by Admins in **Users & Positions → Programs & Sections**, then used as controlled choices when Admins manage accounts and officers filter attendance participants.
- **Academic Structure CRUD:** Admins can create, view, update, and delete unassigned programs and their generated sections. Every program always includes `1 - Non Block` through `4 - Non Block`; removing assigned sections and deleting assigned programs are blocked.
- **Add User Account:** Admin creates Student, SBO Officer, and Department Head accounts through `POST /users`. SAO registers student-body organizations and creates their Admin accounts through separate system-administration APIs; SAO is the only actor allowed to assign the Adviser position. No organization role can create a Super Admin through the application.
- **Admin Onboarding and Recovery:** SAO sets and confirms the Admin's initial password while creating the account. The password is hashed by the User model, is never returned by the API or written to audit logs, and should be delivered to the Admin through an approved private channel. Later resets use the dedicated email reset-link action and are audit logged.
- **Manage Positions:** Admins can create, view, update, activate/deactivate, and delete organization positions for Admin or SBO Officer accounts, except the SAO-reserved Adviser position. Position choices are organization-scoped and role-specific. Renaming a position updates matching assignments; deactivation, role changes, or deletion safely clears invalid assignments.
- **Pagination:** user and management tables display at most 10 rows per page.
- **Update User Account:** the edit form opens existing user details, including the student's contact number, allows Admin changes, and saves through `PUT /users/{id}`. Admin accounts can only be managed by Super Admin, while the Super Admin record is immutable from this screen.
- **Attendance Participant Directory:** SBO Officers retain a Student-only, read-only directory for manual attendance and consent-based fingerprint enrollment. It exposes no account create, edit, status, delete, or export controls.
- **Manage Fingerprint Enrollment:** enrollment opens in a dedicated modal showing the target user, reader status, four-scan progress, and required consent confirmation. Removing an enrollment has its own confirmation modal. SBO Officers can manage Student fingerprints only. Admin fingerprints are manageable only by Super Admin; a Super Admin can manage only their own Super Admin fingerprint. Only an encrypted SourceAFIS template is stored.
- **Deactivate User Account:** the Admin deactivate action confirms first, prevents self-deactivation and loss of the last active Admin, revokes active tokens, and records an audit log.
- **Delete User Account:** Admin can permanently delete eligible accounts after confirmation when no protected linked records exist, and every deletion is audit logged.
