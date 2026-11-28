# HIUSA dean demo: set the system up from the beginning

Live site: https://13.228.227.182

This guide was rehearsed end to end on the live site on 15 November 2026, on release e09cd64a (r17d profiles plus r17c self-serve). The site now runs 3197eb6a (adds r17f Ask AI answers, r17e audit fixes, the member shop/feed/payments/grievance fix, the dean invite email and saved event file marks; those last fixes were checked in a browser on a copy) and was reset to its first-time state at 07:36 PHT. An invitation made for an email that already has an account is refused with "That email already has an account.", so use fresh addresses. Every step marked "Worked" was done for real with the labels and values below. Steps or parts marked "Not working yet" failed on screen. Say nothing about those in the demo, or use the workaround given.

The order follows what the dean asked for: SAO signs in, school year and semesters, colleges, dean invited, office staff invited, organization applies and is approved, students added, the organization runs, an election, profile switching, Ask AI.

Passwords are never written here. The SAO password is the one Jade holds (school ID 990001). Every other password is chosen on the day by the person making the account, at least 8 characters. Write each one in your own notes.

## Preflight checklist

Do this before the dean sits down.

1. The live site opens. If the browser warns about the certificate for the IP address, accept it once in every browser you will use.
2. The site is in its true first-time state: sign in as the SAO, open "Setup and records", then "Academic years". It must read "No academic year set" with the button "Add academic year". If a year exists, Step 2 has already been done.
3. "Governance" in the SAO sidebar shows "Colleges", "Student records", "Applications" and "Organizations". "Reviews" shows "Compliance", "Approvals", "Venues", "Grievances", "Clearances" and "Election results".
4. "Colleges" lists the five seeded colleges, in this order on screen: College of Business Education (CBE), College of Computer Studies (CCS), College of Engineering (COE), College of Health Sciences (CHS), College of Teacher Education (CTE). Each says "No Department Head yet". This demo uses CCS.
5. Use separate sessions for each person. The app keeps the sign-in in the browser, and all private windows of one browser share it. Use five sessions, for example Chrome normal, Chrome private, Edge normal, Edge InPrivate and Firefox. Sessions end after four hours.
6. Mail is on. Typing an address in an invitation really sends an email. Use two real inboxes you can open on the day, for example yourname+dean@gmail.com and yourname+staff@gmail.com. Each link also shows on screen, so the demo does not depend on the email arriving.
7. Sign up is rate limited. About three student sign ups per minute from one network are accepted, then the screen says "Too many requests. Please try again in NN seconds." Sign students up one at a time, or wait a minute.
8. Sample files. Everything below is in `C:/BSIT/React/Hiusa-FULL/demo-sample-files/dean-demo/` (folders `csv/` and `pdfs/`):
   - `csv/student-records-demo.csv`: four students, Juan Dela Cruz and Maria Santos (CCS), Paolo Reyes (CTE), Ana Villanueva (CHS).
   - `csv/ccs-extra.csv`: four more CCS students. Header line and rows:

```
school_id,first_name,last_name,birth_date,college_code,record_type,position,program,year_level,section
78978993,Carlo,Mendoza,2005-03-12,CCS,student,,BSIT,2,A
78978994,Bea,Navarro,2005-09-01,CCS,student,,BSIT,3,B
78978995,Luis,Garcia,2004-12-09,CCS,student,,BSIT,1,A
78978996,Rina,Aquino,2006-02-18,CCS,student,,BSIT,2,B
```

   - `pdfs/` holds every PDF in the table below, one page each, named after the requirement.
   - `pdfs/gcash-qr-demo.png`: a plain picture to stand in for the GCash QR (any PNG, JPG or WEBP up to 5 MB works).
   - `demo-sample-files/student-records-demo-sunday.csv` holds one row only (Demo Student, 78979001, CCS). It is not used here.
9. Try one Ask AI question as the SAO before the dean arrives (Step 11). If it errors, tell the dean the AI step is skipped.
10. Dates. Semester 1 runs Aug 3 to Dec 30, 2026. Every event, task, fee and election date you type must sit inside it. The election start can be a few minutes ahead.

### Which PDF goes in which slot

Organization application, ten slots, in the order the form lists them. All must be PDF, up to 10 MB each.

| Slot on "Apply for an organization" | File |
|---|---|
| Letter of Intent | `1_Letter_of_Intent.pdf` |
| Calendar of Activities (1st & 2nd Sem) | `4_Calendar_of_Activities.pdf` |
| Organizational Profile | `Organizational_Profile.pdf` |
| Constitutional By-Laws | `2_Constitution_and_ByLaws.pdf` |
| VMGO | `VMGO.pdf` |
| Official List of Officers | `3_Official_List_of_Officers.pdf` |
| Officers Data Sheets | `Officers_Data_Sheets.pdf` |
| Faculty Adviser's Data Sheet / Certificate of Appointment | `Faculty_Adviser_Data_Sheet.pdf` |
| Endorsement Letter | `Endorsement_Letter.pdf` |
| List of Members | `List_of_Members.pdf` |

Event proposal, three slots under "Required letters and documents (on-campus SAO checklist)":

| Slot | File |
|---|---|
| Venue Reservation Letter | `Venue_Reservation_Letter.pdf` (a copy of `5_Event_Venue_Request_Letter.pdf`) |
| Request Letter | `Request_Letter.pdf` |
| Equipment & Technical Request Forms | `Equipment_Technical_Request_Forms.pdf` |

