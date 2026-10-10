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
- **Add User Account:** Admin creates Student, SBO Officer, and Department Head accounts through `POST /users` with a password the Admin chooses, so each new account must set its own password at first sign-in. SAO registers student-body organizations and creates their Admin accounts through separate system-administration APIs; SAO is the only actor allowed to assign the Adviser position. No organization role can create a Super Admin through the application.
- **Admin Onboarding and Recovery:** SAO sets and confirms the Admin's initial password while creating the account. The password is hashed by the User model, is never returned by the API or written to audit logs, and should be delivered to the Admin through an approved private channel. Because staff chose it, the account is flagged `must_change_password` and the Admin must set their own password at first sign-in. Later resets use the dedicated email reset-link action and are audit logged.
- **Forced Password Change:** `users.must_change_password` is set when staff pick or reset a password for someone else (class list import default, Admin-created accounts, Admin password edits, SAO-created Admins, handover successors and Department Heads). While it is true the `password.changed` middleware refuses every authenticated request with `403` and `error_code: PASSWORD_CHANGE_REQUIRED`, except `GET /user`, `PUT /user/password` and `POST /logout`. Sign-in still succeeds so the person can reach `/change-password`. `PUT /user/password` requires the current password, refuses a new password equal to the current one while the flag is set, clears the flag, and revokes the account's other tokens. Self-registration and the email reset-link flow never set the flag, and the reset flow clears it. Roster imports through `POST /users/import` give each account an unguessable random password, so those people sign in only after the reset-link flow.
- **Manage Positions:** Admins can create, view, update, activate/deactivate, and delete organization positions for Admin or SBO Officer accounts, except the SAO-reserved Adviser position. Position choices are organization-scoped and role-specific. Renaming a position updates matching assignments; deactivation, role changes, or deletion safely clears invalid assignments.
- **Pagination:** user and management tables display at most 10 rows per page.
- **Update User Account:** the edit form opens existing user details, including the student's contact number, allows Admin changes, and saves through `PUT /users/{id}`. Admin accounts can only be managed by Super Admin, while the Super Admin record is immutable from this screen.
- **Profile Photos:** Admins can upload a JPEG, PNG, or WebP photo up to 2 MB through `POST /users/{id}/photo` for accounts in their organization, excluding SAO-managed accounts. Photos are stored on the public disk and exposed as `photo_url`; the directory and fingerprint modal use the same identity card and fall back to initials. A replacement removes the old file.
- **Class List Import:** Admins use Programs & Sections to preview and apply a CSV through `/academic-structure/class-list/preview` and `/academic-structure/class-list/apply`. Required columns are `school_id,program,year_level,section`. A new account also needs `first_name,last_name,email`; names on existing rows, when present, must match. Year levels use a number from 1 through the configured program duration, and sections must belong to that year. Duplicate IDs invalidate every matching row. The preview separates new, updated, unchanged, invalid, and duplicate rows. Applying the same file hash with its 15-minute, user-bound preview token creates only new school IDs and updates only student academic fields on existing organization accounts. New accounts use the last four school-ID digits followed by `-uclm` as their initial password and are flagged `must_change_password`, so each imported student must set their own password at first sign-in. The import audits each created or updated account.
- **Attendance Participant Directory:** SBO Officers retain a Student-only, read-only directory for manual attendance and consent-based fingerprint enrollment. It exposes no account create, edit, status, delete, or export controls.
- **Manage Fingerprint Enrollment:** enrollment opens in a dedicated modal showing the target user, reader status, four-scan progress, and required consent confirmation. Removing an enrollment has its own confirmation modal. SBO Officers can manage Student fingerprints only. Admin fingerprints are manageable only by Super Admin; a Super Admin can manage only their own Super Admin fingerprint. Only an encrypted SourceAFIS template is stored.
- **Deactivate User Account:** the Admin deactivate action confirms first, prevents self-deactivation and loss of the last active Admin, revokes active tokens, and records an audit log.
- **Delete User Account:** Admin can permanently delete eligible accounts after confirmation when no protected linked records exist, and every deletion is audit logged.
- **Account Profiles:** creating a user creates a primary organization profile. Admins can add existing users to their own organization or its same-college suborganizations; SAO can select any active student organization and assign an Admin profile, including Admin profiles in multiple same-college suborganizations. Only SAO can assign the Admin role through this dialog. The searchable membership dialog is available in user action menus, SAO organization action menus, and the organization editor. Search supports name, school ID, and email with pagination. Both search and creation enforce the destination college using the user's primary organization and any recorded department, exclude SAO identities and inactive accounts, and reject duplicate membership. Each membership has its own role and status; joining a main organization and a suborganization produces two switchable profiles under the same login. Existing login credentials and memberships remain intact. Membership additions are audit logged, and organization member and administrator counts include secondary profiles.
- **Profile Removal:** Admin user actions and SAO administrator actions offer **Manage profiles**. SAO organization actions and the organization editor offer **Manage user profiles**, with name, school ID, and email search and 20 profiles per page. Inactive organization profiles are included. Removing a secondary profile preserves the shared login; removing the primary profile promotes a surviving active profile when available. Removing the final profile deletes the shared user and all sessions. Linked financial or operational history blocks final deletion with `409`; the final profile and user remain intact. Users cannot delete themselves or SAO identities. Only SAO can delete Admin profiles, and each organization must retain an active Admin, including secondary Admin profiles.

### Existing membership API

- `GET /account-profiles/organizations` returns authorized active destination organizations for Admin or SAO.
- `GET /account-profiles/candidates` requires `organization_id`, supports `search`, `page`, and `per_page` (up to 50), and returns a Laravel paginator containing minimal identity fields. Existing target memberships are omitted.
- `POST /account-profiles/invite` accepts `school_id`, `role` (`STUDENT`, `SBO_OFFICER`, or `DEPARTMENT_HEAD`; SAO may also assign `ADMIN`), and `organization_id`. Omitting the organization retains the older Admin contract of targeting the active organization. Success returns the new profile with organization details and HTTP `201`.
- These endpoints require Sanctum and `ADMIN` or `SUPER_ADMIN`. Inaccessible, inactive, and system destinations return `404`; an existing membership returns `409`; invalid role, missing college, or ineligible user returns Laravel `422` with an `errors` object. Creation rechecks college eligibility on the server inside a transaction and preserves the shared user record.

### Profile removal API

- `GET /account-profiles` returns a Laravel paginator of authorized profiles. Optional filters are `organization_id`, `user_school_id`, `search`, `page`, and `per_page` (up to 50). Admin scope is their own organization and direct suborganizations in the same college; SAO scope includes all student organizations. Each row contains minimal identity fields, organization, role, status, `is_primary`, `profiles_count`, and `deletion_block_reason`.
- `DELETE /account-profiles/{profile}` returns `200` with `account_deleted` and `remaining_profiles`. The server rechecks scope and permissions inside a transaction, revokes sessions bound to the deleted profile, and records an audit entry. Deleting a primary profile also revokes legacy sessions without an explicit profile. Other profile sessions survive.
- Both endpoints require Sanctum and `ADMIN` or `SUPER_ADMIN`. Inaccessible profiles return `404`, forbidden roles or protected identities return `403`, deleting the last active Admin returns `422`, and linked records blocking final account deletion return `409`.
