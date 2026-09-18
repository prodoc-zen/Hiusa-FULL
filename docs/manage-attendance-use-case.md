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
|   |-- <<include>> Narrow Candidate Scope
|   |-- <<include>> Match Biometric Record
|   |-- <<include>> Confirm Student Identity and Intended Action
|   |-- <<include>> Save Check-In Time
|   `-- <<extend>> Save Checkout Time on Next Scan
`-- <<extend>> View Attendance Summary

## Implementation Coverage

- **Role Access:** Admin and SBO Officer can access event operations and full attendance management. SAO does not inherit organization-level event operations.
- **Select Event:** `EventsPage` provides an event selector in the attendance workspace.
- **Load Attendance List:** managers receive organization-scoped, server-paginated attendance rows from `GET /events/{id}/attendance`. Search and status filters are applied before pagination while event-wide totals remain available.
- **Record Manual Attendance:** managers can search users, select a participant, mark them present, late, excused, or absent, and save the record.
- **Register Biometric Details:** enrollment captures the same finger four times to build a reliable SourceAFIS template. Templates are encrypted at rest and scoped to the user's organization.
- **Record Biometric Attendance:** DigitalPersona capture runs locally in the browser and submits exactly one fresh PNG probe. Candidate matching is restricted to active Students in the operator's organization and configured department, with optional year-level, program, and section filters. Program and section choices come from the organization’s live academic-structure configuration, so unassigned newly created sections are available immediately; existing Student records are only a fallback when that configuration request fails. The result displays the Student, academic details, intended check-in/checkout action, score, and required threshold. A short-lived signed confirmation is required before attendance changes. The first confirmed scan creates check-in; the next confirmed scan updates checkout. Further scans are rejected instead of creating duplicate rows.
- **Large-Population Safety:** the matcher and Laravel both enforce a minimum score of 60, and Laravel also requires the best candidate to lead the second-best score by at least 10 points. Deployments may raise these values after testing with their actual readers and enrolled population.
- **View Attendance Summary:** total attendance, per-status totals, and detailed records are shown after selecting an event.
