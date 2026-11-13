# Cast Vote in Election

**Users:** Admin, SBO Officer, Department Head, Student

**Cast Vote in Election**
|-- <<include>> Validate Election Period
|-- <<include>> Validate Voter Eligibility
|-- <<include>> Check Previous Ballot Record
|-- <<include>> Display Official Ballot
|-- <<include>> Select Candidates (up to the limit, or skip a position)
|-- <<include>> Review Ballot
|-- <<include>> Record Ballot Secretly
|-- <<include>> Prevent Duplicate Ballot
|-- <<include>> Display Receipt (reference and submission time)
`-- <<extend>> Vote in the Runoff

## Implementation Coverage

- **Role Access:** Admin, SBO Officer, Department Head, and Student can reach the Vote page and the vote endpoint. The faculty adviser is not on the voter roll.
- **Vote list:** the Vote page lists each election with its phase (Upcoming, Filing, Screening, Campaign, Open, Voted, Counting, Closed, Cancelled) and one action: **Read the rules and file candidacy** while filing is open, **See the election** during screening and campaign, **Vote in this election** while voting is open. After voting the card reads Voted with the receipt reference and the submission time.
- **Validate Election Period:** the vote endpoint requires an approved, finalized election that is not suspended or cancelled and a current round: round 1 between the voting start and end, or round 2 (the runoff) between the runoff start and end. A filing election locks its ballot (`finalized_at`) and freezes the voter roll when voting opens.
- **Validate Voter Eligibility:** the voter must be on the frozen voter roll of the election's organization. A student who joined after the roll was frozen is refused with "You joined after the voter list was finalized, so you cannot vote in this election."
- **Check Previous Ballot Record:** one ballot per voter per round, recorded in `election_ballots`. A second attempt is refused as already voted.
- **Display Official Ballot:** `CastVotePage` shows the positions that have approved candidates, one position at a time, with each candidate's name, party list (or Independent) and platform. In the runoff only the tied candidates of the affected positions appear.
- **Select Candidates:** the voter chooses up to the position's limit ("Choose one candidate, or skip this position." for one seat, "Choose up to N" for more). Any position may be skipped and a whole ballot may be blank.
- **Review Ballot:** **Review ballot** shows every position with the choice or "No selection (abstain)"; **Change** returns to a position; **Confirm and submit** records the ballot. A blank ballot says "You have not chosen anyone. Submitting records a blank ballot."
- **Record Ballot Secretly:** participation is stored apart from choices. `election_ballots` holds the voter, the round, the receipt reference and the time; `votes` holds the choice with no voter id and a time at day precision. Votes cast before this release keep the voter id they were stored with.
- **Display Receipt:** the page shows "Ballot submitted", the submission time and the ballot receipt reference. The page lists the choices only from its own state right after submitting. Nothing is stored for later viewing: the Vote page afterwards shows only Voted, the receipt reference and the time.
- **Vote in the Runoff:** when a runoff is open, eligible voters cast one new secret ballot (round 2) for the tied candidates, up to the seats still open.
