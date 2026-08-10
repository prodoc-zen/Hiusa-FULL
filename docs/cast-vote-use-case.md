# Cast Vote in Election

**Users:** Admin, SBO Officer, Department Head, Student

**Cast Vote in Election**
|-- <<include>> Validate Election Period
|-- <<include>> Validate Voter Eligibility
|-- <<include>> Check Previous Vote Record
|-- <<include>> Display Official Ballot
|-- <<include>> Select Candidate
|-- <<include>> Record Vote
|-- <<include>> Prevent Duplicate Vote
`-- <<include>> Display Vote Confirmation

## Implementation Coverage

- **Role Access:** Admin, SBO Officer, Department Head, and Student can access the cast-vote route, sidebar item, and vote API endpoint.
- **Validate Election Period:** the vote endpoint requires `active` status and verifies the current time is between the configured start and end times.
- **Validate Voter Eligibility:** the endpoint scopes the election to the authenticated user's organization.
- **Check Previous Vote Record:** the endpoint rejects users who already have a vote record for the election.
- **Display Official Ballot:** `CastVotePage` groups official candidates by election position.
- **Select Candidate:** the ballot UI requires a candidate selection before moving forward.
- **Record Vote:** the endpoint creates vote records with generated receipt hashes.
- **Prevent Duplicate Vote:** the endpoint checks prior election votes and per-position duplicates inside the transaction.
- **Display Vote Confirmation:** successful ballot submission returns receipt data and the page displays the submitted ballot state.