Election: "Informative letter (PDF)" takes `1_Letter_of_Intent.pdf`.

## Accounts created during the demo

| Account | Role | Who creates it | How it signs in |
|---|---|---|---|
| SAO, school ID 990001 | SAO (top agency account) | Already exists | "Email or school ID" plus the password Jade holds |
| SAO staff, school ID 990002 (rehearsal: Sofia Ramos) | SAO staff, second office account | The SAO, "Add SAO staff", by invitation link | The email typed plus her own password, or school ID 990002 |
| Dr. Ramon Castillo, school ID 10020001 | Department Head (dean) of CCS | The SAO, from the college page, by invitation link | The email he types plus his own password, or school ID 10020001 |
| Marites Dizon, school ID 10020002 | Office staff of CCS | The dean, by invitation link only | The email she types plus her own password, or school ID 10020002 |
| Juan Dela Cruz, school ID 78978989 | Student, then organization head (Admin profile) | Himself, by sign up. The Admin profile comes from the approved application | School ID or email plus his own password. He switches workspace in the top bar |
| Maria Santos, school ID 78978990 | Student, then Officer (Treasurer) | Herself, by sign up. The Officer profile comes from "Give access" by the head | School ID or email plus her own password |
| Carlo Mendoza 78978993, Bea Navarro 78978994, Luis Garcia 78978995, Rina Aquino 78978996 | Students, then members | Themselves, by sign up. Membership from "Give access" | School ID or email plus own password |

Nobody creates a student, an office staff member or an organization head by typing a school ID and password for them.

---

## Step 1. The SAO signs in

Status: Worked.

Signed in as: nobody yet. Window A.

1. Open https://13.228.227.182. On the landing page press "Log in".
2. In "Email or school ID" type `990001`.
3. In "Password" type the SAO password Jade holds.
4. Press "Sign in".

Proof: you land on the SAO dashboard at `/dashboard/super-admin`. The sidebar reads Dashboard, University users, Ask AI, Governance, Reviews, Files, Updates, Setup and records. The dashboard shows "Setting up HIUSA" with the steps Academic year set, Semesters added, Semester activated, Colleges added, Dean invited, Dean active, School records loaded, Requirements published, Organizations applying, Organizations active, and "Next for you: Academic year set".

Watch out: if the app asks for a new password after sign in, set one and continue.

### Step 1b. The SAO adds a second SAO account holder

Status: Worked. The SAO is an office, not one person.

Signed in as: SAO (Window A).

1. Sidebar "University users". The page lists SAO accounts. Press "Add SAO staff" (top left, under the title).
2. The window is titled "Add SAO staff". "Email (optional)": type `sao.staff@yourdomain` (a real inbox on the day).
3. Press "Create link".
4. The window shows "Invite link" with "Works once and expires in 48 hours." and a "Copy link" button. Press "Copy link". Press "Done".
5. Open the link in a separate session (Window B). The page reads "You're invited to the Student Affairs Office as SAO staff". It says who invited her.
6. "First name": `Sofia`. "Last name": `Ramos`. "School ID" (hint "Your employee number."): `990002`. "Email": type the same address (the field starts empty). "Password" and "Confirm password": choose one. Press "Create account".

Proof: she lands on the SAO dashboard at `/dashboard/super-admin` with the same sidebar as the SAO. "University users" now lists both accounts with "SAO" as the role. The "Add SAO staff" button is the only way an SAO account is made.

Watch out: in the rehearsal the Email field did not fill itself from the link, so type it. "University users" shows 10 rows per page. Your own row has only "View user and clearance" in its row menu, and its details say "You cannot deactivate or delete your own account." The status filter offers "Active" and "Deactivated".

---

## Step 2. School year and semesters

Status: Worked.

Signed in as: SAO (Window A).

Path: sidebar "Setup and records", then "Academic years". The page reads "Academic years", "Calendar", "No academic year set" and a button "Add academic year".

### 2a. Add the school year

1. Press "Add academic year". The window is titled "Add academic year".
2. "Starts on": `2026-06-01`. "Ends on": `2027-05-31`. "Label" fills itself as `2026-2027`. Keep it.
3. Press "Add academic year" at the foot of the window.

Proof: a notice reads "2026-2027 is now the current academic year". The page heading reads "2026-2027 is the current year, June 1, 2026 to May 31, 2027". The calendar lists the year with the status "Current". Under "Semesters", the block "AY 2026-2027" says "No semesters added."

### 2b. Add the two semesters

1. In the "AY 2026-2027" block press "Add semester". The window is titled "Add semester to AY 2026-2027".
2. "Semester": "1st semester". "Starts on": `2026-08-03`. "Ends on": `2026-12-30`. Press "Add semester". A notice reads "Semester added. All default requirements for organizations, renewals, events, and semestral reports are active for this semester."
3. Press "Add semester" again. "Semester" now defaults to "2nd semester". "Starts on": `2027-01-04`. "Ends on": `2027-05-28`. Press "Add semester". The same notice shows.

Proof: both rows show under "AY 2026-2027". The 1st semester row has "Edit dates" and "Activate". The 2nd semester row has "Activate" greyed with the line "Starts on January 4, 2027. Change its dates or activate it from that day."

### 2c. Activate the 1st semester

1. On the "1st semester" row press "Activate". The window "Activate semester" says "This semester becomes the active one. You can close it from this page when it is over." and shows "1st semester, AY 2026-2027".
2. Press "Activate semester".

