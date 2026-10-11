# Member testing guide

This guide is for the team members who test HIUSA. It says how to reach a copy of the system, which accounts to use, what to try, and what to write down. The goal is one question: can a person finish each job without getting lost? Every journey below has a click limit and an end state. If you needed more clicks, did not know what to do next, or saw words you did not understand, that is the finding.

## 1. Reaching the system

Pick one. Ask the person running the demo which one applies.

- Same Wi-Fi or router as the demo laptop: open the address the demo laptop prints, for example `http://192.168.1.2:5173`. The laptop owner starts it with `powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1` from the repository root (run it once as Administrator so Windows opens the two ports). It serves the development database with demo accounts.
- A hosted copy: use the address the team gives you. Demo accounts only exist on a copy that was seeded for testing. Never test with demo passwords on a server that holds real student data.

Use a desktop browser first, then repeat the first journey of your role on a phone.

## 2. Demo accounts (development database)

Sign in with School ID and password. Password for every account below is `Demo@12345`.

| Role | School ID | Notes |
|---|---|---|
| SAO | 930027 | Runs the university side. |
| Department Head, College of Computer Studies | 940001 | Also 940002 (Business), 940003 (Teacher Education), 940004 (Health Sciences), 940005 (Engineering). |
| Admin of PSITS-CCS | 900001 | Organization administrator. 900002 and 900003 are also Admins. |
| SBO Officer | 900004 | Treasurer. 900005 to 900007 are other officers. |
| Student | 2100142 | Also 2100217. |

A fresh database seeded from the repository uses different SAO and Admin logins; see the README demo accounts section.

## 3. One setup step before anyone tests

There is no open academic semester on a clean copy. Department Heads cannot register organizations until the SAO opens one.

1. Sign in as the SAO (930027).
2. Open Academic years under Setup and records. Create a semester for the current year and make it the active one.

## 4. How to test

Work in pairs: one person does the journey, one watches and writes. Do not help. If the person stops and looks around, write down what they were looking for. Note the screen, what they clicked, and what they expected.

For each journey: start at the home page after signing in, count clicks (typing and choosing a file do not count), and check the end state. A journey passes when the end state is reached within the click limit and the person never asked "where do I go now".

### SAO

1. Approve a registration and give it an administrator (5 clicks). The home page shows how many registrations wait. Open it, review the documents, approve, then follow the next step to create the organization's administrator. End: the organization is Active with one administrator.
2. Review compliance (3 clicks). From the home page, land on the review queue, open a submission, decide. End: the submission shows its new status.
3. Decide a financial report (3 clicks). End: the report shows Approved.
4. See who needs attention (2 clicks). Open the agency overview. End: organizations that need action are listed first.
5. Answer a grievance (4 clicks). End: the student's My grievances shows Resolved.

### Department Head (940001)

1. Register an organization (3 clicks). Organizations, Register, submit with the ten files. End: the row reads Pending review, waiting for SAO review.
2. Approve an item (4 clicks). Approvals, open an item, Approve, confirm. End: the item shows Approved and links to the event, budget or report.
3. Follow up a returned registration (3 clicks from home). End: the row reads Waiting for SAO review again.
4. Act from a notification (2 clicks). Click the bell, click a notification. End: you land on the exact item.

### Admin (900001)

1. Propose an event (4 clicks, plus one for SAO files if the SAO requires them). End: the event shows its stepper and says who it is waiting for. You should not need to ask anyone where it is.
2. Fund it (3 clicks from the event). Propose a budget from the event page. End: the event shows the budget waiting for the Department Head.
3. Track what you submitted (3 clicks). Approvals, Submitted by me. End: the row stage text equals the event page text.
4. Run and report (3 clicks each). Check in attendance; from the finished event, prepare the report. End: the report shows as a draft to review and submit.
5. Set up the organization (3 clicks per step). Follow the Getting started card: officer positions, members, first event.

### SBO Officer (900004)

1. Check someone in (4 clicks). End: attendance count goes up.
2. Verify a payment and release an order (6 clicks). Orders, verify, then the Claim desk. End: the order shows Claimed.
3. Update my task (3 clicks). End: the card shows the new stage.
4. Send an announcement for approval (4 clicks). End: the row says Waiting for Admin approval.

### Student (2100142)

1. Join an event (3 clicks). End: the event says You are registered.
2. Vote (2 clicks from home, 3 from the menu). End: a receipt, and the Vote page lists the election as Voted.
3. Order and claim (5 clicks to order). End: My orders shows the order with the next step. After an officer verifies it, it shows Paid and the claim token.
4. See what you owe (2 clicks). End: balance and clearance status are visible without scrolling.
5. File a grievance and check clearance (4 and 2 clicks). End: the grievance reads Waiting for the Admin or SAO to review.

A student account created by a class list import must set its own password at first sign-in. Try that once if you can: sign in with the default, expect a screen that asks for a new password, and confirm nothing else opens until you set it.

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
- The demo accounts have known passwords, and the SAO account (930027) has full SAO power over that database. Treat every tester as an administrator of the demo data.
- Serve a database that holds no real student data, emails or fingerprint templates. Files that testers upload are saved on the host computer's disk.
- The script opens its ports for your own subnet only and only on networks Windows calls Private. If your Wi-Fi is classed as Public, switch it to Private in Windows settings, or pass `-AllowPublicNetwork` knowing the risk. The database port stays closed to the network, and error pages show no file paths or stack traces.
- Stop the demo when the test ends: `powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop`. It stops only what it started.
- Sign-in has a lockout: five wrong passwords for one account lock it for 15 minutes. If several testers share one demo account, someone mistyping can lock the others out. Wait 15 minutes or use a different account.

## 9. Known limits of this copy

- Email is not sent from the demo laptop, so password reset links do not arrive. Ask the SAO to reset a password if you need one.
- The AI features fall back to rule-based answers when the AI service is not running.
- Demo data is the development database. Records you create stay until the database is restored. Ask the demo owner to restore it between test sessions.
