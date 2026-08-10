# Manage Profile

**Users:** Admin, SBO Officer, Department Head, Student

**Manage Profile**
|-- <<include>> View Profile Information
|   |-- <<include>> Retrieve User Profile
|   `-- <<include>> Display Profile Details
|-- <<extend>> Edit Profile Information
|   |-- <<include>> Validate Profile Updates
|   `-- <<include>> Save Profile Changes
`-- <<extend>> Change Password
    |-- <<include>> Verify Current Password
    |-- <<include>> Validate New Password
    `-- <<include>> Update Password

## Implementation Coverage

- **Role Access:** all four roles can access `/dashboard/profile`.
- **View Profile Information:** profile data is loaded from the authenticated user stored by the auth flow and displayed in `SettingsPage`.
- **Edit Profile Information:** users can update first name, last name, and email.
- **Validate Profile Updates:** `UserController@updateProfile` validates required profile fields and organization-scoped email uniqueness.
- **Save Profile Changes:** profile updates are persisted through `PUT /user/profile` and refreshed into local storage.
- **Change Password:** users submit current password, new password, and confirmation.
- **Verify Current Password:** `UserController@updatePassword` checks the current password before updating.
- **Validate New Password:** new passwords require confirmation and a minimum length.
- **Update Password:** password updates revoke existing tokens and redirect the user back to login.