Proof: a notice reads "Academic semester activated". The 1st semester row shows an "Active" badge and a "Close semester" button. The top bar now reads "AY 2026-2027 · 1st Semester". The dashboard tracker moves on. Nothing in the demo works without an active semester.

Say: "The system will not let a semester start before its start date. The next semester must never be activated early. Activating it closes the current semester and hides its records from every member, and the app has no one-step undo for that."

Do not press "Close semester". Do not activate the 2nd semester. Do not use "Edit dates" to force it.

### Watch out (Step 2)

- The label must be two consecutive years like `2026-2027`.
- Semester dates must sit inside the year dates and may not overlap each other.
- Activating a semester completes the one that is active. An election that is upcoming or open blocks any semester change.
- Treat "Close semester" and "Activate" as one way during a demo.

---

## Step 3. Colleges: show the seeded list, add one

Status: Worked.

Signed in as: SAO (Window A).

Path: sidebar "Governance", then "Colleges".

1. Show the cards. The page reads "Colleges" with the counters "Pending reviews", "Organizations", "Archived". Each card shows the college name, the code, "Department Head", "No Department Head yet", "Invite Department Head" and "0 organizations · 0 members".
2. Press "Add college" (top). A panel titled "Add college" opens. "College name": `College of Arts and Sciences`. "Code": `CAS`. "Color" is optional. Press "Add college".
3. For the rest of the demo use College of Computer Studies (CCS).

Proof: a notice reads "College of Arts and Sciences added." The new card sits first in the alphabetical list, with the code CAS and "No Department Head yet".

Watch out:

- "College name" and "Code" are both required and unique. The school records import matches a student to a college by its code.
- A college with no organizations or people can be removed from its card menu. A college that has any can only be archived. Do not archive during the demo.

---

## Step 4. The dean is invited, accepts and sets a password

Status: Worked.

### 4a. The SAO makes the link

Signed in as: SAO (Window A).

1. In "Colleges", find the "College of Computer Studies" card and press its "Invite Department Head" button. (The same button is above the list.)
2. The window "Invite Department Head" says "Make a link for the dean. They fill in their own name, email and password." "College": choose "College of Computer Studies". If you pressed the button on the CCS card the college is already chosen. (In the rehearsal it was chosen by the card.)
3. "Send it to (optional)": type the dean's inbox, for example `yourname+dean@gmail.com`. The hint says the link is shown for you to copy and is emailed to this address only when email is set up. Mail is on, so it goes out.
4. Press "Create link".
5. The window changes to "Link ready", with "Invitation link", "Works once and expires in 48 hours.", "Copy link" and "We also emailed it to <address>." Press "Copy link", then "Done".

### 4b. The dean accepts

Signed in as: nobody. Window B (a separate session). Open the copied link, or the email's link.

1. The page title reads "You're invited to lead College of Computer Studies".
2. "First name": `Ramon`. "Last name": `Castillo`. "School ID" (hint "Your employee number."): `10020001`. "Email": it is already filled with the address the link was made for and cannot be changed ("The invitation was made for this email."). "Password" and "Confirm password": choose one. Press "Create account".

Proof: you are signed in and land on the dean dashboard at `/dashboard/department-head`. The dean sidebar reads Dashboard, Ask AI, Organization applications, Approvals, Organizations, People, College files, Records, Officer transition, College compliance, Clearance signing, Announcements, then a "College view (read only)" group with Finance, Calendar, Election results. The dashboard says "Setting up your college" with the steps Office staff added, Student records loaded, Students allowed to apply, Applications reviewed, Organizations active. Open the account menu (top right): "Ramon Castillo", "College of Computer Studies · Dean", "Profiles", "College of Computer Studies, College profile · Dean, Current". The top bar workspace says "My college". Back in Window A, refresh "Colleges": the CCS card shows the dean.

Watch out: the link works once and lasts 48 hours. If lost, make a new one with "Invite Department Head".

---

## Step 5. The dean adds office staff; the office staff accepts

Status: Worked.

### 5a. The dean makes the link

Signed in as: Dean (Window B).

1. Sidebar "People", then the tab "Office staff". The list shows the dean himself as "Department Head / Dean". Press "Add staff".
2. The panel "Add office staff" says staff get a link that works once and expires in 48 hours. "Email (optional)": your staff inbox. "Position (optional)": `Department Secretary`.
3. Press "Create invite link". The panel shows "Invite link", "We also emailed it to <address>.", a "Copy link" button and "Done". Below, "Waiting for a reply (1)" lists the pending invite with "Copy link" and "Revoke".

### 5b. The office staff accepts

Signed in as: nobody. Window C.

1. Open the link. The title reads "You're invited to College of Computer Studies as office staff" and "Your role: Department Secretary."
2. "First name": `Marites`. "Last name": `Dizon`. "School ID": `10020002`. "Email": type the address. "Password", "Confirm password". Press "Create account".

Proof: Marites lands on `/dashboard/admin`, an office staff home headed "Applications for College of Computer Studies". Her sidebar has only Dashboard, Organization applications, Approvals, Organizations, People, College files, Profile.

Watch out: office staff are faculty or the dean's delegates, never students. They cannot do dean-only actions such as "Allow a student to apply".

---

## Step 6. Organizations: school records, sign up, apply, endorse, approve

