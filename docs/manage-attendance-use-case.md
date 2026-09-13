# Manage Attendance

**Users:** Super Admin, Admin, SBO Officer

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

- **Role Access:** Super Admin, Admin, and SBO Officer can access event operations and full attendance management.
- **Select Event:** `EventsPage` provides an event selector in the attendance workspace.
- **Load Attendance List:** managers receive the full attendance record list from `GET /events/{id}/attendance`.
- **Record Manual Attendance:** managers can search users, select a participant, mark them present, late, excused, or absent, and save the record.
- **Register Biometric Details:** enrollment captures the same finger four times to build a reliable SourceAFIS template. Templates are encrypted at rest and scoped to the user's organization.
- **Record Biometric Attendance:** DigitalPersona capture runs locally in the browser and submits exactly one fresh PNG probe. The private Fscanner-derived SourceAFIS service compares it with active enrollments from the operator's organization, and a successful match creates one idempotent biometric attendance record.
- **View Attendance Summary:** total attendance, per-status totals, and detailed records are shown after selecting an event.
