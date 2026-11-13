# Election demo impact

What the full election process (round r16b) changes in the exhibit demo script (Sat 14 Nov 2026). This file lists each affected step with the old text, the new expected screen, and whether the step still passes. The script itself (`DEMO-SCRIPT.md`) is not edited here: the owner copies what is needed.

How the new expected text was written: each string below was read from the built client of this branch (`ElectionPickerPage.jsx`, `ElectionNextStep.jsx`, `electionFlow.js`, `lifecycle.js`, `CastVoteRedirectPage.jsx`, `CastVotePage.jsx`, `ManageVotersPage.jsx`, `ElectionResultsPage.jsx`, `ApprovalDetailDrawer.jsx`). Results page, runoff, tie and Officer transition text comes from the sibling slices of the same wave (4A, 4C, 4D) and is marked CHECK AFTER MERGE.

## The rule that keeps the demo working

An election is run the old way (the Admin adds candidates and finalizes the ballot) when it is created with the switch **Students file their own candidacy** off. The create form now opens with that switch on, so the demo election must be created with it off. Nothing else in the old path changed except the points below: a party list is optional, officers can no longer add candidates, a voter may skip a position, and closing an election no longer hands the office over in the same minute.

## Summary

| Step | Passes as written | Needs a changed instruction |
|---|---|---|
| P1.1 Create the Demo election | No | Switch the new toggle off first |
| P1.2 Dean approves (not in the listed set, changed too) | Yes | One click fewer |
| P1.3 Party list and candidates | Yes | The party list is optional now |
| P1.4 Finalize ballot | Yes | The checklist has two lines, not three |
| A8.1 Election page and step strip | Yes | None |
| A8.2 Look at the create form | No | The form opens full; switch off to show the short form |
| A8.4 Student votes | Yes with changed clicks | "Submit final ballot" does not exist; receipt shows a time |
| A8.5 Voted card and ballot address | Yes | Receipt shows a time |
| A8.6 Officer reads Voters | Yes | None |
| A8.7 Closed 2024-2025 results | Yes | Only if production marked it tally version 1 (the migration does) |
| A8.8 Close the Demo election | No | The dialog, the results line and the access change all differ |
| AFTER THE DEMO step 5 | Reworded | An appointment row, not a profile |
| Bed notes | Three notes change | See the last section |

## P1.1 Create the Demo election

Old text: "Create election. Informative letter (PDF): attach 1_Letter_of_Intent.pdf. Election title: Demo Council Election Nov 2026. Voting starts: Sat 14 Nov 2026 06:00. Voting ends: Mon 16 Nov 2026 17:00. Under Ballot positions click "Add position" and type Demo Representative (max winners 1). Do NOT click "Add executive positions". Click "Submit for approval"." Screen shows "Election submitted for approval."

New expected screen: the page "Create election" opens with the switch "Students file their own candidacy" on, with the line "Members file candidacies and you screen them." and the full form (Description, Schedule, Qualifications, Official rules, Tie-break rule). Switch it off first. The line then reads "Off: you add the candidates yourself." and the form is the short one: "Election artwork" (optional), "Informative letter (PDF)", "Election title", "Voting room" (optional), "Voting starts", "Voting ends", "Ballot positions" with "Add position" and "Add executive positions", and the buttons "Cancel" and "Submit for approval". There is no "Save draft" with the switch off. Submitting shows "Election submitted for approval."

Still passes: yes, with one extra click (switch the toggle off before anything else). The warning about "Add executive positions" stays: the button now adds the catalog titles President, Vice President Internal, Vice President External, Secretary, Treasurer, Auditor and Public Information Officer, marked Executive. Never press it on the Demo election.

## P1.2 Dean approves (changed, not in the listed set)

Old text: "Approvals > Pending > Request type: Election > Review > Approve > Approve." Screen shows "Request approved."

New expected screen: Review opens the drawer "Approval request". For an election the footer holds "Reject for good", "Ask for changes" and "Approve", and the drawer shows the whole proposal ("Election proposal": Organization, Academic year, Schedule, Positions, Qualifications, Official rules, Tie-break rule) and the "Decision history". "Approve" decides at once (no second confirm). The drawer shows only the parts the proposal has, so the short form shows fewer blocks than a full election.

Still passes: yes, with one Approve click.

## P1.3 Party list and candidates

Old text: "Party lists > "Register party list" (name Demo Unity). Then Candidates > "Add candidate": Sofia Bautista and Carlo Mendoza for Demo Representative, party list Demo Unity." Screen: two rows in the Candidates table.