Status: Worked. The dean does not create an organization on screen. A student applies, the dean (or office staff) endorses, the SAO approves, and the organization is created active.

### 6a. The SAO loads the school records

Signed in as: SAO (Window A).

1. Sidebar "Governance", then "Student records". The page reads "Student records" with "No records loaded yet."
2. Press "Upload school records" (card header). A drawer opens: "Students are matched against these records when they sign up..." with "CSV file" and "Download a blank file".
3. Choose `student-records-demo.csv`. Press "Check file". The line reads "4 new, 0 to update, 0 left as they are, 0 need fixing."
4. Press the save button ("Save 4 records"). The page shows "Saved: 4 added, 0 updated."
5. Repeat with `ccs-extra.csv`: "4 new", "Saved: 4 added, 0 updated." The table now says "0 of 8 have signed up."

After students sign up, rows show "Signed up" and "Tied to an account, so it cannot be changed here." Unclaimed rows have "Edit" and "Remove". The dean has the same list for CCS only under "People", tab "School records".

Watch out: each row's `college_code` must match an existing college code. Birth dates are used only to check the student at sign up.

### 6b. Students sign up

Signed in as: nobody. Window D. Do this one student at a time (see the rate limit in the preflight).

1. Open `https://13.228.227.182/sign-up`, or press "Log in" then the sign up link under the form.
2. Page title "Create your student account". "School ID": `78978989`. "Birth date": `2005-05-06`. "Email": Juan's inbox. "Password", "Confirm password". Press "Create account".
3. The page "Your account is ready" shows his name, "College of Computer Studies, BSIT, 3rd Year", "School ID 78978989", "Sign in with <email> or your school ID." and "You cannot apply yet. Ask your Department Head to allow you." Press "Open my dashboard".

Repeat for Maria Santos (`78978990`, `2004-11-21`), Carlo (`2005-03-12`), Bea (`2005-09-01`), Luis (`2004-12-09`), Rina (`2006-02-18`).

Proof: the student sidebar reads Dashboard, Ask AI, My payments, Events, Voting, Store, Announcements, Support, Profile.

### 6c. The dean allows a student to apply

Signed in as: Dean (Window B).

1. Sidebar "People", tab "Students". Press "Allow a student to apply".
2. The panel says "They will see Apply for an organization in their menu. One permission covers one application." In "Student" type `Juan` and pick Juan Dela Cruz. Press "Allow to apply".

Proof: a notice reads "Juan Dela Cruz can now apply for an organization."

### 6d. The student applies

Signed in as: Juan (Window D).

1. Sign in with `78978989` and his password. The sidebar now has "Apply for an organization" after "Ask AI".
2. Open it. The page reads "College of Computer Studies. Academic year 2026-2027, semester 1."
3. "Organization name": `CCS Coders Guild`. "Acronym": `CCSCG`. "Your position": leave `President`. "What the organization is for (optional)": `Peer tutoring, hack nights and inter-college coding contests for Computer Studies students.`
4. Under "Requirements" attach the ten PDFs from the table above, one per row. The line "10 files are still missing." counts down.
5. Press "Send application".

Proof: a notice reads "Application sent to your Department Head." The page then shows the application with "With the Department Head" and each requirement "Not reviewed yet".

### 6e. The dean endorses

Signed in as: Dean (Window B). Office staff can do the same from their window.

1. Sidebar "Organization applications". The tab "To review (1)" lists "CCS Coders Guild" with "Review". You can also start from the dean home: when an application waits, the home page says "One application awaiting your endorsement needs you today." and its main button reads "Endorse the application". It opens the same review screen (seen on a second college during the rehearsal). Press "Review".
2. Press "Accept all not checked". Every requirement shows "Accepted".
3. Press "Endorse".

Proof: a notice reads "Endorsed. The SAO is next." The application moves to "With the SAO".

### 6f. The SAO approves

Signed in as: SAO (Window A).

1. Sidebar "Governance", then "Applications". The tab "To review (1)" lists the application. Press "Review". The requirements already show "Accepted"; if not, press "Accept all not checked".
2. Press "Approve".

Proof: the application shows under "Approved (1)". "Governance", "Organizations" shows "CCS Coders Guild" under "Active (1)" with "Sub organization of College of Computer Studies", 1 member and 1 admin.

### 6g. Who becomes the head

Juan now has two workspaces on one login: his student account and the Admin profile on CCS Coders Guild with the position "President". Presidents and Vice Presidents after that come from elections (Step 9). Another head can only be named by the dean on screen.

---

## Step 7. Students into the organization

Status: Worked.

Signed in as: Juan (Window D).

1. Press the top bar workspace button ("Workspace: My account"). The list reads "My account, Student view" and "CCS Coders Guild, Organization Admin · President". Choose "CCS Coders Guild". You land on `/dashboard/admin`, headed "Admin workspace · CCS Coders Guild", with the link "Back to my account". The dashboard says "Setting up your organization" and "Next for you: Officers given access" with the button "Give officers access".
2. The sidebar is grouped: Dashboard, Ask AI, Approvals; Manage (Members, Finance, Events and tasks); Community (Voting, Store, Updates); Oversight (Records); Me (My activity). Open "Members", then "Officer positions". Press "Add position". "Account role": "SBO officer". "Position title": `Treasurer`. Press "Save position". A notice reads "Position created." The list shows President (Admin) and Treasurer (SBO officer).
3. "Members", then "People". The "People and access" card has "Give access". Press it. The panel "Give access" says "Pick a student from the college and what they can do here."
4. For Maria: "Student": type `Maria`, pick her. "Access level": "Officer". "Position": "Treasurer". "What can they open?": all eight modules (Members, Events, Finance, Tasks, Merchandise, Elections, Compliance, Announcements) are ticked by default. Leave them. Press "Give access". A notice reads "Maria Santos now has access."
5. For Carlo, Bea, Luis, Rina: "Access level": "Member". Press "Give access" each time. The table shows them with the access "Member".

