# Member testing guide

This guide is for the team members who test HIUSA. It says how to reach a copy of the system, which accounts to use, what to try, and what to write down. The goal is one question: can a person finish each job without getting lost? Every journey below has a click limit and an end state. If you needed more clicks, did not know what to do next, or saw words you did not understand, that is the finding.

## 1. Reaching the system

Pick one. Ask the person running the demo which one applies.

- Same Wi-Fi or router as the demo laptop: open the address the demo laptop prints, for example `http://192.168.1.2:5173`. The laptop owner starts it with `powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1` from the repository root (run it once as Administrator so Windows opens ports 5173 and 8000 for the local subnet). It serves a throwaway database that it creates and seeds on its first run (a separate MariaDB on 127.0.0.1 port 3317, never the development database), so use the fresh seed table in section 2. The first run takes a minute or two; later runs reuse the same data, and `-Reset` wipes it and seeds again. If the laptop is on more than one network, the script prints which address to use and the `-HostIp` option for the other one.
- A hosted copy: use the address the team gives you. Demo accounts only exist on a copy that was seeded for testing (the seeders create no accounts when the app runs with `APP_ENV=production`). Use the fresh seed table in section 2 for a copy seeded from the repository. Never test with demo passwords on a server that holds real student data.

Use a desktop browser first, then repeat the first journey of your role on a phone.

## 2. Demo accounts

Sign in with School ID and password. Which table applies depends on the copy you were given, so ask the person running the demo. The two copies use different SAO logins: 930027 does not exist on a fresh seed.

### Development database (not what `serve-lan.ps1` serves)

Password for every account below is `Demo@12345`. These are the accounts as the team recorded them for the development database. They were not re-checked here, because that database was not touched; the seeders do not create 930027.

| Role | School ID | Notes |
|---|---|---|
| SAO | 930027 | Runs the university side. |
| Department Head, College of Computer Studies | 940001 | Also 940002 (Business), 940003 (Teacher Education), 940004 (Health Sciences), 940005 (Engineering). |
| Admin of PSITS-CCS | 900001 | Organization administrator. 900002 and 900003 are also Admins. |
| SBO Officer | 900004 | Treasurer. 900005 to 900007 are other officers. |
| Student | 2100142 | Also 2100217. |

### Fresh seed (`php artisan migrate:fresh --seed`; also what `serve-lan.ps1` serves)

Checked by signing in to a freshly seeded copy through the sign-in API on 11 Oct 2026. Every account below signed in with the password shown and received a token.

| Role | School ID | Password | Notes |
|---|---|---|---|
| SAO | 990001 | `Admin@123456` | The only SAO account. 930027 does not exist here and `Demo@12345` is rejected for 990001. |
| Department Head, College of Computer Studies | 940001 | `Demo@12345` | Also 940002 (Business), 940003 (Teacher Education), 940004 (Health Sciences), 940005 (Engineering). One head per college. |
| Admin of PSITS-CCS | 900001 | `Demo@12345` | President. 900002 (Vice President, Internal) and 900003 (Secretary) are also Admins. 920011 is the Admin (President) of JPIA-CBE. |
| Adviser (an Admin of one organization, assigned by the SAO) | 990002 | `Admin@123456` | PSITS-CCS. 990012 is JPIA-CBE, 990022 FES-CTE, 990032 NSC-CHS, 990042 EIG-COE. `Demo@12345` is rejected for these. An adviser has the same role and menu as an Admin. |
| SBO Officer | 900004 | `Demo@12345` | Treasurer of PSITS-CCS. 900005 (Auditor), 900006 (Public Information Officer), 900007 (Business Manager). |
| Student | 2100142 | `Demo@12345` | PSITS-CCS. Also 2100217, 2100389, 2200055, 2200134, 2200298, 2200451, 2300078, 2300163, 2300247, 2300312, 2400019, 2400067, 2400093. 2400118 belongs to FES-CTE and 2400133 to EIG-COE. |

These 35 accounts are the complete set on a fresh seed. Only PSITS-CCS has officers and a full student list. NSC-CHS has only its adviser, and JPIA-CBE, FES-CTE and EIG-COE have their adviser plus 920011, 2400118 and 2400133. The sidebar shows an Admin's role as Organization Admin.

### Forced password change

On a fresh seed no account is made to change its password: all 35 signed in with `must_change_password` false and could open pages normally. The development database may differ, because the change can be forced on existing accounts (last bullet). If a sign-in there asks for a new password, set one and tell the demo owner. The forced change applies to accounts made or flagged later:

- Students created by a class list import (Programs and sections, Import class list). Each gets a random temporary password shown once after the import and offered as a CSV download. It is not the demo password and it is not derived from the school ID.
- Administrators and Department Heads the SAO creates, and accounts an administrator creates or sets a password for. This is from the code, not run for this guide.
- Any account flagged by `php artisan users:flag-default-passwords`. Run on a fresh seed it flagged all 35 accounts, and after that the API refused every page except the account and password change with 403 and `PASSWORD_CHANGE_REQUIRED` (tried for 990001, 940001 and 2100142).

