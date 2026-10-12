# HIUSA panel demo: run of show

What changed on the demo day sequence:

- Tuesday evening, after the group finishes testing (or Wednesday morning, at least 2 hours before the demo): run `scripts\reseed-staging.ps1 -Execute` (type RESET; about 5 minutes). It recreates the ballot, the Officer's task and the invoice, and prints the new SAO password once at the very end: write it on the host sheet. Then run `scripts\demo-smoke.ps1` and expect READY (section 8, "Reset between rehearsals").
- Wednesday: the 60, 30 and 5 minute checks in section 10. The 30 minute check includes a second `scripts\demo-smoke.ps1` run.

Wednesday 2026-10-14, about 25 minutes, on https://13.228.227.182 with a fresh seed and no semester yet. Every label below was checked against the code in `client/src` and the journey specs in `client/e2e/journeys`. Where a label or a state could not be confirmed it says UNCONFIRMED. No passwords are in this file: demo passwords are in `docs/MEMBER_TESTING.md` section 2, the SAO password comes from the host, and every password in this script is "see the host sheet".

## 1. Cheat sheet (one page)

URL: `https://13.228.227.182`. If the browser shows a certificate warning, choose Advanced and continue. Do this in rehearsal, not on stage (UNCONFIRMED whether the certificate is trusted).

| Role | School ID | Password | Lands on |
|---|---|---|---|
| Student | 2100142 | see the host sheet | `/dashboard/student` |
| SBO Officer (Treasurer) | 900004 | see the host sheet | `/dashboard/officer` |
| Admin (President, PSITS-CCS) | 900001 | see the host sheet | `/dashboard/admin` |
| Department Head (Computer Studies) | 940001 | see the host sheet | `/dashboard/department-head` |
| SAO | 990001 | given by the host | `/dashboard/super-admin` |
| Adviser (backup Admin, PSITS-CCS) | 990002 | see the host sheet | `/dashboard/admin` |

Back-up students if 2100142 has already joined the event: 2300247, 2300312, 2400019, 2400067, 2400093.

Order and why:

1. Round 1, before any semester exists: Student, Officer, Admin. The seeded events, tasks and election belong to no semester, so they vanish from every list the moment a semester becomes active (MEMBER_TESTING section 3).
2. The SAO activates a semester at the start of the Department Head segment. A Department Head cannot register an organization until then.
3. Round 2: Department Head, then SAO. The SAO approves the registration, creates the new organization's administrator, and that new Admin signs in last.
4. Do not run the Admin check-in journey (Events and tasks > Check-in) before the Officer's check-in. It marks every other ongoing event completed (UX_FLOW section 9, "Live run order"). It is not in this script.

| Segment | Minutes | Running total |
|---|---|---|
| Opening | 1 | 1 |
| Student (phone view) | 4 | 5 |
| Officer | 3 | 8 |
| Admin | 3.5 | 11.5 |
| Department Head, with the SAO semester gate | 5 | 16.5 |
| SAO: apply for an organization (approve, administrator, new Admin signs in) | 3 | 19.5 |
| SAO: oversight, grievance answer | 2 | 21.5 |
| Closing and questions | 2 | 23.5 |
| Buffer | 1.5 | 25 |

Window setup: Window A (Chrome or Edge) for the current role. Window B signed in as the SAO from the start (used for the semester gate and the grievance answer). A private window for the new Admin. A real phone on mobile data, signed in as the Student, as the proof it works off the school network.

## 2. Opening (1 minute)

Say: "Student organizations at UC Lapu-Lapu and Mandaue run their money, events, elections, merchandise and announcements on spreadsheets, paper liquidation reports and several chat apps. That is slow, hard to audit and easy to get wrong."

Say: "HIUSA: An AI-Integrated Student Governance and Financial Management System puts all of it on one platform with one login per person, and AI that advises but never decides."