Proof: "People and access" lists Juan (President, Organization head, Everything), Maria (Treasurer, Officer, Everything) and four Members. The college dean's "People", tab "Leaders" lists Juan and Maria.

Watch out:

- A student already in this organization does not appear in "Add existing student". Use "Give access" for everyone.
- Programs and sections ("Members", "Programs and sections") were not needed.
- Fixed at 08:14 (release 3197eb6a): a plain Member (Carlo, Bea, Luis, Rina) now sees the club's Shop, announcements, invoices and receipts from their student account. They have no workspace switcher, which is correct: they have one workspace. In the Shop they reserve with "Cash on pickup"; the GCash choice is greyed with "GCash - switch to your <club> profile to pay online", because GCash goes to the selling club's QR.

---

## Step 8. The organization runs

Signed in as: Juan in the CCS Coders Guild workspace (Window D), unless a line says another person.

### 8a. Officers with module access

Worked, covered in Step 7 (Treasurer position, Maria with Officer access).

### 8b. Fee and payment

Status: Worked for the organization side. Not working yet for the student side.

1. Sidebar "Finance", then "Student accounts". The page lists the members as "Cleared". Press "Add student charge".
2. The panel has "Student", "Amount due", "Description", "Due date (optional)". "Student": `Rina`, pick her. "Amount due": `150`. "Description": `Organization fee, 1st semester`. "Due date": `2026-11-30`. Press "Add charge". A notice reads "Student charge added successfully." Rina's row shows "₱150.00 · 1 open", "Pending clearance".
3. Press "View account" on Rina's row. The panel "Student financial account" lists "Open invoices" with the invoice number and "Record payment". Press "Record payment". "Payment amount" starts empty: type `150`. Press "Record payment" again. A notice reads "Payment recorded and the balance was updated." The panel now says "No open invoices." and the total outstanding is ₱0.00.
4. "Finance", then "Ledger" shows "Income ₱150.00" and the line "Payment for INV-... Payer: Rina Aquino".

Student side (fixed at 08:14, checked in a browser): signed in as Rina, "My payments", "Statement of account" lists the invoice and "Receipts" lists the receipt. You can show it. Charging every member at once: the "Add student charge" panel now opens with a switch "One student" / "Every member" (live since release r17c, after this step was rehearsed). Choose "Every member", fill "Amount due", "Description" and "Due date", and the panel shows how many members will be charged and the total before anything is saved; the button reads "Charge N members". Charging the same description again skips members who already have it open, and members who already paid it are skipped unless you tick the box to charge them again.

### 8c. Merchandise, GCash and the claim code

Status: Worked, with the order placed by Maria in her Officer workspace.

1. As Juan: sidebar "Store", then "Orders". Press "Payment settings". The window "GCash payment settings" reads "QR not available". "Official GCash QR image": choose `gcash-qr-demo.png`. Press "Save GCash QR". A notice reads "GCash QR code updated. Students can now use it at merchandise checkout."
2. Sidebar "Store", then "Inventory". Press "Add your first item" (later the button reads "Add product"). "Item name": `CCS Coders Guild Shirt`. "Category": "Apparel". "Unit price (₱)": `350`. "Available to order": `40`. Leave "Selling status" at "Active". Press "Add product". The table shows the shirt at ₱350.00 with 40 in stock.
3. As Maria (Window E): sign in, open the top bar workspace button and choose "CCS Coders Guild" (Officer). Sidebar "Store", then "Shop". The shirt shows with "Add to cart". Press it, then "View cart", then "Review and continue". Quantity changes with the plus and minus buttons. The window "Confirm your reservation" has "Payment method": "Cash on pickup" or "GCash (single order only)". Choose GCash. The window shows "Scan the official HIUSA GCash QR code", "GCash reference" and "Payment proof". Type `4021558870123`, attach any image, press "Place reservation". A notice reads "ORD-1 reserved". "My orders" shows "Waiting for payment check".
4. As Juan: "Store", then "Orders". The order ORD-1 shows with the button "Approve payment". Press it. The window "Approve payment directly" lists the purchaser, items, "Reference 4021558870123" and "Amount verified" (filled with the total). Press "Approve payment".
5. As Maria: "Store", then "My orders". The order says "Paid" with "Show token <16 characters> at the claim desk" and a ticket with "Print ticket". The token in the rehearsal was 16 characters long.
6. As Juan: "Store", then "Claim desk". "16-character claim token": type the token. Press "Claim". The window "Verify purchaser and release" shows the purchaser and items. Press "Confirm release". The register then shows the order as "Claimed".

Watch out:

- The GCash option works only with one item type and after the QR is uploaded. Without a QR, students pay "Cash on pickup".
- A plain Member (for example Rina) now sees the shirt in the Shop and can reserve it with "Cash on pickup" (fixed at 08:14). GCash is for Maria in her Officer workspace, as above.

### 8d. Event, venue booking, dean and SAO approval

Status: Worked.

