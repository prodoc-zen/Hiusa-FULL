# Check In to Event

**Users:** Admin, SBO Officer

**Check In to Event**
|-- <<include>> Select Active Event
|-- <<include>> Verify User Identity
|-- <<extend>> Scan Biometric
|   |-- <<include>> Capture Fingerprint
|   |-- <<include>> Apply Organization and Academic Scope
|   |-- <<include>> Match Fingerprint Record
|   |-- <<include>> Confirm Identified Student
|   `-- <<include>> Validate Attendance Entry
|-- <<extend>> Submit Manual Attendance
|   |-- <<include>> Confirm Participant Identity
|   `-- <<include>> Validate Attendance Entry
|-- <<include>> Save Attendance Entry
|-- <<extend>> Check Out with Fingerprint
|   |-- <<include>> Identify Existing Attendance Entry
|   `-- <<include>> Save Checkout Time
`-- <<include>> Display Attendance Confirmation

## Implementation Coverage

- **Role Access:** only Admins and SBO Officers can access the check-in route or record attendance for a Student; Students and Department Heads cannot check themselves in. SAO does not inherit this operational function.
- **Select Active Event:** check-in is accepted only for approved or ongoing events.
- **Verify User Identity:** the operator and selected Student are scoped to the same organization.
- **Submit Manual Attendance:** the check-in UI records manual attendance only for an Admin- or SBO-Officer-selected participant.
- **Validate Attendance Entry:** manual duplicate check-ins are rejected. Fingerprint attendance first returns a short-lived, operator-and-event-bound confirmation displayed in a focused modal. No attendance mutation occurs until the operator confirms the displayed Student. The second confirmed scan checks the Student out and any later scan is rejected.
- **Candidate Scope:** event fingerprint identification always searches active Students in the authenticated organization and its configured department. Operators may additionally narrow candidates by year level, program, and section.
- **Match Safety:** Laravel requires a score of at least 60 and a 10-point lead over the second-best candidate by default, even if the matcher service is configured more permissively. These values are configurable for deployment calibration.
- **Save Attendance Entry:** `EventController@recordAttendance` creates attendance records with recorder and method.
- **Save Checkout:** `FingerprintController@confirmAttendance` updates the existing attendance row with `check_out_time`; it never creates a second row for the same event and member.
- **Display Attendance Confirmation:** `EventsPage` shows success/error feedback after submission.