The person doing the test should see a screen that asks for a new password, and nothing else opens until it is set. That screen was not opened in a browser for this guide; only the API side was checked.

## 3. One setup step before anyone tests

A fresh seed has one academic year (2026-2027 when seeded on 11 Oct 2026, marked Current) and no semester. Until the SAO adds a semester and sets it as active, a Department Head has no registration requirements and cannot register an organization: the API refuses with "No registration requirements are open. The SAO must activate a semester first." Adding a semester is not enough, it starts as upcoming. On the development database the semester may already exist; open the Academic years page and check.

1. Sign in as the SAO (990001 on a fresh seed, 930027 on the development database).
2. Open Academic years under Setup and records. In the Semesters card choose Add semester, pick 1st Semester and dates that cover the whole test period (events must fall inside the active semester's dates), then choose Set as active on the new semester.

Checked on a fresh seed through the API by adding a semester and activating it: before, the Department Head's list of registration requirements was empty; after, it held ten. Adding the semester without activating it changed nothing.

Opening the semester changes what the seeded demo data shows. The seeded events, tasks and election belong to no semester, so once a semester is active they leave the lists. Checked: PSITS-CCS Admin saw 4 events, 8 tasks and 1 election before, and 0 of each after; a student saw 3 events before and 0 after. Orders, store items, budgets and announcements stay. So run in two rounds:

- Before opening a semester: the journeys that use the seeded events, tasks or election (Admin step 4 check-in, SBO Officer steps 1 and 3, Student steps 1 and 2), plus everything that does not need a semester.
- After opening it: the Department Head registration journeys, and any journey where the Admin proposes new events and elections first (then new items fall inside the semester). Whether a student can then vote in an election created this way was not tried.

## 4. How to test

Work in pairs: one person does the journey, one watches and writes. Do not help. If the person stops and looks around, write down what they were looking for. Note the screen, what they clicked, and what they expected.

For each journey: start at the home page after signing in, count clicks (typing and choosing a file do not count), and check the end state. A journey passes when the end state is reached within the click limit and the person never asked "where do I go now".

Menu names as the sidebar shows them today (from the menu configuration, in order). Use these when a journey names a page. A group opens its first page when you click it.

- SAO: Dashboard; Organizations (Agency overview, Registrations and organizations, Administrators, Colleges); Reviews (Compliance, Venues, Grievances, Clearances); Updates (University announcements, Notifications); Setup and records (Academic years, Audit trail).
- Department Head: Dashboard, Approvals, Organizations, then Finance (Budgets, Ledger, Financial reports, Forecast), Calendar, Election results and Announcements under College view (read only).
- Admin (shown as Organization Admin): Dashboard, Approvals; Members (People, Officer positions, Programs and sections); Finance (Budgets, Ledger, Collections and advances, Student accounts, Financial reports, Forecast); Events and tasks (Events, Venue booking, Planning, Tasks, AI delegation, Check-in); Voting (Elections, Results); Store (Inventory, Orders, Claim desk); Updates (Announcements, Feed); Records (Compliance, Grievances, Clearance signing, Audit log); My activity (Vote, Shop, My orders, My receipts, Statement of account).
- SBO Officer: Dashboard; Events and tasks (Check-in, Calendar, Venue booking, My tasks, AI delegation); Finance (view only); Members and fingerprints; Voting (Candidates, Voters, Results); Store (Orders, Claim desk); Updates (Announcements, Feed); Clearance signing; My activity.
- Student: Dashboard; My payments (Statement of account, Receipts); Events; Voting (Vote, Results); Store (Shop, My orders); Updates (Announcements); Support (My clearance, My grievances).
- Every role also has Profile and Study objectives at the bottom of the menu.

### SAO

1. Approve a registration and give it an administrator (5 clicks). The home page shows how many registrations wait. Open it (Registrations and organizations), review the documents, approve, then follow the next step (Create administrator) to create the organization's administrator. End: the organization is Active with one administrator. This needs a registration from a Department Head, so open a semester first (section 3). The new administrator must change their password at first sign-in.
2. Review compliance (3 clicks). From the home page, land on the review queue (Reviews, Compliance), open a submission, decide. End: the submission shows its new status.
3. Decide a financial report (3 clicks, also under Reviews, Compliance). End: the report shows Approved.
4. See who needs attention (2 clicks). Open Organizations, Agency overview. End: organizations that need action are listed first.
5. Answer a grievance (4 clicks). Reviews, Grievances. End: the student's My grievances shows Resolved.

### Department Head (940001)

1. Register an organization (3 clicks). Organizations, Register an organization, submit with the ten files. Needs an active semester (section 3). End: the row reads Pending review and its status says Pending review: waiting for SAO review.
2. Approve an item (4 clicks). Approvals, open an item, Approve, confirm. End: the item shows Approved and links to the event, budget or report.
3. Follow up a returned registration (3 clicks from home). End: the row reads Waiting for SAO review again.
4. Act from a notification (2 clicks). Click the bell, click a notification. End: you land on the exact item.

### Admin (900001)

1. Propose an event (4 clicks, plus one for SAO files if the SAO requires them). End: the event shows its stepper and says who it is waiting for. You should not need to ask anyone where it is.
2. Fund it (3 clicks from the event). Propose a budget from the event page. End: the event shows the budget waiting for the Department Head.
3. Track what you submitted (3 clicks). Approvals, Submitted by me. End: the row stage text equals the event page text.
4. Run and report (3 clicks each). Check in attendance (Events and tasks, Check-in); from the finished event, prepare the report. End: the report shows as a draft to review and submit.
5. Set up the organization (3 clicks per step). Follow the Getting started card: officer positions, members, first event.

### SBO Officer (900004)

1. Check someone in (4 clicks). Events and tasks, Check-in. End: attendance count goes up.
2. Verify a payment and release an order (6 clicks). Store, Orders, verify, then Store, Claim desk. End: the order shows Claimed.
3. Update my task (3 clicks). End: the card shows the new stage.
4. Send an announcement for approval (4 clicks). End: the row says Waiting for Admin approval.

### Student (2100142)

1. Join an event (3 clicks). End: the event says You are registered.
2. Vote (2 clicks from home; in the menu, clicking Voting opens the Vote page). End: a receipt, and the Vote page lists the election as Voted.
3. Order and claim (5 clicks to order). End: My orders shows the order with the next step. After an officer verifies it, it shows Paid and the claim token.
4. See what you owe (2 clicks). My payments, Statement of account. End: balance and clearance status are visible without scrolling.
5. File a grievance and check clearance (4 and 2 clicks). Support, My grievances and My clearance. End: the grievance reads Waiting for Admin to review, or Waiting for SAO to review when it was addressed to the SAO.

A student account created by a class list import must set its own password at first sign-in. Try that once if you can: an Admin imports a class list with a new student (Members, Programs and sections, Import class list) and downloads the temporary passwords file, then sign in as that student with the temporary password. Expect a screen that asks for a new password, and confirm nothing else opens until you set it. Seeded demo students are not forced to change their password (section 2).

## 5. Questions to ask after each journey

- At any point did you not know what to do next? Where?
- Which word did you not understand? What did you think it meant?
- Did you click something expecting one result and get another?
- Was there a page you wanted but could not find in the menu?
- Did two screens disagree about the same thing (for example a status)?

## 6. Menu label card sort (5 student leaders, 10 minutes)

The menu groups use plain words ("Records", "Events and tasks", "Store", "Updates"). Before the labels are frozen, give five student leaders cards for each page name and ask them to group the cards and name the groups. Compare their groups and names with the menu. Differences are the findings.

## 7. What to report

One line per finding, in this shape:

`Role, journey and step, what you did, what you expected, what happened, screenshot if any.`

Mark each as: blocked (could not finish), lost (finished but confused), wording (misleading text), or looks wrong (layout or visual). Send blocked findings first.

## 8. Safety notes for whoever hosts the demo

- Plain HTTP: passwords and sign-in tokens that cross the network can be read by anyone else on it. Use a network you trust (a home router or a lab you control), not shared public Wi-Fi.
- The demo accounts have known passwords, and the SAO account (930027 on the development database, 990001 on a fresh seed) has full SAO power over that database. Treat every tester as an administrator of the demo data.
- Serve a database that holds no real student data, emails or fingerprint templates. Files that testers upload are saved on the host computer's disk.
- The script opens its ports for your own subnet only and only on networks Windows calls Private. If your Wi-Fi is classed as Public, switch it to Private in Windows settings, or pass `-AllowPublicNetwork` knowing the risk. Only 8000 (the API) and 5173 (the web page) are opened, and only when the script runs as Administrator. The script starts its own throwaway database (hiusa_lan, port 3317) bound to this computer only; it never uses the development database, and its generated password stays in the gitignored `.lan-db` folder. Error pages show no file paths or stack traces (debug is switched off for the API the script starts).
- Stop the demo when the test ends: `powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop`. It stops the API, the web page and the throwaway database it started (the data stays in `.lan-db` until you run the script with `-Reset`); no other database is touched. Run `-Stop` as Administrator too, or the firewall rule stays until you remove "HIUSA LAN test" in Windows Firewall.
- Sign-in has a lockout: five wrong passwords for one account lock it for 15 minutes. If several testers share one demo account, someone mistyping can lock the others out. Wait 15 minutes or use a different account.

## 9. Known limits of this copy

- Email is not sent from the demo laptop, so password reset links do not arrive. Ask the SAO to reset a password if you need one.
- The AI features fall back to rule-based answers when the AI service is not running.
- Demo data is a fresh seed (or the development database on a copy that is not run by `serve-lan.ps1`). Records you create stay until the database is restored or reseeded. Ask the demo owner to run `serve-lan.ps1 -Reset` between test sessions. Reseeding a fresh copy with `php artisan migrate:fresh --seed` wipes everything, including the semester the SAO opened in section 3.