Setup as the SAO (Window A): sidebar "Reviews", then "Venues". Open the tab "Venue catalog" ("No venues yet"). Press "New venue". "Name": `Audio Visual Room`. "Location": `Main Building, 2nd Floor`. "Capacity": `120`. Press "Add venue". A notice reads "Venue added to the catalog." No venue means an on campus event cannot be saved.

1. As Juan: sidebar "Events and tasks", then "Events". Press "New event" (or "Propose your first event").
2. "Event name": `CCS General Assembly`. "Expected participants (optional)": `80`. "Start date" and "End date": `2026-11-15` (use the demo day). "Start time": `08:00`. "End time": `17:00`. Use a start later on the demo day. A start already in the past was not tried. "Mark Ongoing" worked before the start time.
3. "Venue type": "On campus". "SAO venue": "Audio Visual Room".
4. Attach the three PDFs under "Required letters and documents (on-campus SAO checklist)" (table above). The line "Attach ... to send the proposal." clears.
5. Press "Send proposal". A notice reads "Waiting for Department Head approval ... 3 of 3 files uploaded."
6. As the dean (Window B): sidebar "Approvals", tab "Pending (1)". Press "Review: CCS General Assembly". In "SAO event files" press "Review" on each of the three files and set the mark to "Accepted" (it is a list with "Not checked", "Accepted", "Needs changes"). Press "Close" on each. "Approve" turns on. Press "Approve", then "Approve" again in the window 'Approve "CCS General Assembly"' (it has an optional remarks box). A notice reads "Request approved. Now with the SAO for requirements review".
7. As the SAO: sidebar "Reviews", then "Approvals". The row says "Step 3 of 6: SAO files". Press "Review: CCS General Assembly". Set each of the three files to "Accepted" the same way, press "Approve", confirm "Approve". A notice reads "Request approved ... The organization is preparing this event".
8. As Juan: open the event. It reads "Approved" with "Book venue", "Plan tasks", "Mark Ongoing", "Mark Completed", "Mark Cancelled".
9. Press "Book venue" (opens "Request a venue booking" with the event already chosen). "Venue type": "On campus". "Venue": "Audio Visual Room". "Start": `2026-11-15 08:00`. "End": `2026-11-15 17:00`. "Link to an event": "CCS General Assembly". Press "Send request". The window "Booking request sent" says "SAO will review it. This is your reference, not an approval." with "Venue request #1" and status "Pending".
10. As the SAO: sidebar "Reviews", then "Venues", tab "Booking requests" ("Awaiting decision"). The row shows "Waiting for SAO approval". Press its "Actions for Audio Visual Room booking 1" button, then "Approve". The window "Approve this booking?" shows the venue schedule. Press "Approve". A notice reads 'Booking for "Audio Visual Room" approved.'

Watch out: the dean and the SAO must mark every file "Accepted" before "Approve" turns on. Each mark is saved the moment you pick it, so a reload keeps it (fixed at 08:14).

### 8e. Attendance check-in

Status: Worked (manual). Fingerprint needs a reader and is not in this demo.

1. As Juan: open the event (sidebar "Events and tasks", "Events") and press "Mark Ongoing". A notice reads "Event marked ongoing."
2. Sidebar "Events and tasks", then "Check-in". The page reads "1 event open for check-in". "Member": type `Rina`, pick her. "Attendance status": "Present". Press "Confirm check-in". A notice reads "Check-in recorded."

Proof: the "Attendance log" lists Rina Aquino, "Present", with the time. "Arrivals" counts 1 of 80 expected.

### 8f. Task

Status: Worked.

1. Sidebar "Events and tasks", then "Tasks". Press "New task". Choose "Event-related task".
2. "Task title": `Prepare sign-in sheets`. "Description (optional)": `Print 80 sheets and set up two tables at the entrance.` "Priority (optional)": "High". "Related event": "CCS General Assembly". "Deadline": `2026-11-15`.
3. Press "Review officer recommendation". It lists "Maria Santos · Treasurer · Recommended" with a score (73). "Assign to": choose Maria.
4. Press "Create task". The button spins for a few seconds. The board then shows the task under "Pending 1", assignee Maria Santos, status "Ready".

### 8g. Budget and its approval

Status: Worked.

1. As Juan: sidebar "Finance", then "Budgets". Press "Propose budget". "Title": `CCS General Assembly Budget`. "Allocated amount (₱)": `15000`. "Warning threshold (₱)": `12000`. "Linked event (optional)": "CCS General Assembly". Press "Submit for approval". A notice reads "Budget proposal submitted for approval." The card shows "Pending".
2. As the dean: "Approvals", tab "Pending (1)". Press "Review: ...", then "Approve". A notice reads "Request approved. Approved: the Admin records spending".
3. As Juan: "Finance", then "Ledger". Press "Record transaction". "Description": `Printing of sign-in sheets`. "Amount (₱)": `450`. "Type": "Expense". "Category": "Events". "Date": `2026-11-15`. "Linked budget (optional)": the budget. "Linked event (optional)": the assembly. Press "Save transaction". A notice reads "Transaction recorded successfully."

Proof: "Ledger" shows "Income ₱150.00", "Expenses ₱450.00", "Net balance -₱300.00" and two lines.

### 8h. Announcement

Status: Worked.

