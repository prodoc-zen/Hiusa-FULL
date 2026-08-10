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
- **Add User Account:** the create form captures user information, role, optional SBO position, and saves through `POST /users`.
- **Update User Account:** the edit form opens existing user details, allows changes, and saves through `PUT /users/{id}`.
- **Deactivate User Account:** the deactivate action confirms first, prevents self-deactivation and loss of the last active Admin, revokes active tokens, and records an audit log.
