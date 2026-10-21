# HIUSA Standard Operating Procedures (SOP) and User Journeys Manual

This document is the operational standard for the HIUSA school organization management platform. It provides clear, actionable standard operating procedures for student organization governance, followed by clean, click-counted user journeys for every role.

---

## 1. Governance Architecture and Role Hierarchy

HIUSA operates on a multi-tiered hierarchy reflecting institutional student affairs policy:

1. **Student Affairs Office (SAO / Super Admin)**
   - Highest university authority.
   - Manages colleges, academic calendar, semesters, university-wide compliance rules, venues, university announcements, and institutional clearances.
   - Approves organization registrations, evaluates compliance, and provisions initial organization administrators.

2. **College Department Heads**
   - Academic leadership oversight for each college.
   - Registers new student organizations under their college.
   - First-stage approver for all event proposals, budget requests, and election plans submitted by their student organizations.

3. **Organization Administrators (Presidents and Lead Admins)**
   - Operational leaders of an approved student organization.
   - Proposes events, drafts budgets, manages officer rosters, enrolls student members, builds election ballots, and prepares semestral financial reports.

4. **SBO Officers (Vice Presidents, Treasurers, Secretaries, Committee Chairs)**
   - Operational executives within the organization.
   - Operates event attendance check-in, verifies merchandise payments, releases merchandise orders at the claim desk, manages assigned tasks, and drafts announcements.

5. **Students**
   - Active student body and organization members.
   - Registers for approved events, casts election ballots, places merchandise orders, inspects personal statements of account, downloads payment receipts, checks clearance status, and files grievances.

---

## 2. Standard Operating Procedures by Lifecycle

### SOP 1: Organization Registration and Annual Accreditation

**Objective:** Onboard new student organizations and renew active accreditation under institutional standards.

**Frequency:** Every academic year upon the opening of the 1st Semester.

#### Step 1: Semester Activation (SAO)
1. The SAO signs in to the portal and navigates to **Setup and records > Academic years**.
2. If no active semester exists, the SAO selects **Add semester**, selects the academic year and term (1st Semester), sets valid start and end dates, and chooses **Set as active**.
3. *Policy Rule:* Until a semester is active, the registration requirements catalog is locked, and no organization registration can proceed.

#### Step 2: Submission of Registration Packet (Department Head)
1. The Department Head navigates to **Organizations > Register an organization**.
2. The Department Head fills in the organization name, abbreviation, classification, and contact information.
3. The Department Head uploads the ten required accreditation documents:
   - Constitution and By-Laws
   - Endorsement Letter from College Dean
   - Roster of Elected Officers
   - Faculty Adviser Acceptance Letter
   - Annual Calendar of Activities
   - Proposed Annual Operating Budget
   - Directory of Student Members
   - Anti-Hazing Undertaking Compliance
   - Drug-Free Campus Statement
   - Previous Year Accomplishment and Financial Report (renewal) or Feasibility Study (new organization)
4. The Department Head reviews all attachments and clicks **Submit for SAO Review**.
5. *Status Transition:* Status becomes `pending_review: waiting for SAO review`.

#### Step 3: Accreditation Evaluation (SAO)
1. The SAO receives the submission under **Reviews > Compliance** (Review Queue tab) or **Organizations > Registrations and organizations**.
2. The SAO opens the organization detail panel and inspects each uploaded PDF document.
3. The SAO makes one of two decisions:
   - **Return:** The SAO enters specific feedback remarks. Status updates to `returned`. The Department Head receives a notification to replace deficient documents and resubmit.
   - **Approve:** The SAO approves the registration. Status updates to `active`.

#### Step 4: Initial Administrator Provisioning (SAO)
1. Immediately following approval, the SAO opens **Organizations > Administrators**.
2. The SAO selects **Create Admin User**, selects the newly activated organization, enters the student leader school ID, full name, institutional email, and temporary password.
3. The system flags the account with forced password change on first sign-in.
4. The organization administrator signs in, sets a new private password, and accesses the organization dashboard.

---

### SOP 2: Event Proposals, Clearances, Venue Booking, and Reporting