1. As Juan: sidebar "Updates", then "Announcements". Press "New announcement".
2. "Title": `General Assembly this Friday`. "Content": `Bring your school ID. Snacks will be served.` "Audience": "All Members". "Category": "Events".
3. Press "Publish now" (right side). A window "Publish announcement" asks "Are you sure you want to publish this announcement now?" Press "Publish now" in it. The page reads "Announcement posted. Sent to All Members."

Proof: Juan's "Announcements" list shows it, and it shows on the dean's home under "Announcements".

A plain Member (Rina) sees it in her "Announcements" feed (fixed at 08:14).

### 8i. Grievance

Status: Worked when addressed to the SAO. "My organization" fixed at 08:14 and checked in a browser.

1. As Rina (Window F): sidebar "Support", then "My grievances". "What's this about?": `Venue was too crowded`. "Tell us what happened": `The assembly room had no space left by 9:30 AM on Friday.` "Who should this go to?": choose "Student Affairs Office". Press "File this grievance". A notice reads "Your grievance was filed."
2. As the SAO: sidebar "Reviews", then "Grievances". The row reads "Facilities & Maintenance · Student Affairs Office, Low, Waiting for SAO to review". Open it. Press "Move to under review" (notice "Grievance updated. The student has been notified."). Press "Resolve". The panel asks for "Remarks": type `Moved the next assembly to a larger room.` Press "Resolve". The status becomes "Resolved".

"My organization" now works too (fixed at 08:14): the grievance is addressed to CCS Coders Guild and shows in Juan's "Records", "Grievances" under "Grievances addressed to your organization". A student in more than one club picks which one under "Which organization?". The dean and office staff still have no grievances screen.

---

## Step 9. Election: setup, vote, results

Status: Worked, in the simple mode where the Admin adds the candidates.

Before you start: members and the officer exist (Step 7). Semester 1 is active. No semester change is pending.

### 9a. Create the election and send it to the dean

Signed in as: Juan in the CCS Coders Guild workspace (Window D).

1. Sidebar "Voting", then "Elections". The page says "Create your first election". Press it (later the button reads "Create election").
2. The form "Create election" starts with the switch "Students file their own candidacy" ON (it adds filing, screening and campaign dates). Press the switch to turn it OFF. It then reads "Off: you add the candidates yourself." and only "Voting starts" and "Voting ends" remain.
3. "Informative letter (PDF)": choose `1_Letter_of_Intent.pdf`. "Election title": `CCS Coders Guild Officers Election 2026`. "Voting room (optional)": `Online ballot`.
4. "Voting starts": today, a few minutes ahead of the time you will vote, for example `2026-11-15 06:50`. "Voting ends": `2026-11-15 22:00`. Both must sit inside the semester dates. A start in the future opens by itself.
5. Under "Ballot positions" the first row is empty. Type `President` in it. Press "Add position" and type `Vice President`. Press "Add position" again and type `Treasurer`. Each has 1 seat.
6. Press "Submit for approval". A notice reads "Election submitted for approval." The list shows the election as "Pending approval", "Next: Awaiting Department Head review".

### 9b. The dean approves

Signed in as: Dean (Window B).

1. Sidebar "Approvals", tab "Pending (1)". Press "Review: CCS Coders Guild Officers Election 2026". The panel lists the positions and the "Informative letter".
2. Press "Approve". There is no second confirmation. A notice reads "Request approved. Approved. Waiting for the ballot to be built".

### 9c. The organization builds the ballot

Signed in as: Juan (Window D).

1. Sidebar "Voting", then "Elections". Click the election. The page shows "Step 2 of 5: Build ballot", the checklist "Before the ballot can be finalized" ("Positions without candidates: 3") and the tabs "1. Overview", "2. Party lists", "3. Candidates", "4. Voters", "5. Results".
2. Open the tab "3. Candidates". Press "Add candidate". In "Student" type the name and pick the student. "Position": choose. "Party list" stays "Independent". Photo and platform are optional. Press "Add candidate".
   - Carlo Mendoza: President. Bea Navarro: President. Luis Garcia: Vice President. Maria Santos: Treasurer.
3. When the checklist reads "Positions without candidates: 0", press "Finalize ballot". There is no confirmation window. A notice reads "Ballot locked: voting opens on Nov 15, 2026" and the page says "Voting opens by itself on Nov 15, 2026 at 6:50 AM."

### 9d. Members vote

Signed in as: each member in its own session (Carlo, Bea, Luis, Maria, Rina).

1. Before the start time the student sidebar "Voting", "Vote" shows "Upcoming" and "Voting opens Nov 15, 6:50 AM. Come back then to cast your ballot." At the start time it flips to "Open" by itself. Nobody presses "Open voting".
2. Press "Vote in this election". The page reads "Choose your candidates, or skip any position you prefer. Check your choices, then submit. A submitted ballot cannot be changed." and "3 positions, 4 candidates". Press "Start my ballot".
3. For each position click one candidate (or none to skip), then press "Next position". After the last position the button is "Review ballot". The screen "Review your ballot" lists the choices with "Change" and "Back to edit".
4. Press "Confirm and submit". The screen reads "Ballot submitted", the time, "Your choices were recorded and cannot be changed." and a "Ballot receipt" code.

The rehearsal votes: Carlo voted Carlo, Luis, Maria. Bea voted Bea, Luis. Luis voted Carlo, Luis, Maria. Maria voted Bea, Luis, Maria. Rina voted Carlo only.

Watch out: a plain member reaches the voting screen even without a workspace switcher.

### 9e. Close and read the results

