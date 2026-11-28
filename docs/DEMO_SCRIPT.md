# HIUSA live demo

About 15 minutes. One real request travels from the SAO to a student and back. Names in bold are what the app shows; the flow behind each step is in `docs/PROCESS_FLOW.md`.

## Logins

Sign in with **Email or school ID**. Password for every account: given by the presenter.

| Who | Email | Used in |
|---|---|---|
| SAO | `sao.director@hiusa.local` | Window A, steps 1, 2, 9, 12 |
| Dean, Computer Studies | `dean.ccs@hiusa.local` | Window B, steps 3 to 9 |
| Organization head, PSITS-CCS | `officer1@hiusa.local` | Window C, step 11 |
| Student with an account | `juan.delavega@student.hiusa.local` | Step 10 |
| New student | none yet: Hannah Reyes, school ID 2500101, birth date 2007-03-14 | Steps 6 to 10 |
| New staff | none yet: Marites Dizon, Department Secretary | Step 4 |

Use a private window for anyone who opens a link or signs up, and an email you own for new accounts. Spare sign-up records (school ID, birth date): 2500102, 2006-11-02. 2400210, 2005-07-21. 2300215, 2004-01-09. 2200320, 2003-09-30. 2400330, 2005-05-17.

Before you start: the SAO has an active semester under **Academic years** (adding a semester creates the requirements an application needs; without them **Apply for an organization** says "Applications are closed"). The election data is whatever the server holds today: on the live server there is one election, still open for voting, and no election has been closed, so step 11 shows that election and explains the handover in words. Do not create or close an election for the demo.

## Walkthrough

1. **The hierarchy.** Window A, open **Colleges**. Say: "The SAO sits on top. Colleges start from a list; the SAO can add one, delete an empty one and archive the rest."
2. **Dean invite.** **Add college**, type a name and a code, confirm. Then **Invite Department Head**, choose that college, **Create link**, **Copy link**. Open the link in a private window, enter name, email and password, **Create account**. Say: "The SAO types no school ID and no password. The dean makes their own."
3. **Where am I.** Window B, the CCS dean. The **Dashboard** shows the tracker titled **Setting up your college**, with **Next for you: Office staff added** and one button, **Add office staff**. The college has no office staff yet, so that is its next step; step 4 completes it. Say: "The dean always sees where the college is in the flow, with one next action." Then sign in as the new dean from step 2 and open the **Dashboard**: the same tracker lists the steps from **Office staff added** to **Organizations active**, all still ahead, because a new college starts from the beginning. Say: "A college that has finished setup shows one line, **Setup complete**. A new college shows where it stands."
4. **Staff.** **People**, tab **Office staff**, **Add staff**, type "Marites" under **Find in the employee records**, point out that School ID is read only and Position is filled from the record, **Create invite link**, **Copy link**. Open it in a private window, set email and password. Say: "Staff numbers come from the school records. The dean sees them and cannot change them." Once Marites has set a password, the dean's **Dashboard** moves on to **Next for you: Student records loaded**.
5. **Student records.** **People**, tab **School records**, **Upload school records**. Say: "The dean loads the college's records once, and students are matched against them."
6. **Student sign-up.** Private window, **Sign in**, **Create your account**. Enter 2500101 and 2007-03-14, an email and a password, **Create account**. Read the name and college on **Your account is ready**. Say: "Name and college come from the school record. The student only adds an email and a password."
7. **Allow to apply.** Window B, **People**, tab **Students**, **Allow a student to apply**, search "Hannah", **Allow to apply**. Say: "The dean decides who may start an organization, by name, never by ID number."
8. **Apply.** Hannah's window, **Open my dashboard**, **Apply for an organization**. Fill name, acronym, position and the requirement files, **Send application**. Say: "Creating an organization is the students' job. The dean oversees it."
9. **Two-step review.** Dean, **Organization applications**, **Review**. Mark one requirement **Needs changes** with a note, **Return with comments**. Hannah opens her application from the tracker, reads the note, **Send again**. The dean marks every requirement **Accepted**, **Endorse**. SAO, **Applications**, tab **To review**, **Review**, **Approve**. Say: "Two reviewers, a note per requirement, and the student sees what to fix."
10. **Officer access.** Hannah is now head of the new organization. In the top bar open the workspace switcher and choose it, open **People**, card **People and access**, **Give access**, pick Juan Dela Vega, access level **Officer**, untick everything except Events and Tasks, **Give access**. Juan signs in in another window, opens the workspace switcher and picks the organization: only those two modules show. Say: "Access goes to people, a module at a time, and the sidebar follows it."
11. **Election handover.** Window C, **Elections**, then **Results** of the election on the list. Today's data has one election, still open for voting, so the page reads **Voting is open. Only turnout shows until the election closes.** Say: "Results appear only after an election is closed. Then each winner shows **Upcoming officer, access starts** and the term start date, and from that date **Officer access active**. A tie shows **Tie, assign manually**. Winners take office on the term start date, and the officers they replace step down at the end of the school year. Nobody edits access by hand." Do not close the election to show this; say it in words.
12. **Oversight and records.** SAO, **Colleges**, click Computer Studies to see its organizations, **Open** on an organization, tabs **Transactions** and **Documents**. Then **School year records**: pick a school year, read **Officers**, note **Read only**. Say: "The SAO and the dean see everything an organization does, transactions included. The organization cannot see their side."

## If something goes wrong

- A link expired or was used: make a new one. A link lasts 48 hours and works once.
- **Allow a student to apply** finds nobody: do step 6 first. Sign-up cannot match: check the ID and birth date above.