New expected screen: unchanged for an election created with the switch off: "Register party list" and "Add candidate" are on the Admin's pages, and the Candidates table still reads Candidate, Position, Party list, Platform. The party list is now optional (the field reads "Party list (optional)", with Independent as the default), so Demo Unity may be skipped. Officers no longer see "Add candidate".

Still passes: yes.

## P1.4 Finalize ballot

Old text: "Finalize ballot (the checklist "Before the ballot can be finalized" must be met)." Screen: "Position setup is locked for this election."

New expected screen: the checklist "Before the ballot can be finalized" has two lines: "Positions on the ballot: N" and "Positions without candidates: N". The line about party list candidates is gone. After "Finalize ballot" the page still says "Position setup is locked for this election."

Still passes: yes.

## A8.1 Election page and step strip

Old text: the list shows the election as "Open" with "Next: Voting is open until ..."; the step strip reads "Current step: Step 4 of 5: Voting".

New expected screen: unchanged for the Demo election (no phase until it closes; the five stage short form lifecycle). The workspace strip reads Overview, Party lists, Candidates, Voters, Results: there is no Applications step for an election created with the switch off.

Still passes: yes.

## A8.2 Look at the create form

Old text: the form shows "Election artwork (optional), Informative letter (PDF), Election title, Voting room (optional), Voting starts, Voting ends, Ballot positions, and the buttons Add position, Add executive positions, Cancel, Submit for approval."

New expected screen: the form opens with the switch on and shows, in order: the switch "Students file their own candidacy", Election artwork, Informative letter (PDF), Election title, Voting room, Description, Schedule (Filing opens, Filing closes, Screening starts, Screening ends, Campaign starts, Campaign ends, Voting starts, Voting ends, Results published), Qualifications (Minimum enrolled units, Minimum GPA), Official rules, Tie-break rule, and Ballot positions where each position has a title, Description, Seats, Voter may choose up to, Eligible year levels, Other qualifications, Executive and Active; then Add position, Add executive positions, and the buttons Cancel, Save draft and Submit for approval. Switch the toggle off to show the old, short form. Cancel still returns to the list.

Still passes: only after switching off. Keep "Never click Add executive positions".

## A8.4 Student votes

Old text: "Voting > Vote > "Vote in this election" > "Start my ballot" > pick one candidate > "Next position" if shown > "Review ballot" > "Submit final ballot" > "Confirm and submit"". Screen: "Ballot submitted" with a "Ballot receipt" code, the receipt lists the voter's own choices, the Vote page reads Voted with the receipt code.

