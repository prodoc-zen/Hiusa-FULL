# Manage User Accounts and Permissions

**Users:** Admin

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

- **View User List:** `AdminUsersPage` loads and displays organization-scoped users.
- **Search User:** the search input filters by name, school ID, or email.
- **Filter User by Role:** the role selector filters the visible user list.
- **Filter User by Academic Profile:** department, course/program, year level, and section selectors filter the visible user list.
- **Managed Academic Profile:** department is derived from the logged-in administrator's organization college (PSITS defaults to College of Computer Studies). Programs and year-level section counts are configured in **Users & Positions → Programs & Sections**, then used as controlled user-form choices.
- **Academic Structure CRUD:** Admins can create, view, update, and delete unassigned programs and their generated sections. Every program always includes `1 - Non Block` through `4 - Non Block`; removing assigned sections and deleting assigned programs are blocked.
- **Add User Account:** the create form captures user information, role, optional SBO position, and saves through `POST /users`.
- **Update User Account:** the edit form opens existing user details, including the student's contact number, allows changes, and saves through `PUT /users/{id}`.
- **Deactivate User Account:** the deactivate action confirms first, prevents self-deactivation and loss of the last active Admin, revokes active tokens, and records an audit log.
- **Delete User Account:** non-Admin accounts can be permanently deleted after confirmation when no protected linked records exist; the deletion is audit logged.