Say: "You will see five roles in the order work really flows: a Student, an SBO Officer, an Organization Admin, a Department Head and the Student Affairs Office. Each journey ends on a visible result. The AI parts are marked."

Tie to the study: General Objective (one centralized AI-integrated platform) and Specific Objective 2 (financial, event, task, election, merchandise and communication mechanisms). Each segment names the objective it serves. SO1 and SO4 are assessed outside the application (PAPER_SCOPE_ADDENDUM section 1).

## 3. Student (4 minutes, phone view)

Phone view: in Chrome or Edge press F12, then Ctrl+Shift+M, choose Responsive, set 390 by 844. On a phone, tap "Open menu" (top bar) before using any menu item. That tap is not counted below. Sign in as 2100142.

State needed: Sports Fest 2024 approved (seeded). 2100142 is the one student the seed leaves unregistered for it. The ballot in step 2 does not exist on a fresh seed; the reset script creates it (step 10, see section 8, host prep 1).

1. Join an event (ceiling 3). Click: Open menu, Events (one tap), the card "Sports Fest 2024", then "Register for this event". See: the drawer shows "You are registered". On Home, the "Next for you" card no longer lists "Register for an upcoming event". Say: event registration is SO2.2, event management: students reserve a spot and organizers see the roster. AI moment: none.
2. Vote (ceiling 6, counted from Home: the 2 listed for this journey in UX_FLOW section 9 is overridden by its Counting rules paragraph, which sets the vote journey to 6 because starting, choosing, reviewing and confirming the ballot are all taps). Start on Home, which is not a tap. Click: the "Student shortcuts" link "Enter secure voting", "Start my ballot", the candidate, "Review ballot", "Submit final ballot", then "Confirm and submit" (6 taps). See: heading "Ballot submitted" and "Ballot receipt hash". Then Open menu > Voting > Vote: the election card says "Voted" with a "View live totals" link. Say: SO2.4, elections: one ballot per voter, the receipt is a hash and live totals are anonymous. AI moment: none.
3. Order merchandise (ceiling 5 per UX_FLOW, 6 accepted: Store, Shop, Add to Cart, My Cart, Review & Continue, Place Reservation). Click: Open menu > Store > Shop, "Add to Cart" on "HIUSA Tote Bag", "My Cart", "Review & Continue", "Place Reservation". See: a message "ORD-n reserved" (write n down for the Officer). Then Open menu > Store > My orders (1 click): "Step 1 of 4: Reserved" and "pay cash at pickup". Say: SO2.5, merchandise: reservation, payment checked by staff, a claim token at pickup. AI moment: none.
4. File a grievance (ceiling 4, then 2 for clearance). Click: Open menu > Support > My grievances. If the "File a grievance" tab is not selected, click it. Type "Broken lights at the library walkway" in "What's this about?" and one sentence in "Tell us what happened". Choose "Student Affairs Office" under "Who should this go to?". Click "File this grievance". See: your row with "Waiting for SAO to review". AI MOMENT: under the row, the panel "AI classification (advisory)" shows an urgency badge, a category badge and a "Why this classification?" disclosure. Say: a rule-based classifier suggests urgency and category (Safety & Security, Financial Integrity, Facilities & Maintenance, Academic / Faculty, General); a person always decides. Then Open menu > Support > My clearance: the list "Clearance signatures" shows one step per signatory. Say: SO3, features beyond the paper that the dean asked for.
5. Optional, only if the invoice for 2100142 exists (the reset script creates it in step 10, best effort; section 8, host prep 4): Open menu > My payments > Statement of account (ceiling 2). See: the balance and clearance status without scrolling. SO2.1. Otherwise skip: the seed holds no invoices.

Switch back to desktop view (Ctrl+Shift+M again) before the Officer.

## 4. SBO Officer (3 minutes)

Sign out, sign in as 900004. Menu on desktop is the left sidebar; a group opens its first page.

