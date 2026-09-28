# Authenticate and Recover Account

**Users:** Super Admin, Admin, SBO Officer, Department Head, Student

**Authenticate and Recover Account**
|-- <<include>> Enter Login Credentials
|-- <<include>> Validate Credentials
|   |-- <<include>> Retrieve User Account
|   |-- <<include>> Verify Password
|   `-- <<include>> Check Account Status
|-- <<include>> Establish User Session
|-- <<include>> Verify User Role
|-- <<include>> Redirect to Role-Based Dashboard
`-- <<extend>> Recover Account
    |-- <<include>> Request Password Reset
    |-- <<include>> Send Reset Link
    |-- <<include>> Validate Reset Token
    |-- <<include>> Enter New Password
    |-- <<include>> Confirm New Password
    `-- <<include>> Update Password

## Implementation Coverage

- **Role Access:** all five documented roles authenticate through the shared login route; `SUPER_ADMIN` is the canonical SAO role.
- **Enter Login Credentials:** every role signs in with a school ID or assigned ID number and password. Organization and department are not entered at login.
- **Validate Credentials:** `UserController@login` retrieves the account, verifies the password, and blocks inactive primary memberships or organizations.
- **Establish User Session:** successful login issues a Laravel Sanctum bearer token linked to the primary account profile. Users with suborganization memberships can switch their active profile after login.
- **Verify User Role:** authorization uses the active profile role and organization.
- **Redirect to Role-Based Dashboard:** `App.jsx` routes SAO to its dedicated university-oversight dashboard and routes every other user to the matching role dashboard.
- **Recover Account:** password reset endpoints request a reset, send the reset link, validate the reset token, confirm the new password, update the stored password, and revoke existing tokens. Reset links use the configuration-cached `app.frontend_url`, so queued production mail points to the deployed HTTPS frontend. Production must use a real mail transport; `MAIL_MAILER=log` records mail but does not deliver it.