**Objective:** Ensure all extracurricular and curricular activities are properly vetted, budgeted, venue-booked, attended, and liquidated.

#### Step 1: Event Proposal Submission (Organization Admin)
1. The Admin opens **Events and tasks > Events** and selects **Create Event**.
2. The Admin specifies title, event type, on-campus or off-campus classification, target participants, venue type, start date, end date, and objectives.
3. If funding is needed, the Admin specifies the proposed budget amount.
4. *Status Transition:* Status becomes `planning`, approval status becomes `awaiting_department_head`.

#### Step 2: Department Head Endorsement (Department Head)
1. The Department Head receives the proposal under **Approvals**.
2. The Department Head reviews the dates, objectives, and academic calendar alignment.
3. The Department Head approves the request with optional remarks.
4. *Branching Logic:*
   - If the event is on-campus and requires no institutional SAO documentation, the event status advances directly to `approved`.
   - If the event is off-campus or requires institutional clearance, the event status advances to `awaiting_requirements`.

#### Step 3: SAO Clearance Upload and Review (Admin and SAO)
1. If requirements apply, the Admin opens the event record under **Events and tasks > Events** and uploads the required institutional documents (e.g., Parent Waivers, Chaperone Roster, Travel Insurance, Campus Security Permit).
2. The Admin submits the files. Approval status advances to `awaiting_sao`.
3. The SAO reviews the files under **Reviews > Compliance** (Event Requirements tab).
4. Upon SAO approval, the event status advances to `approved`.

#### Step 4: Venue Booking (Admin or SBO Officer)
1. The Admin or Officer opens **Events and tasks > Venue booking**.
2. The user selects an institutional venue (e.g., Audio-Visual Hall, Gymnasium, Amphitheater), selects dates and time slots, and links the booking to the approved event ID.
3. Conflict validation automatically blocks double-bookings.
4. The SAO reviews the venue request under **Reviews > Venues** and confirms booking.

#### Step 5: Event Execution and Attendance Check-In (SBO Officer)
1. On the day of the event, the SBO Officer opens **Events and tasks > Check-in**.
2. The Officer selects the active event.
3. When attendees arrive, the Officer checks them in using either:
   - School ID entry (manual check-in).
   - Biometric fingerprint scanner verification.
4. The live attendance count increments in real time.

#### Step 6: Post-Activity Report and Liquidation (Organization Admin)
1. Within three working days following event completion, the Admin navigates to **Finance > Financial reports**.
2. The Admin selects **Generate Report**, sets type to Event Report, selects the completed event, and attaches attendance summaries, receipts, and narrative documentation.
3. The Admin submits the report for Department Head and SAO review.

---

### SOP 3: Budget Allocation, Financial Ledger, and Collections

**Objective:** Safeguard student organization funds, enforce spending limits, and maintain an immutable financial ledger.

#### Step 1: Budget Proposal (Organization Admin)
1. The Admin opens **Finance > Budgets** and selects **Propose Budget**.
2. The Admin selects category (Operations, Activity, Merchandise, Equipment), enters itemized lines, and sets proposed total amount.
3. The Admin submits the proposal. Status becomes `pending_department_head`.

#### Step 2: Department Head Approval (Department Head)
1. The Department Head opens **Approvals**.
2. The Department Head verifies budget feasibility against student fees and organization funds.
3. The Department Head approves the budget. Status becomes `approved`.
4. *Policy Rule:* Transactions can only be logged against budgets with `submission_status = approved`.

#### Step 3: Recording Expenses and Transactions (Organization Admin)
1. The Admin opens **Finance > Ledger** and selects **Record Transaction**.
2. The Admin selects transaction type (`expense`), enters amount, date, description, selects the approved budget line, and uploads the supporting official receipt.
3. The transaction is permanently posted to the organization digital ledger.
4. Automated controls prevent total expenses from exceeding approved budget allocations.

#### Step 4: Student Fee Collections (Organization Admin and SBO Officer)
1. When fees (e.g., membership fees, event registration) are assessed, the Admin creates a collection batch under **Finance > Collections and advances**.
2. Student balances automatically reflect the assessment in their **Statement of Account**.
3. When payments are remitted, the Officer records the payment. The student receives a verifiable digital receipt under **My receipts**.

