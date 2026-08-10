# View Election Results

**Users:** Admin, SBO Officer, Department Head, Student

**View Election Results**
|-- <<include>> Check Election Status
|-- <<include>> Load Election Results
|-- <<include>> Display Vote Tally
|-- <<include>> Display Winning Candidates
`-- <<extend>> Filter Results by Position

## Implementation Coverage

- **Role Access:** Admin, SBO Officer, Department Head, and Student can access election results from frontend routing, sidebar navigation, and the results API.
- **Check Election Status:** the results endpoint blocks Student access until results are marked visible.
- **Load Election Results:** `GET /elections/{id}/results` loads positions, candidates, partylist names, and vote counts.
- **Display Vote Tally:** `ElectionResultsPage` renders vote totals and percentage bars per position.
- **Display Winning Candidates:** candidates are sorted by vote count and winners are highlighted according to `max_winners`.
- **Filter Results by Position:** result data is grouped by position, matching the documented position-filter extension point.
