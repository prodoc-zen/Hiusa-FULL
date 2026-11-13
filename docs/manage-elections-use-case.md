# Manage Elections

> Canonical correction: this workflow is election-specific. It replaces the duplicated event-management steps that appeared under "Manage Elections" in the earlier function list.

**Users:** Admin, Department Head (or the SAO for a university-wide organization), SBO Officer (read only)

**Manage Elections**
├── <<extend>> Create Election
│   ├── <<include>> Choose How Candidates Are Registered (students file, or the Admin adds them)
│   ├── <<include>> Enter Election Details
│   ├── <<include>> Set Schedule (filing, screening, campaign, voting, results)
│   ├── <<include>> Set Qualifications, Official Rules and Tie-break Rule
│   ├── <<include>> Configure Election Positions
│   ├── <<extend>> Save Draft
│   └── <<include>> Save Record
├── <<extend>> Edit Election
│   ├── <<include>> View Election Details
│   ├── <<include>> Update Election Information
│   └── <<include>> Save Record
├── <<include>> Submit Election for Approval
├── <<include>> Review Approval Request (Approve, Ask for changes, Reject for good)
├── <<include>> Move Through Election Phases
├── <<extend>> Screen Candidacy Applications
├── <<extend>> Open Approved Election (short form only)
├── <<extend>> Close Election (short form only)
├── <<extend>> Suspend, Resume or Cancel Election
├── <<extend>> Schedule Runoff
└── <<extend>> Export Election Reports

## Two ways to run an election

The switch **Students file their own candidacy** on the create form picks the path. An election keeps the path it was created with.

| | Students file their own candidacy (default) | Switch off (the short form) |
|---|---|---|
| Form | Title, description, nine schedule dates, qualifications, official rules, tie-break rule, positions, informative letter | Title, voting start and end, positions, informative letter |
| Candidates | Students file, the Admin approves each one | The Admin adds candidates and party lists, then finalizes the ballot |
| Phases | Scheduled, Filing, Screening, Campaign, Voting, Canvassing, Runoff, Pending tie resolution, Completed (or Cancelled) | Pending approval, Upcoming, Active, Closed |
| Close | By itself, from the schedule | The Admin closes it, or the schedule closes it at the end time |
| Winners | Staged officer appointments (see the Officer Transition flow in UX_FLOW.md) | Handed over when the election closes, as before |

## Implementation Coverage

- **Create Election:** the Admin creates an election and either saves a draft or submits it for approval. A draft is an election with `submitted_at` empty and no approval request; the Department Head sees an election only after it is submitted.
- **Election Artwork:** the Admin can upload a validated JPG, PNG, or WebP cover image during creation or editing for consistent ballot and results branding.
- **Selection-First Workspace:** users select an election before opening its role-appropriate steps. For an election where students file, the Admin's step strip is Overview, Applications, Party lists, Candidates, Voters, Results; an officer sees Applications, Candidates, Voters, Results. The short form has no Applications step.
- **Set Schedule:** a filing election needs Filing opens, Filing closes, Screening starts, Screening ends, Campaign starts, Campaign ends, Voting starts, Voting ends and Results published, each at or after the one before it. The server stores them as Manila wall-clock time, like the voting window. A draft keeps only the dates that were filled in.
- **Qualifications and Rules:** Minimum enrolled units (default 10), Minimum GPA (optional), Official rules and Tie-break rule are required to submit. Approval snapshots the rules as a numbered version that students read and accept before filing.
- **Configure Election Positions:** each position has a title, description, seats, "Voter may choose up to", eligible year levels, other qualifications, an Executive flag and an Active flag. **Add executive positions** inserts President, Vice President Internal, Vice President External, Secretary, Treasurer, Auditor and Public Information Officer, marked Executive.
- **Edit Election:** a draft can be edited and submitted. A returned election is edited and resubmitted. An approved filing election goes back for approval only when a schedule date, the rules, the tie-break rule, the minimum units or GPA, or a position really changed; a save that changes none of these never reopens approval. Nothing material can change once voting has opened. A short form election goes back for approval only when its voting window moves.
- **Review Approval Request:** the Department Head (the SAO for a university-wide organization) sees the whole proposal in the approval drawer and can Approve, Ask for changes (written notes, the Admin edits and resubmits) or Reject for good (written reason, cannot be resubmitted). The drawer lists the decision history.
- **Move Through Election Phases:** an approved filing election moves by itself from the schedule. A phase that cannot safely start (applications still pending review when voting is due, or no approved candidate) leaves the election where it is and alerts the Admins once.
- **Screen Candidacy Applications:** the Admin approves, asks for a correction or rejects, one application at a time, during Screening. Approving puts the candidate on the official list. See Manage Candidates.
- **Finalize Ballot (short form only):** after approval an Admin adds candidates and finalizes with `PATCH /elections/{id}/finalize`. Every position needs a candidate. A party list is optional, so an all-independent ballot is valid. Finalization locks ballot setup. A filing election locks its ballot by itself when voting opens.
- **Open and Close (short form only):** the Admin can open a finalized election once its voting window has started and can close an active one. After closing, the Admin releases the results when the Release results step shows.
- **Suspend, Resume or Cancel:** the Admin can suspend an election (phases, filing and voting pause) and resume it, or cancel it with a written reason at any time before it completes. A cancelled election never publishes results and never creates officer appointments. The reviewer and the other Admins are notified.
- **Schedule Runoff:** after counting, the Admin schedules the one runoff for tied positions from the results page (start, end and publication time), without a new approval.
- **Export Election Reports:** the Admin, officers and the Department Head can open seven reports as PDF or Excel from the results page.
- **Notifications and Audit:** phase changes, deadlines and decisions create in-app notices once each. Every step writes an `elections` audit row with the actor's school ID and never a ballot choice.