---

### SOP 4: Student Elections, Ballot Finalization, and Voting

**Objective:** Execute transparent, tamper-proof student body and council elections.

#### Step 1: Election Scheduling and Approval (Admin and Department Head)
1. The Admin opens **Voting > Elections** and clicks **New Election**.
2. The Admin sets election title, description, school year, start date and time, and end date and time.
3. The proposal routes to the Department Head under **Approvals**.
4. The Department Head reviews and approves. Status updates to `upcoming`.

#### Step 2: Ballot Configuration (Organization Admin)
1. The Admin opens the election hub under **Voting > Elections**.
2. Under the **Party Lists** tab, the Admin creates all competing political parties.
3. Under the **Candidates** tab, the Admin adds certified candidates for every open position (President, Vice President, Secretary, Treasurer, Representatives), linking each candidate to their respective party list.
4. *Policy Rule:* Every position must have at least one candidate, and at least one party list must exist before a ballot can be locked.

#### Step 3: Ballot Finalization (Organization Admin)
1. The Admin reviews the candidate list and clicks **Finalize Ballot**.
2. The system locks the ballot structure against further modifications and creates the voter eligibility roster from active student members.
3. Status advances to `ballot finalized`.

#### Step 4: Voting Period (Students)
1. When the start time arrives, the background scheduler automatically activates the election (status `active`).
2. Eligible students sign in and open **Voting > Vote**.
3. The student selects one candidate per position (or skips optional slots) and submits their ballot.
4. The system cryptographically logs the vote, generates a unique voting receipt for the student, and flags the student voter record as `has_voted`.
5. Duplicate voting attempts are automatically rejected with a clear notification.

#### Step 5: Tallying and Results Release (Admin and SAO)
1. When the end time expires, the scheduler closes voting (status `closed`).
2. The Admin and Department Head verify vote totals under **Voting > Results**.
3. The Admin clicks **Release Results**.
4. Tabulated results immediately become visible to all students, officers, and faculty.

---

### SOP 5: Merchandise Inventory, Orders, and Claiming

**Objective:** Handle merchandise sales, sizing, payment verification, and order release.

#### Step 1: Inventory Setup (Organization Admin)
1. The Admin opens **Store > Inventory** and clicks **Add Item**.
2. The Admin enters product name, unit price, stock quantity, available sizes, description, and product image.
3. The Admin uploads the organization GCash QR code under Store settings to enable digital payments.

#### Step 2: Order Placement (Student)
1. The Student opens **Store > Shop**.
2. The Student selects an item, chooses size and quantity, and clicks **Place Order**.
3. The system creates the order in `pending` status.
4. The Student chooses payment method: Cash on Claim or GCash.
5. If GCash is chosen, the Student transfers funds via the displayed QR code and uploads the payment reference screenshot under **Store > My orders**.

#### Step 3: Payment Verification (SBO Officer)
1. The Officer opens **Store > Orders**.
2. The Officer reviews the order, inspects the payment proof image, verifies the transaction reference, and clicks **Verify Payment**.
3. Order status updates to `paid`.
4. The system generates an 8-character alphanumeric claim token displayed in the student order view.

#### Step 4: Claim Desk Fulfillment (SBO Officer and Student)
1. The Student presents their claim token at the organization distribution desk.
2. The Officer opens **Store > Claim desk**.
3. The Officer enters the claim token. The system displays order details and confirms payment status.
4. The Officer issues the physical item and clicks **Release Item**.
5. Order status updates to `claimed`, stock is permanently decremented, and the transaction is closed.

---

### SOP 6: Student Clearances and Grievance Handling

**Objective:** Manage semestral clearance sign-offs and provide a confidential avenue for student concerns.

#### Clearance Protocol
1. At the end of each semester, the SAO initiates the clearance period under **Reviews > Clearances**.
2. Organization Officers review member compliance (settled balances, returned loaned equipment, completed committee duties) under **Clearance signing**.
3. Officers mark eligible members as Cleared.
4. Students check their clearance status under **Support > My clearance**.
5. Outstanding financial balances automatically show with an itemized breakdown.

