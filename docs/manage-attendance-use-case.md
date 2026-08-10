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
- **Record Manual Attendance:** managers can search users, select a participant, and save a manual check-in.
- **Record Biometric Attendance:** the schema/API can store `biometric` as the attendance method; hardware capture and biometric-template matching are not implemented in this web client.
- **View Attendance Summary:** attendance count and detailed records are shown after selecting an event.
