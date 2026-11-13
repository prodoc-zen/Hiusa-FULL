# View Election Results

**Users:** Admin, SBO Officer, Department Head, Student

**View Election Results**
|-- <<include>> Check Election Status
|-- <<include>> Load Election Results
|-- <<include>> Display Vote Tally
|-- <<include>> Display Winning Candidates
|-- <<extend>> Filter Results by Position
|-- <<extend>> Schedule Runoff (Admin)
|-- <<extend>> Resolve Tie (Department Head)
`-- <<extend>> Export Election Reports (Admin, SBO Officer, Department Head)

## Implementation Coverage

- **Role Access:** Admin, SBO Officer, Department Head, and Student can access election results from frontend routing, sidebar navigation, and the results API.
- **Check Election Status:** live turnout is available after voting opens. Totals and winners publish at the **Results published** time of a filing election, and a runoff outcome at the runoff's publication time. A short form election publishes when it closes, as before. Until then an unresolved position reads "Runoff required" or "Pending tie resolution by the Department Head".
- **Load Election Results:** `GET /elections/{id}/results` returns one row per position with its status (decided, unopposed, vacant, runoff required, runoff scheduled, runoff voting, tie pending, resolved), candidates with first round and runoff totals, winners, the runoff schedule, the tie resolution, and the officer access of each winner.
- **Counting rules:** no candidate means "Vacant: no candidates". Candidates not more than seats are "Elected unopposed" with no vote threshold. Otherwise the highest totals win. A tie at the last seat elects those strictly ahead and sends the tied candidates to the runoff for the remaining seats. Elections that closed before this release (tally version 1) keep their old reading, including "Access handed over".
- **Display Vote Tally:** `ElectionResultsPage` renders vote totals and percentage bars per position, with round 1 and runoff totals side by side when a runoff happened.
- **Display Winning Candidates:** each position shows one status line: "Winner: ..." or "Winners: ...", "Elected unopposed", "Vacant: no candidates", "Runoff required: ...", "Runoff scheduled for ...", "Runoff voting is open", "Pending tie resolution by the Department Head", or "Tie resolved by ..." with the rule used and the explanation. Winners show "Upcoming officer, access starts <date>" or "Officer access active".
- **Schedule Runoff:** the Admin sees **Runoff schedule** when a position needs a runoff and it has not started: Runoff voting starts, Runoff voting ends, Results published, then **Schedule runoff** (or **Update schedule**).
- **Resolve Tie:** when a runoff ends still tied, the Department Head (the SAO for a university-wide organization) chooses only among the tied candidates for exactly the remaining seats, sees the approved tie-break rule (or types a Rule used when the election has none), writes an explanation and selects **Record decision**. Vote totals cannot be changed.
- **Filter Results by Position:** the results page provides an All Positions/individual position selector.
- **Export Election Reports:** the **Reports** button on the results page lists Official candidates, Candidacy screening, Party lists, Voter participation, Canvassing of votes, Election results and Audit trail, each as PDF or Excel. Canvassing and results follow the same visibility as this page. The participation and audit reports never link a voter to a choice. Students do not see the button.