#### Grievance Resolution Protocol
1. A Student files an issue under **Support > My grievances** by selecting category (Academic, Conduct, Financial, Harassment, Facility), target office (Organization Admin or SAO), subject, and statement.
2. The designated reviewer (Admin or SAO) receives the ticket under their respective **Grievances** review panel.
3. The reviewer investigates, logs internal inquiry notes, and updates ticket status:
   - `Under Investigation`
   - `Action Taken`
   - `Resolved`
4. The student views resolution remarks and updates in real time.

---

## 3. Clean User Journeys per Role

Every journey below is measured from the user home screen. Each has a strict click budget and an expected visible end state.

### Role 1: Student Affairs Office (SAO)

| Journey ID | Goal | Path & Clicks | Expected End State |
|---|---|---|---|
| **SAO-J1** | Approve an organization registration and provision an administrator | 1. Click **Organizations**.<br>2. Select organization in review queue.<br>3. Inspect documents and click **Approve**.<br>4. Click **Create Administrator**.<br>5. Fill admin details and submit. (5 clicks) | Organization status reads **Active** and organization administrator is listed in directory. |
| **SAO-J2** | Review and decide compliance submission | 1. Click **Reviews**.<br>2. Select **Compliance**.<br>3. Open submission and click **Approve** or **Return**. (3 clicks) | Submission badge updates to **Approved** or **Returned with Remarks**. |
| **SAO-J3** | Decide a submitted financial report | 1. Click **Reviews**.<br>2. Select **Compliance**.<br>3. Select **Financial reports** tab and approve report. (3 clicks) | Report status displays **Approved** and logs into university audit trail. |
| **SAO-J4** | Inspect agency overview and identify organizations needing attention | 1. Click **Organizations**.<br>2. Select **Colleges** (or Agency overview). (2 clicks) | Cards display colleges ordered by pending workload, highlighting required actions first. |
| **SAO-J5** | Answer and resolve student grievance | 1. Click **Reviews**.<br>2. Select **Grievances**.<br>3. Open ticket.<br>4. Enter resolution notes and mark **Resolved**. (4 clicks) | Ticket badge updates to **Resolved** and notification dispatches to student. |

---

### Role 2: College Department Head

| Journey ID | Goal | Path & Clicks | Expected End State |
|---|---|---|---|
| **DH-J1** | Register a new student organization | 1. Click **Organizations**.<br>2. Click **Register an organization**.<br>3. Attach documents and submit. (3 clicks) | Row displays **Pending Review** with description "Waiting for SAO review". |
| **DH-J2** | Approve an event or budget proposal | 1. Click **Approvals**.<br>2. Click proposal item.<br>3. Enter remarks.<br>4. Click **Approve**. (4 clicks) | Item status updates to **Approved** and routes to next approval stage. |
| **DH-J3** | Follow up and resubmit a returned registration | 1. Click **Organizations**.<br>2. Click **Returned** tab.<br>3. Select organization, update deficient files, and resubmit. (3 clicks) | Row status returns to **Waiting for SAO review**. |
| **DH-J4** | Act immediately from a system notification | 1. Click **Notifications bell** in TopBar.<br>2. Click notification item. (2 clicks) | Browser navigates directly to the exact approval or organization record. |

---

### Role 3: Organization Administrator

