# Check In to Event

**Users:** Admin, SBO Officer, Department Head, Student

**Check In to Event**
|-- <<include>> Select Active Event
|-- <<include>> Verify User Identity
|-- <<extend>> Scan Biometric
|   |-- <<include>> Capture Fingerprint
|   |-- <<include>> Match Fingerprint Record
|   `-- <<include>> Validate Attendance Entry
|-- <<extend>> Submit Manual Attendance
|   |-- <<include>> Confirm Participant Identity
|   `-- <<include>> Validate Attendance Entry
|-- <<include>> Save Attendance Entry
`-- <<include>> Display Attendance Confirmation

## Implementation Coverage

- **Role Access:** all four roles can access the check-in route and attendance record endpoint.
- **Select Active Event:** check-in is accepted only for approved or ongoing events.
- **Verify User Identity:** authenticated users are scoped to their organization; non-managers can only check in themselves.
- **Submit Manual Attendance:** the check-in UI records manual attendance for the current user or a manager-selected participant.
- **Validate Attendance Entry:** duplicate event check-ins are rejected.
- **Save Attendance Entry:** `EventController@recordAttendance` creates attendance records with recorder and method.
- **Display Attendance Confirmation:** `EventsPage` shows success/error feedback after submission.