State needed: "Leadership Seminar 2024" is seeded as ongoing. The student's order ORD-n from Student step 3 is waiting. A task for 900004 (the reset script creates it in step 10; section 8, host prep 2) for step 3.

1. Check someone in (ceiling 4). Click: Events and tasks > Check-in. The ongoing event is already selected and shows "Attendance records" with a number N. Type 2300163 in the Member field, click the result row that shows 2300163 and the member's name, click "Confirm Check-In". See: "Check-in recorded." and the count becomes N+1. Say: SO2.2, attendance by fingerprint or by manual check-in. AI moment: none.
2. Verify a payment (ceiling 6 with the claim, 8 accepted; this script stops after the verify). Click: Store > Orders, find ORD-n, click "Verify" (or the row's Actions menu > "Verify & submit"), then in the dialog "Verify merchandise payment" click "Verify & Submit". See: the order now reads "Verified: waiting for Admin approval". Say: money changes hands in two steps, the officer checks the cash and the Admin approves, so no one person can release stock alone.
3. Update my task (ceiling 3). Click: Events and tasks > My tasks, then "Start" on the task. See: the card shows "In Progress". Say: SO2.3, task management. Skip this step if you are behind.
4. Send an announcement for approval (ceiling 4 on paper; 5 at desktop width and 6 on a phone are accepted). Click: Updates > Announcements, "New announcement". Type the title "Sports Fest volunteers needed". Type in "Instructions for AI draft": "Formal tone. Ask officers to sign up at the SBO office." Click "Generate Draft". AI MOMENT: the Content box fills with a written announcement and the counter "N of M drafts left today" drops by one. Edit one word to show the officer is in charge. Click "Submit for approval". The dialog says "Admin approves it before members see it"; click "Submit for approval" again. See: heading "Sent to your Admin for approval". Click "View in Announcements": the row says "Waiting for Admin approval". Say: SO2.6, communication. The text comes from a language model (Groq), the rules around it (who approves, who sees it) are ordinary code.

## 5. Admin (3.5 minutes)

Sign out, sign in as 900001. The sidebar shows the role as Organization Admin.

State needed: nothing consumed by earlier steps except the verified order from Officer step 2.

1. Read the home page (20 seconds). See: "What HIUSA noticed" with insight cards marked "From your records" and a "Why am I seeing this?" disclosure. AI MOMENT: dashboard insights. Say: every insight shows the numbers it is based on, so the AI is explainable. If the section is absent, say so and move on.
2. Approve the verified payment (optional, 20 seconds, UNCONFIRMED click path in a browser; the specs do this by API). Click: Store > Orders, the order ORD-n, the card "Approve the verified payment", its button "Approve payment", then "Approve Payment" in the dialog. PRESENTER WARNING: for the Admin this dialog is headed "Approve Payment Directly" and says "Approve this order without waiting for an SBO Officer review" (`MerchandisePage.jsx`). That is the same dialog the Admin gets on any pending order, so on an order the officer has already verified the wording is generic and you should say so aloud ("the officer already verified this one"). Used on an order nobody has verified, the button skips the officer step and one person releases stock alone, which the two-step design exists to prevent. Use it only when the officer is unavailable and the Admin has seen the cash, and never in this demo before Officer step 2. See: the order is Paid. On the Student's phone, Store > My orders now shows "Paid" and the claim token (16 characters).
3. Propose an event (ceiling 4). Click: Events and tasks > Events, "New event". Fill "Event Name *" ("Tech Talk Night"), the start and end dates and times about 30 days ahead (use 09:00 to 12:00), choose any "SAO venue", click "Submit proposal". See: the Event details drawer with the "Event progress" stepper on "Department Head approval" and the line "Waiting for Department Head approval". Say: SO2.2. The approval chain is enforced by the system, not by a group chat.
4. Track what I submitted (ceiling 3). Click: close the drawer, Approvals, the tab "Submitted by me", then "Open event: Tech Talk Night". See: the same stage text as the row. Say: the Admin never has to ask where a request is.
5. Task delegation recommendation (no data saved). Click: Events and tasks > Tasks, "New task". Type "Prepare booth signage" in "Task Title *", set "Assigned category" to Publicity, click "Review officer recommendation". AI MOMENT: a ranked list of eligible officers with a "Recommended" tag and the line "Admin chooses the final assignee." Say: SO2.3. The score is rule-based and weighted: role 0.35, workload 0.30, past performance 0.20, assignment recency 0.15. Do not click "Create Task".
6. Financial forecast (no data saved). Click: Finance > Forecast, "Generate forecast". See: "OLS projections based on monthly transaction history". AI MOMENT: an ordinary-least-squares projection of income and spending from the ledger (the seed has three months of PSITS-CCS history). Say: SO2.1, financial management. The server also writes the plain-language explanation. If the page says the ledger is too short, say the seed is small and move on.

## 6. Department Head (5 minutes, includes the SAO semester gate)

Sign in as 940001 in Window A. Window B is already the SAO.

State needed: no active semester at the start. Ten PDFs ready (section 8, host prep 3).

1. Show the rule (ceiling 3). Click: Organizations (home link "Manage organizations" also works), "Register an organization". See: a dialog with the message "The SAO must activate a semester first." and no "Submit for review" button. Say: registration is tied to the academic calendar the SAO controls. Close the dialog.
2. SAO opens the semester (Window B, signed in as 990001). Click: Setup and records > Academic years. In the "Semesters" card click "Add semester" on the current academic year. Choose "1st Semester", set "Starts on" and "Ends on" to cover at least 2026-08-01 to 2026-12-31 (the card shows the year; covering the whole year is safest, events must fall inside the active semester), click "Add semester", then "Set as active". See: the semester shows as active. Say: SAO is the agency over every college. This hides the seeded events and election, which is why Round 1 came first.
3. Register an organization (ceiling 3). Back in Window A reload, then Organizations > "Register an organization". Type "Organization name" ("Robotics Society") and "Acronym" ("ROBO"). Choose one PDF in every file picker (ten of them, one per requirement). Click "Submit for review". See: the row reads "Pending review: waiting for SAO review". Say: the Department Head oversees a whole college and registers its organizations (PAPER_SCOPE_ADDENDUM section 2.4). AI moment: none.
4. Approve an item (ceiling 4). Click: Approvals (or the home link "N items awaiting your approval"), then "Review: Tech Talk Night", "Approve", and "Approve" in the dialog "Approve request". See: the drawer shows "Approved" and an "Open event" link. Say: SO2.1 and SO2.2, budgets, events, elections and reports all pass through this one inbox. The Admin is notified. If the event from Admin step 3 is missing, approve any other pending item, for example the budget "Sports Fest 2024 Budget" (seeded pending, UNCONFIRMED that it survives the semester change).
5. Optional, 20 seconds (ceiling 2). Click the bell "Notifications", then a notification. See: the exact item opens in a drawer.

## 7. SAO and the apply-for-an-organization flow (5 minutes)

Use Window B (990001). The home page shows "Review inbox".

Apply flow, ceiling 5:

1. Click the home link "Registrations awaiting review" (it shows a count). See: a card for "Robotics Society". That card exists only if Department Head step 3 (section 6) ran first; if it did not, run that step before this one. Click "Review Robotics Society" on the card.
2. In the drawer "Review registration" check the documents, then click "Approve". See: the text "Provision an administrator".
3. Click "Provision administrator". In the dialog "Create administrator" fill "School ID" (a new 7 digit number, for example 9100001), "First name", "Last name", "Email address", "Password" and "Confirm password" (a new password chosen live, written on the host sheet, never a demo password). Click "Create Admin User". See: the message "New Admin user created with the password set by SAO." Say: only an approved organization has members who can sign in.
4. Window A, still the Department Head: Organizations. The row for Robotics Society says "Administrator can sign in".
5. Private window: sign in with the new School ID. See: the page "Choose a new password" with "Current password", "New password", "Confirm new password". Click "Save new password". See: the Admin home with a "Getting started" progress bar and the links "Add positions", "Add members", "Propose an event" (the checklist may list more steps below them, such as "Set up programs"). Say: a new organization is onboarded end to end without a developer. Do not click the links. Close the private window.

Oversight, pick what time allows:

6. Agency overview (ceiling 2). Click: Organizations > Agency overview. See: colleges that need action first, and Robotics Society if still pending. Say: the SAO sees every college without touching any organization's ledger. GO, one centralized platform.
7. Answer the grievance (UX_FLOW 4, accepted 6: Grievances, open, Move to under review, Resolve, Resolve). Click: Reviews > Grievances, the row "Broken lights at the library walkway", "Move to under review", "Resolve", type remarks ("The lights were replaced and checked."), "Resolve". See: "Resolved". If the student's row is missing, use the seeded "Emergency exit chained during basketball practice" (Critical urgency, addressed to the SAO, still submitted). AI MOMENT: the urgency and category badges on the row were set by the classifier. On the Student phone, Support > My grievances shows Resolved with the remarks.
8. Review compliance (spec ceiling 4). Click the home link "Compliance submissions awaiting review", open a row in the "Review queue" tab, "Approve", and "Approve" in the dialog "Approve this submission?". See: the drawer shows Approved. The seed holds four submitted documents (JPIA-CBE, FES-CTE, EIG-COE).

Say: SAO is the fifth actor the dean asked for (PAPER_SCOPE_ADDENDUM section 2.1).

## 8. Prerequisites and reset notes per journey

Host prep (do before 60 minutes out, while no semester exists, as the matching accounts):

1. Ballot for the Student vote. The reset script creates this (step 10); if you did not run it, run `scripts\reseed-staging.ps1 -Execute` (this wipes and reseeds the staging site), or create it by hand as follows. The script builds "Demo Student Council Election", open now and for three days. The seeded election is never finalized, so no student can vote in it (the Student spec builds its own through the API). As Admin 900001: Voting > Elections > "Create election" (title, "Voting starts *" in the past, "Voting ends *" days ahead, one position). As 940001: approve it in Approvals. As 900001: add a party list and one candidate other than 2100142, then click "Finalize ballot" (the Admin NextStep card). Check: as 2100142 the home shows "Enter secure voting". UI click path UNCONFIRMED here; labels come from `ElectionPickerPage.jsx`, `ElectionNextStep.jsx` and `lifecycle.js`.
2. Task for the Officer. The reset script creates this (step 10); if you did not run it, run `scripts\reseed-staging.ps1 -Execute`, or create it by hand as follows. The script creates "Prepare the registration desk" for 900004. As 900001: Events and tasks > Tasks > "New task", a title, "Review officer recommendation", pick Diego Villanueva (900004) if listed, set a deadline, "Create Task". The seeded tasks belong to 900001 and 900002, not 900004.
3. Ten small PDFs on the desktop, each well under 10 MB.
4. Optional invoice. The reset script creates this (step 10); if you did not run it, run `scripts\reseed-staging.ps1 -Execute`, or create it by hand as follows. The script creates "Org membership fee", 150.00, for 2100142. By hand: Finance > Student accounts, click "Add student charge" (top of the page) or open the account of 2100142 with "View account" and click "Add charge"; in the dialog "Add Student Charge" fill the student school ID, the amount due (150), a description and the due date, then click "Add charge". See: the message "Student charge added successfully." (labels from `StudentFinancialAccountsPage.jsx`; the click path is UNCONFIRMED in a browser).

| Journey | What must exist | What it changes | How to tell it already ran | Seeded records used |
|---|---|---|---|---|
| Student join event | 2100142 not registered | One event registration | Drawer shows "You are registered" and no Register button. Use a back-up student | Sports Fest 2024 |
| Student vote | Finalized open ballot | One ballot per voter | Vote page card says "Voted"; Home shows "Vote submitted". Use a second student | Host-built ballot |
| Student order | Stock of HIUSA Tote Bag (20 seeded) | Order ORD-n, stock down | My orders already lists an ORD for 2100142. Another order is harmless | HIUSA Tote Bag |
| Student grievance | None | One grievance, one SAO queue row | My grievances lists "Broken lights at the library walkway". Rename the title | Seeded clearance period |
| Officer check-in | Ongoing event, no semester | One attendance row | "Attendance records" already lists that ID. Use 2200134 or 2300247 | Leadership Seminar 2024 |
| Officer verify | A pending cash order | Order moves to "Verified: waiting for Admin approval" | Order no longer shows "Verify". Fall back to the seeded pending shirt order (student 2200451) | Seeded pending order |
| Officer task | The prepared task | Task becomes In Progress | Card already says "In Progress". Create a second task | None |
| Officer announcement | AI draft quota left | One announcement awaiting the Admin | The row exists in Announcements | None |
| Admin propose and track | No semester needed | One event waiting for the Department Head | Approvals > "Submitted by me" lists it. Change the title | None |
| Admin task and forecast | Ledger history, an eligible officer | Nothing saved | Not applicable | General Operations Fund and three months of seeded transactions |
| Department Head register | Active semester, ten PDFs | One pending organization | Organizations lists the name. Use a new name and acronym | None |
| Department Head approve | A pending approval | Item becomes Approved | Drawer shows "Approved" and no Approve button | Admin's event or the seeded budget |
| SAO apply flow | The pending registration | Organization Active with one administrator, one new Admin account | Organization shows Active and "1 admins". Reseed or register another | Robotics Society |
| SAO grievance | A filed grievance | Status Resolved | Row says Resolved | Seeded "Emergency exit chained during basketball practice" |
| SAO compliance | Submitted documents | One submission decided | Row leaves the queue and the roll up count moves | Four seeded submitted documents |

Reset between rehearsals: `scripts\serve-lan.ps1 -Reset` on the laptop reseeds in about 30 seconds. For the staging server run `scripts\reseed-staging.ps1 -Execute` (it asks you to type RESET; without `-Execute` it is a dry run that contacts nothing). When: Tuesday evening after the group finishes testing, or Wednesday morning at least 2 hours before the demo. It takes about 5 minutes and prints the new SAO password once, at the very end: write it on the host sheet before closing the window. Afterwards run `scripts\demo-smoke.ps1` (it prompts for the SAO password; it never stores it) and expect READY, and run it again 30 minutes before the demo. Reseeding wipes the semester, the ballot, the prepared task and every change made on the site. On staging the reset script recreates the ballot, the task and the invoice itself (step 10); redo section 8 host prep after any other reseed.

## 9. If something breaks

| Symptom | Quick fix | Fallback |
|---|---|---|
| Site does not load or is slow | Reload once; check the address is `https://` | Switch to the laptop copy (below) |
| Sign-in says wrong password or locked | Retype slowly; five wrong tries lock an account for 15 minutes | Use another account of the same role (Adviser 990002 for Admin, a back-up student) |
| The SAO password is not at hand | Ask the host before the demo starts. If the reset script stopped or was interrupted, read its last lines: it prints the SAO password (marked UNVERIFIED if step 7 did not finish its check; test it), or says the password was probably changed and is unknown, or that 990001 is still on the public default password. In the last two cases run `scripts\reseed-staging.ps1 -Execute` again (about 5 minutes) or set a password with the tinker procedure in CLAUDE.md ("Tinker on the server") | Skip the SAO segments and show the Department Head side, then the recorded video |
| "Generate Draft" or "Generate forecast" fails or says daily limit | Wait a minute (about 5 a minute per user) | Type the announcement by hand; say the rules still run without the language model and show the recorded video |
| No "Enter secure voting" for the Student | Host prep 1 was not done or was wiped (the reset script step 10 creates it) | Show Voting > Results, or the recorded vote video |
| Check-in finds no member | Retype the ID, wait for the result row | Pick another ID such as 2200134 |
| "Register an organization" has no Submit button | The semester is not active yet | In Window B: Academic years > "Set as active" |
| Registration upload fails | Fewer or smaller PDFs; one per picker | Show the recorded video of the registration |
| A step was already used | Use the "already ran" column in section 8 | Use a second account, or skip to the next role |
| Staging is down | Start the laptop copy: `powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Reset`, open the address it prints. If it stops because port 5173 is taken by another program, add `-WebPort 5183`. Close other heavy apps first, a busy laptop makes the scripted journeys flaky | Recorded journey videos in the folder `Desktop\HIUSA-demo-videos` (52 videos, README inside); then skip to the next role |

The laptop copy works without internet. Its accounts and IDs are the same fresh seed. It starts with no semester too. AI text is off unless the script is started with `-EnableAi` and the laptop is online; the rule-based parts (classification, delegation ranking, forecast) work either way. If the SAO password is lost on the laptop copy, see MEMBER_TESTING section 1.

## 10. Pre-demo checklist

60 minutes before:
- If the Tuesday reset was skipped, reseed now with `scripts\reseed-staging.ps1 -Execute` (about 5 minutes) and note the new SAO password.
- Site opens on `https://13.228.227.182`; accept the certificate once on every device.
- All six accounts sign in. Passwords are on the host sheet. Sign out afterwards.
- The SAO password is known and tested.
- The SAO has not activated a semester. Check: Setup and records > Academic years shows no semester. If one exists, reseed and redo the host prep.
- Host prep 1 to 3 done. Check Student home shows "Enter secure voting".
- Back-up students 2300247 and 2300312 still show "Register for an upcoming event" on Home.
- One test "Generate Draft" worked (it uses one of the daily drafts; do not spend more).
- Recorded journey videos copied to the laptop, folder named by the host.
- Local laptop copy built once and verified, then left running or ready to start.

30 minutes before:
- Run `scripts\demo-smoke.ps1` and expect READY (it checks the sign-ins, no active semester, the demo ballot, the Officer's task, the two seeded events, the registration of 2100142 and the upload limits). Any FAIL: fix it or reseed, then run it again.
- Browser zoom 100 percent or 110 percent, bookmarks bar hidden, one window for A, one for B, one private window.
- Device mode tested: width 390 shows the "Open menu" button.
- Notifications and pop-ups off on the laptop (focus assist) and on the phone.
- Laptop plugged in, sleep off, screen mirroring tested.
- Phone on mobile data (not the school Wi-Fi) can sign in as the Student.

5 minutes before:
- Window B signed in as the SAO, on Academic years, with no semester.
- Window A on the sign-in page. Tabs for this script and the cheat sheet closed or on a second screen.
- Phone locked and in a pocket, plugged in if possible.
- The new Admin's School ID and password written on the host sheet, not on the slide.

## 11. Closing (2 minutes) and likely questions

Say: "HIUSA now covers the five roles end to end: students join, vote, order and report; officers check in, verify and announce; admins plan, fund and track; department heads approve and register organizations; the SAO governs the agency. AI helps in four places: announcement drafts, task delegation, financial forecasts and grievance classification. A person always decides."

Open "Study objectives" from the bottom of the menu (next to Profile, open to every role) to show each objective with live evidence. SO1 and SO4 are assessed outside the application.

What is next (roadmap in `docs/SOP_GAP_ANALYSIS.md`, ranked by evidence from the UC student manual and CHED orders): accreditation with a validity period, event timing rules, post-activity reports within 3 days, adviser rules, officer eligibility, fee approval, clearance holds, data privacy (privacy notice, consent for fingerprints, retention), SAO reports. Nothing in that list is built yet.

| Likely question | One-line answer |
|---|---|
| How does the AI work? Is it only a chatbot? | No. Rules and statistics do the deciding: weighted scoring ranks officers, OLS regression forecasts money, a keyword classifier tags grievances. Groq writes text only (announcement drafts, event plans, explanations). Laravel validates everything and writes to the database (`docs/ai-workflow-architecture.md`). |
| What if the AI is wrong or offline? | Output is advisory and editable, numbers in explanations must match the calculated facts, and the rule-based fallbacks keep working without the AI service. |
| What about privacy? | Data is scoped per organization and role, passwords are hashed and the browser never holds the AI key. An anonymous grievance hides the student from the organization but not from the SAO. A privacy notice and fingerprint consent are not built yet (SOP gap item 8). |
| Who can do what? | Five roles: Student, SBO Officer, Admin, Department Head, SAO. Officers and Department Heads see finance read-only; only the Admin records money. Department Heads do not vote. |
| Who approves an event? | The Department Head always; the SAO also clears events that need SAO files (PAPER_SCOPE_ADDENDUM section 3 (j)). |
| What is the data model? | Colleges contain organizations; users belong to one organization (Department Heads to a college); events, budgets, elections, orders and tasks belong to an organization and, once a semester is active, to that semester; approvals and an audit trail link them. Laravel API, React client, Python FastAPI service for AI. |
| How was it tested? | Playwright journey specs for each role at 1440 and 390 pixel widths with click ceilings, plus the server tests. |
| Why not use Messenger and spreadsheets? | No audit trail, no approval chain, no single record of money (the paper's problem statement). |

## 12. Not shown on purpose

- Admin check-in (completes other ongoing events) and the Officer claim desk (needs the Admin to approve first; one step of the relay).
- Fund an event budget (Admin journey 2): the budget step opens only after the Department Head approves the event.
- Prepare event report, set up the organization by hand (the checklist is shown only on the new Admin), SAO financial report decision (no seeded submitted report), Department Head follow-up of a returned registration, SAO event planner AI (no e2e path proved it).
- Voting results release, cash advances, venue booking, Programs and sections import, fingerprint enrollment: not in the journey specs.

## 13. Verification log

| Section | Derived from |
|---|---|
| Student | `client/e2e/journeys/student.spec.js` (J1 to J5), UX_FLOW section 9 STUDENT, `StudentGrievancesPage.jsx` for the grievance labels |
| Officer | `client/e2e/journeys/officer.spec.js` (O1 to O4), `CreateAnnouncementPage.jsx` for "Generate Draft" |
| Admin | `client/e2e/journeys/admin.spec.js` (A1, A3, A5 checklist), `TasksPage.jsx` and `FinancePage.jsx` for task delegation and forecast labels, `MerchandisePage.jsx` for "Approve payment" |
| Department Head | `client/e2e/journeys/dept-head.spec.js` (DH-1b, DH-1, DH-2, DH-4), `AcademicYearsPage.jsx` for the semester gate |
| SAO and apply flow | `client/e2e/journeys/sao.spec.js` (1, 2, 4, 5), `dept-head.spec.js` DH-1, `ChangePasswordPage.jsx` and `e2e/support/live.js` for the password change |
| Menu paths | `client/src/components/layout/navigation.js` |
| Seeded data | `server/database/seeders` (Event, Task, Budget, Order, Election, Merchandise, SaoGovernanceDemo) |
| Order, accounts | `docs/MEMBER_TESTING.md` sections 2 to 4, `docs/UX_FLOW.md` section 9 |

UNCONFIRMED in code or specs: the browser click path for Admin "Approve payment"; the UI path to build the ballot (specs use the API); the invoice creation path; whether the seeded budget and pending event approvals stay visible after a semester is active; whether staging has the AI service and a Groq key working (check on the day); the certificate warning; the exact insight cards on the Admin home.