New expected screen: "Vote in this election" opens the overview ("Choose your candidates, or skip any position you prefer."), "Start my ballot" shows "Position 1 of N." with "Choose one candidate, or skip this position.", "Review ballot" shows "Review your ballot" with a "Change" button per row and "No selection (abstain)" for a skipped position, and "Confirm and submit" records it. There is no "Submit final ballot" button (it was already gone before this round). The page then reads "Ballot submitted" with "Submitted <date and time>", the "Ballot receipt" reference and the table "Your selections" (from the page's own state; nothing is stored for later viewing). The Vote page reads Voted with "Your ballot receipt", the reference and "Submitted <date and time>".

Still passes: yes, with the click list corrected. The Demo election has one position, so "Next position" does not show; a voter may now also skip the position and submit a blank ballot, which the script should not do.

## A8.5 Voted card and the ballot address

Old text: the Vote page reads Voted with the receipt code and no vote button; on the ballot address: "Vote already recorded" and "Each voter can submit one ballot for this election."

New expected screen: the same, with one more line on the card, "Submitted <date and time>". The ballot address shows "Vote already recorded", "Each voter can submit one ballot for this election.", "Your ballot receipt", the reference and "Submitted <date and time>", and never the choices.

Still passes: yes.

## A8.6 Officer reads Voters

Old text: a turnout line "N of M eligible voters have voted" with the percent; a table Name, School ID, Role, Email, Vote that shows only Voted or Not yet.

New expected screen: unchanged. Turnout is now counted from the ballots table (who voted), and choices are stored apart with no voter id. The page still shows only Voted or Not yet. A round switch (First round, Runoff) appears only when the election has a runoff (CHECK AFTER MERGE, slice 4C). Officers can no longer add, edit or remove candidates.

Still passes: yes.

## A8.7 Closed 2024-2025 results

Old text: Winners for President and Vice President, vote totals, and under Officer access the badge "Access handed over" ("Winners now have access to the organization in their positions. Officers they replaced no longer do.").

New expected screen: unchanged. The migration marks every election that was already closed as tally version 1, which keeps the old reading, including the badge "Access handed over" and the same sentence (the sentence is unchanged in the built client after round r16a's copy change). A tied position of such an election still reads "Tie, assign manually".

Still passes: yes, provided the production election is tally version 1. Check on production that the election closed before the release shows "Access handed over" and not "Upcoming officer".

## A8.8 Close the Demo election

Old text: Admin > row Actions > "Close" > in the "Close election" dialog ("The winners become the new officers and the outgoing officers lose their officer access.") press "Close election"; then Voting > Results. Screen: row reads Closed with "Next: Results released"; winners shown; the winner of Demo Representative gets officer access.

New expected screen:

- The dialog title is still "Close election" with the button "Close election". The built client still says "The winners become the new officers and the outgoing officers lose their officer access." That sentence is no longer true (access is staged). It is in `ElectionPickerPage.jsx` and must be reworded by the owner of that file before Saturday. Until then, do not read the dialog sentence aloud.
- The row reads Closed. Results show one status line per position: "Winner: <name> (N votes)" for a decided position. A 1 to 1 vote now reads "Runoff required: <names>" and the Admin sees "Runoff schedule" (not "Tie, assign manually").
- The winner does not get officer access in the same step. Results and Records > Officer transition show the winner as an Upcoming officer: "Upcoming officer, access starts <date>", with the start one calendar month before the official renewal deadline set in Compliance. If Compliance has no renewal deadline ahead, the winner stays Upcoming and the row says "No renewal deadline in Compliance yet". If the calculated start has already passed, access starts at once and the row says "Start date had already passed when the results became final". CHECK AFTER MERGE (slices 4A, 4C, 4D).

Still passes: no, as a demonstration of "closing hands over the office in one step". It now demonstrates "closing produces the result and an upcoming officer appointment". The safe rule stays: Sunday only, after the last guest, only with Demo Representative as the single position; both days vote the same candidate so there is no tie (a tie now needs a runoff and then the Department Head, not a manual assignment).

Risk to check before Saturday: whether production has a future renewal-category deadline in Compliance. Without one the Demo winner is flagged "No renewal deadline in Compliance yet" and nothing else happens, which is the safest outcome for the exhibit. With one, the winner's access starts on the calculated date, not on Sunday.

## AFTER THE DEMO step 5

Old text: "If the Demo election closed and released results: leave the Demo Representative officer profile in place and tell Jade the winner's name."

New text: if the Demo election closed, the Demo Representative appointment row stays in Records > Officer transition (Upcoming, or flagged). Leave it in place and tell Jade the winner's name. A profile with the title Demo Representative exists only after the start date; nobody holds the title today, so nobody becomes a Student when the term ends. Do not delete the appointment row.

Still passes: yes, reworded.

## Bed notes

1. Old: "Closing it hands the President seat to the winner and retires 900001, so close it last." New: closing the seeded election no longer signs Admin 900001 out at once. The winner appears as an Upcoming officer; 900001 keeps access until the end of the school year and then becomes a plain Student profile (never Inactive). A fresh bed has no renewal requirement in Compliance, so the winner is flagged "No renewal deadline in Compliance yet" and stays Upcoming: 900001 is not affected during the rehearsal. Close it last is no longer needed, but harmless.
2. Old: "On the bed the seeded election ties 5 to 5 if a walker votes Sofia, and closing gives "Tie, assign manually". Vote Juan and Carlo to get winners." New: a tie reads "Runoff required: <names>" (the seeded election is tally version 2, because it was not closed when the release ran). Vote Juan and Carlo to get winners without a runoff.
3. Old: "When it closes with winners, Admin 900001 is signed out at once and cannot sign in again, so close it last and view results as the dean (940001)." New: Admin 900001 stays signed in and keeps access. The dean (940001) can still view the results.
4. Unchanged: the bed has no semester, the dean is 940001, the sign-up person and the AI notes.

## What the new end-to-end spec covers

`client/e2e/election-full-process.spec.js` runs the new process on a fresh seed: the Admin proposes a full election with near dates, the Department Head approves, a student reads the rules and files, the Admin approves the application, and the student votes with a skipped position and reads the receipt with its time. It does not cover the demo steps above (those run the short form) or the results, runoff and transition screens.
