# Manage Attendance

**Users:** Admin, SBO Officer

**Manage Attendance**
|-- <<include>> Select Event
|-- <<include>> Load Attendance List
|-- <<extend>> Register Biometric Details
|   |-- <<include>> Capture Fingerprint
|   |-- <<include>> Validate Biometric Data
|   `-- <<include>> Save Biometric Record
|-- <<extend>> Record Manual Attendance
|   |-- <<include>> Select Participant
|   |-- <<include>> Mark Attendance Status
|   `-- <<include>> Save Attendance Record
|-- <<extend>> Record Biometric Attendance
|   |-- <<include>> Scan Fingerprint
|   |-- <<include>> Match Biometric Record
|   `-- <<include>> Save Attendance Record
`-- <<extend>> View Attendance Summary

## Implementation Coverage

- **Role Access:** Admin and SBO Officer can access event operations and full attendance management.
- **Select Event:** `EventsPage` provides an event selector in the attendance workspace.
- **Load Attendance List:** managers receive the full attendance record list from `GET /events/{id}/attendance`.
- **Record Manual Attendance:** managers can search users, select a participant, mark them present, late, excused, or absent, and save the record.
- **Record Biometric Attendance:** the UI and API expose a scanner-adapter readiness contract, but reject unverifiable biometric submissions until capture and matching hardware is connected.
- **View Attendance Summary:** total attendance, per-status totals, and detailed records are shown after selecting an event.