Signed in as: Juan (Window D).

1. Sidebar "Voting", then "Elections". On the election's row open "Actions for CCS Coders Guild Officers Election 2026". The menu has "View informative letter", "Edit", "Close". Press "Close". The window "Close election" says "Closing ends voting and cannot be undone. Voters can no longer submit ballots. Winners become upcoming officers; their access starts on the officer start date and the outgoing officers keep access until the school year ends." Press "Close election". A notice reads "Election closed."
2. Sidebar "Voting", then "Results". Click the election. The page says "Completed", "Results released", "Ballots 5", "Votes cast 12" and "Winners: Final winners by position":
   - President: Carlo Mendoza, 3 votes (Bea Navarro 2, 60 percent to 40 percent).
   - Vice President: Luis Garcia, 4 votes, "Elected unopposed".
   - Treasurer: Maria Santos, 3 votes.
   Under each: "Upcoming officer, access starts Nov 30, 2026".
3. Students see the same under "Voting", then "Results" (the list shows the election as "Closed" with 5 ballots).

Winners become Admin (President and Vice President) or Officer (other seats). Their access starts on the term start date, Nov 30, 2026 here, so the new profiles read "Upcoming" today. Do not edit semester or compliance dates to force an earlier start. Say: "On that date the profile switches on by itself."

Watch out:

- The election is refused if its dates fall outside the active semester.
- Closing cannot be undone. Do not close it before every demo vote is cast.

---

## Step 10. Profile switching: one student, two workspaces

Status: Worked (release r17d wording).

Use Maria Santos, a student who is also the Treasurer officer of CCS Coders Guild. Juan, a student who is also the organization head, shows the same with an Admin workspace.

Signed in as: Maria (Window E).

1. Sign in with `78978990`. If she last worked in the organization she lands there. The browser tab reads "HIUSA · Officer · CCSCG" and the top bar reads "CCS Coders Guild". The sidebar is the officer's: Dashboard, Ask AI, Manage (Events and tasks, Finance (view only), Members and fingerprints), Community (Voting, Store, Updates), Oversight (Clearance signing, Records, Officer transition), Me (My activity).
2. Open the account menu (round button at the far right, "Account menu for Maria Santos"). It lists "Maria Santos", her email, "CCS Coders Guild · Officer", then "Profiles", "Switch profile", "College of Computer Studies, College profile · Student" and "CCS Coders Guild, Organization profile · Officer", with "Current" on the active one.
3. Press "College profile · Student". The page reloads at `/dashboard/student`. The tab reads "HIUSA · Student · CCS". The top bar reads "My account". The sidebar is the student's: Dashboard, Ask AI, My payments, Events, Voting, Store, Announcements, Support, Profile.
4. Press the top bar workspace button ("Workspace: My account"). The list reads "My account, Student view", "Organizations you work in", "CCS Coders Guild, Officer · Treasurer". Choose "CCS Coders Guild" to return.
5. Say: "Same person, same login. The student side shows what she owes and the shop. The officer side shows what she runs. The sidebar changes with the workspace."

Screenshots: `shots/10-maria-student-workspace.png`, `shots/10-maria-officer-workspace.png`, `shots/10-maria-switcher-open.png`, `shots/10-maria-account-menu.png`, `shots/10-juan-student-workspace.png`, `shots/10-juan-org-workspace.png`.

Watch out: the switcher appears only when the person has more than one place to work. A plain Member has none.

---

## Step 11. Ask AI

Status: Worked.

Signed in as: SAO.

1. Sidebar "Ask AI". The page greets "Hi, <first name>", shows "Showing records for University-wide student organizations.", "Today's SAO Action Plan" and starter buttons: "What's on my desk today", "Applications to approve", "Who is behind on requirements", "Files waiting for review", "Urgent student concerns", "Invite a dean".
2. Type in the box "Ask about your records or what to do next": `How do I invite a Department Head?` Press "Send". After a few seconds the answer lists four steps: Governance, Colleges, "Invite Department Head", create the link, copy it, send it, and says it works once and expires in 48 hours. It shows "Steps 4, Pages involved 1, Estimated time 2 minutes, Your access Allowed" and a "Go to page" link. This is the question that answers best.
3. Second question: `What should I do today across student organizations?` It answered "Nothing is waiting for the SAO right now" in the rehearsal, because nothing was pending at that moment. Ask it while an application or booking is waiting to show the list.

Watch out: the AI only reads what that account can already open. It never approves anything. Office staff have no Ask AI item.

---

## If something goes wrong

- A link expired or was used: make a new one. A link lasts 48 hours and works once.
- "Allow a student to apply" finds nobody: the student has not signed up yet (Step 6b).
- Sign up says "Too many requests": wait the seconds it names.
- Sign up cannot match: check the school ID and birth date in the CSV.
- An approve button is greyed: read the line next to it. For events, every file must be marked "Accepted" first.
- A semester change is refused: an election that is upcoming or open is the usual cause.
- A page fails during a release: wait a minute and reload.


## Rehearsal screenshots

All in `D:/Claude/scratch/hiusa-1115/rehearsal/shots/`, named by step: `01b-*` SAO staff, `02*` school year, `03*` colleges, `04*` dean, `05*` office staff, `06*` application, `07*` records and members, `08*` the organization runs, `09*` election, `10*` profile switching, `11*` Ask AI, `12*` phone width (390). `r17d-*` are the r17d screens.
