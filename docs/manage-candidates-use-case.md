# Manage Candidates

**Users:** Admin, SBO Officer

**Manage Candidates**
|-- <<extend>> Register Candidate
|   |-- <<include>> Enter Candidate Information
|   |-- <<include>> Assign Election Position
|   |-- <<extend>> Assign Candidate to Partylist
|   |-- <<extend>> Upload Candidate Image
|   `-- <<include>> Save Record
|-- <<extend>> Update Candidate
|   |-- <<include>> View Candidate Details
|   |-- <<include>> Edit Candidate Information
|   `-- <<include>> Save Record
`-- <<extend>> Remove Candidate
    |-- <<include>> Confirm Removal
    `-- <<include>> Record Audit Log

## Implementation Coverage

- **Role Access:** Admin and SBO Officer can access the candidate management route and sidebar item.
- **Register Candidate:** `ManageCandidatesPage` captures student, election position, optional partylist, platform, and optional image upload.
- **Assign Election Position:** candidate create/update requests validate that the position belongs to the selected election.
- **Assign Candidate to Partylist:** candidate create/update supports optional partylist assignment and validates organization ownership.
- **Upload Candidate Image:** candidate create/update accepts JPEG, PNG, JPG, and WebP uploads.
- **Update Candidate:** the edit form opens existing candidate details and saves changed candidate information.
- **Remove Candidate:** deletion requires confirmation in the UI and blocks deletion when votes already exist.
- **Record Audit Log:** candidate removal writes an `elections` audit log entry through `ElectionController`.
