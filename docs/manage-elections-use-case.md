# Manage Elections

**Users:** Admin

**Manage Elections**
├── <<extend>> Create Election
│   ├── <<include>> Enter Election Details
│   ├── <<include>> Set Voting Period
│   ├── <<include>> Configure Election Positions
│   └── <<include>> Save Record
├── <<extend>> Edit Election
│   ├── <<include>> View Election Details
│   ├── <<include>> Update Election Information
│   └── <<include>> Save Record
├── <<include>> Submit Election for Approval
├── <<include>> Review Approval Request
├── <<extend>> Open Approved Election
└── <<extend>> Close Election

## Implementation Coverage

- **Create Election:** Admin creates an election and submits it for approval.
- **Election Artwork:** Admin can upload a validated JPG, PNG, or WebP cover image during creation or editing for consistent ballot and results branding.
- **Selection-First Workspace:** Users select an election before opening its role-appropriate candidates, party lists, voters, ballot, or results workspace.
- **Set Voting Period:** create and edit forms capture start and end date/time.
- **Configure Election Positions:** Admin configures one or more unique ballot positions during creation and can manage them later in the election workspace until voting begins.
- **Edit Election:** Admin can open existing election details, update election information, and save changes.
- **Submit Election for Approval:** new elections are stored with `pending_approval` and an approval request for Department Head review.
- **Review Approval Request:** Department Head review is handled by the approval workflow.
- **Open Approved Election:** the API only allows opening an election after approval.
- **Close Election:** Admin can close an active election.
