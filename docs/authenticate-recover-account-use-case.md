# Authenticate and Recover Account

**Users:** Admin, SBO Officer, Department Head, Student

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

- **Role Access:** all four documented roles can authenticate through the shared login route.
- **Enter Login Credentials:** login accepts organization plus email or school ID and password.
- **Validate Credentials:** `UserController@login` retrieves the organization-scoped account, verifies the password, and blocks inactive accounts.
- **Establish User Session:** successful login issues a Laravel Sanctum bearer token.
- **Verify User Role:** optional selected role is compared with the stored account role before login succeeds.
- **Redirect to Role-Based Dashboard:** `App.jsx` routes authenticated users to the matching role dashboard.
- **Recover Account:** password reset endpoints request a reset, send the reset link, validate the reset token, confirm the new password, update the stored password, and revoke existing tokens.