| Journey ID | Goal | Path & Clicks | Expected End State |
|---|---|---|---|
| **ADM-J1** | Propose a new student activity or event | 1. Click **Events and tasks**.<br>2. Select **Events**.<br>3. Click **Create Event**.<br>4. Enter details and submit. (4 clicks) | Event details drawer displays lifecycle stepper at **Waiting for Department Head**. |
| **ADM-J2** | Fund an event by proposing a budget | 1. From approved event, click **Manage Budgets**.<br>2. Click **Propose Budget**.<br>3. Fill lines and submit. (3 clicks) | Budget line displays status **Waiting for Department Head approval**. |
| **ADM-J3** | Track all submitted approval requests | 1. Click **Approvals**.<br>2. Select **Submitted by me** tab. (2 clicks) | Table lists all pending proposals with matching stages and reviewer assignment. |
| **ADM-J4** | Conduct attendance and prepare event report | 1. Click **Events and tasks > Check-in**.<br>2. From finished event, click **Generate Event Report**.<br>3. Review and submit draft. (3 clicks) | Financial report displays as **Submitted: Waiting for Department Head approval**. |
| **ADM-J5** | Complete initial organization setup | 1. Follow **Getting started** guide.<br>2. Add positions.<br>3. Enroll members. (3 clicks per setup step) | Setup checklist displays 100 percent complete with active member roster. |

---

### Role 4: SBO Officer

| Journey ID | Goal | Path & Clicks | Expected End State |
|---|---|---|---|
| **OFF-J1** | Check in an attendee at an event | 1. Click **Events and tasks**.<br>2. Select **Check-in**.<br>3. Select event.<br>4. Enter school ID and confirm. (4 clicks) | Attendee displays as checked in and verified counter increments. |
| **OFF-J2** | Verify payment and release order | 1. Click **Store > Orders**.<br>2. Click order and verify proof.<br>3. Open **Store > Claim desk**.<br>4. Enter token and release. (4 clicks) | Order badge updates to **Claimed** with recorded timestamp. |
| **OFF-J3** | Update assigned task progress | 1. Click **Events and tasks**.<br>2. Select **My tasks**.<br>3. Move card to **Completed**. (3 clicks) | Task board updates progress bar to 100 percent. |
| **OFF-J4** | Draft an announcement for admin review | 1. Click **Updates**.<br>2. Select **Announcements**.<br>3. Click **New Announcement**.<br>4. Submit. (4 clicks) | Row displays badge **Waiting for Admin approval**. |

---

### Role 5: Student

| Journey ID | Goal | Path & Clicks | Expected End State |
|---|---|---|---|
| **STU-J1** | Register for an upcoming campus event | 1. Click **Events**.<br>2. Select event card.<br>3. Click **Register**. (3 clicks) | Button changes to **You are registered** with ticket confirmation badge. |
| **STU-J2** | Cast ballot in active council election | 1. Click **Voting** in sidebar.<br>2. Select candidates and submit vote. (2 clicks) | Screen displays unique vote confirmation receipt and election badge shows **Voted**. |
| **STU-J3** | Order merchandise and obtain claim token | 1. Click **Store > Shop**.<br>2. Pick item and size.<br>3. Click **Add to Cart**.<br>4. Proceed to Checkout.<br>5. Confirm. (5 clicks) | Order appears in **My orders** with next action instructions and QR payment guide. |
| **STU-J4** | Review financial balance and payments | 1. Click **My payments**.<br>2. Select **Statement of account**. (2 clicks) | Account overview immediately displays current balance, fee breakdown, and receipts without scrolling. |
| **STU-J5** | File a grievance and check clearance status | 1. Click **Support**.<br>2. Select **My grievances** or **My clearance**.<br>3. Submit ticket or inspect clearance signatories. (3 clicks) | Grievance ticket reflects **Waiting for Review**; clearance signatories display live sign-off badges. |

---

## 4. Verification and Safe Test Execution

When rehearsing and validating these journeys, team members must use the safe throwaway LAN server:

1. Launch the server from an Administrator PowerShell prompt:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Reset
   ```
2. The script configures a private throwaway MariaDB instance on port 3317 (never touching port 3306 or development databases), seeds fresh test data, starts the API, Vite frontend, and background scheduler.
3. Connect from a secondary device (laptop or phone on the same Wi-Fi subnet) using the printed LAN address (e.g., `http://192.168.1.x:5173`).
4. Execute journeys using the fresh seed accounts specified in [MEMBER_TESTING.md](file:///c:/BSIT/React/Hiusa-FULL/docs/MEMBER_TESTING.md).
5. Stop the test environment cleanly when complete:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\serve-lan.ps1 -Stop
   ```
