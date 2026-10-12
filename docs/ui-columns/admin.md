# HIUSA Admin screens: table columns

Role: Organization Admin and Adviser (same menu). Source: client/src (navigation.js, App.jsx, page components). Text in quotes is exact UI text.

## Shared rules (apply to every page unless the page says otherwise)
Tones: green = success, amber = warning, red = danger, blue = info, grey = neutral. Badge map: pending, pending approval, pending payment, partially repaid, late = amber; under review, submitted, resubmitted, payment submitted, upcoming, ongoing, in progress, open, excused = blue; approved, accepted, verified, released, fully repaid, cleared, paid, claimed, completed, present, active, published, income, live voting = green; rejected, returned, owing, cancelled, overdue, absent, disabled, expense = red; draft, closed, planning, unclaimed, inactive, unpublished, archived = grey.
Shared table (DataTable): sticky uppercase header, final right-aligned "Actions" column; below 768 px it becomes cards with one "LABEL : value" row per column and the actions at the bottom. Custom tables state their own breakpoint.
Pagination bar: "Showing a-b of n", previous and next buttons, page numbers.
Row kebab menu: icon button that opens a menu of the listed actions, destructive item in red.
Filter bar: search box, filter selects, "Clear", result count ("<n> records").
Money is shown with the peso sign and two decimals; dates in en-PH.

## Dashboard (/dashboard/admin)
No table: greeting briefing (Needs attention list, setup checklist, collapsible "Organization indicators", "What HIUSA noticed" insights).
Tiles: Pending Orders | Approval Requests | Pending Tasks | New Announcements
Filters: Financial status Period select (3 months | 6 months | 12 months)
Chart "Financial status": monthly Income (green) vs Expenses (red) bars; sr-only table Month | Income | Expenses
Cards "Administration workspace": People | Officer positions | Programs and sections | Audit log
Cards "Announcements" (latest posts: org name, author, date, title, body, image) buttons: New announcement | Manage announcements | View Feed
Empty: "No ledger transactions in this period." / "No published announcements yet." / first run "Nothing has happened here yet" + "Plan your first event"

## Approvals (/dashboard/approvals)
Tabs: To review (n) | Submitted by me
Filters: status buttons (To review: Pending (n) | All History; Submitted by me: All | Waiting | Approved | Rejected); search "Search requester, ID, remarks..."; Request type select (All request types | Event | Budget | Election | Announcement | Payment | Financial Report); Requested from (date); Requested to (date); Sort order (Newest first | Oldest first)
Table "Requests to review" / "Requests submitted by my organization": cards (list rows, no headers): title + type chip + organization chip + status badge | summary line | "Requested by <name> (<school id>) | <date time>" | requester role, position, program, year, section | stage stepper + "Waiting on <who>" | Remarks
Row actions: Review (or Details when not actionable); Open event | Open budget | Open election | Open report
Status badges: Pending = amber, Approved = green, Rejected = red, Returned = red, Under review/Submitted = blue; stage chip tone varies
Bulk/Toolbar: New request, Reset, Export CSV (columns: Request ID, Organization, Type, Title, Status, Requester ID, Requester, Role, Position, Department, Program, Year Level, Section, Requested At, Reviewer, Reviewed At, Remarks); line "<n> matching requests · <n> awaiting action"
Paging: 20   Empty: "Nothing to review" / "No approval history yet" / "No requests match these filters" / "Nothing submitted yet" (+ "Start a new request")
Mobile: list stacks, filter grid collapses to 1 to 2 columns
  Drawer "Approval request": receipt, History list, Required signatories, Supporting documents, SAO event files; buttons Reject | Approve | Open link
  Dialog "Approve/Reject <title>": Remarks (optional; required on reject, placeholder "e.g. Budget not yet finalized."), Cancel | Approve | Reject

## Approvals > New request (/dashboard/approval-requests/new)
No table: 4 choice cards: Announcement | Budget proposal | Event proposal | Election (title, description, approver line); sub-routes /new/announcement, /new/budget, /new/event, /new/election open the create forms.

## Members > People (/dashboard/admin/users)
Tiles: Total users | Students | Admins | Super admins
Charts: "Filtered user distribution" donut (Students | SBO officers | Admins | Department heads | Super admins; center "matching users"); section distribution chart
Filters: search "Search name, school ID, program, or email"; role (All roles | Student | SBO Officer | Admin | Department Head); "Filter by program" (All programs | <programs>); "Filter by year level" (All year levels | 1st Year ...); "Filter by section" (All sections | <sections>); "Filter by account status" (All account statuses | Active | Inactive | Disabled); "Sort users" (Name A-Z | School ID | Program / Year / Section | Newest accounts); Clear; "<n> users"
Table "Users": School ID | Name | Role | Program / Major | Year Level | Section | Status | Actions
Row actions (kebab menu "User actions"): Edit user | View profile | Add to organization | Manage profiles | Enroll fingerprint / Re-enroll fingerprint | Verify identity (1:N) | Deactivate account | Reactivate account | Delete profile
Status badges: Status cell is an icon: check = Active (green), x = Inactive (red); fingerprint icon (blue) = Fingerprint enrolled. Role = blue-grey pill.
Bulk/Toolbar: Export | Import | Add existing user | New User
Paging: 10   Empty: "No users found." / "No users on this page."
Mobile: cards (name, school ID, kebab, role pill, Active/Inactive pill, "Fingerprint enrolled" pill, Program / Major, Year level, Section)
  Drawer "Import members" (CSV; required columns school_id, first_name, last_name, email, role): Download template | CSV file | Check file -> "All <n> rows are ready to import." or "<n> of <n> rows need fixing." list "Row <n>: <name>" + error bullets | Cancel | Import <n> members
  Modal "User Profile": identity card; fields Email | Contact number | Role | Account status | Department | Course / Program | Year level | Major / Specialization | Section | Organization position; for students "Live Student Debt Summary": Invoice balance | Reserved merchandise | Total outstanding; lists "Unsettled invoices" (reference, description, balance) and "Reserved merchandise awaiting payment" (Order ORD-<id>, item, price); badge Financially cleared (green) / Pending clearance (amber)
  Modal "New User"/"Edit User" fields: School ID | Email | First Name | Last Name | Contact Number | Profile photo (optional) | Role | Organization Position | Course / Program | Year Level | Major / Specialization | Section | Password | Confirm Password
  Modal "Add existing user": Destination organization, Search existing users ("Name, school ID, or email"), radio list of users, Role (Student | SBO Officer | Department Head); Empty "No eligible users found in this college."
  Modal "Manage user profiles": cards "<name> · <school id>" / "<org> · <role> · <status>" / "Primary profile|Additional profile · <n> total profiles"; Empty "No profiles found in the organizations you manage."
  Modal "Enroll Fingerprint" / "Verify Fingerprint Identity": scanner status, 4-scan progress, consent checkbox; buttons Start 4-Scan Enrollment | Remove | Scan once to verify

## Members > Officer positions (/dashboard/admin/positions)
Filters: search "Search title or responsibilities..."; role select (All account roles | Admin | SBO Officer)
Table "Positions": Position | Account Role | Responsibilities | Status | Actions
Row actions: Edit position | Delete position (Adviser positions show "SAO managed")
Status badges: Active = green, Inactive = grey
Bulk/Toolbar: Add Position
Paging: 10   Empty: "No positions match the current filters."
Mobile: table scrolls horizontally (min width 760)
  Modal "Add Position"/"Edit Position": Assignable account role * (Admin | SBO Officer), Position title * (Choose a title | Adviser (SAO only) | Other position...), Responsibilities, Available for assignment checkbox

## Members > Programs and sections (/dashboard/admin/programs-sections)
No table: three blocks.
  Form "Add a program": Department (read only) | Course / Program | Years in this program | block section count per year | Add Program
  Panel "Import class list" (CSV columns school_id, program, year_level, section; new students also first_name, last_name, email): Download CSV template | Choose class list | Preview | Confirm and apply <n> rows
    Table "Import preview": Line | School ID | Student | Program | Year | Section | Result; chips New account | Update | Unchanged | Invalid | Duplicate (counts; Invalid and Duplicate red, New and Update blue, Unchanged grey); "Temporary passwords" box with download CSV (school_id, name, temporary_password)
  Cards "Configured programs": per program: name, "<n>-year program", Edit / Delete icons, then per year tile "1st Year ..." with section names; Empty "No programs have been configured yet."
  Dialogs: Edit academic program; "Delete program?"

## Finance > Budgets (/dashboard/finance/budget-allocation)
Tiles: Ledger net balance (single strip)
Table "Budgets": cards (no headers): title + approval badge | stepper (compact) | linked event | "Semester: <name>" | Allocated | Remaining | Warning at | "<low|medium|high> overspending risk" | "AI recommended allocation <amt> · Safe spending ceiling <amt>" | advisory note | AI advice panel (engine badge, allocation status chip, Reserve, Expense/income ratio, "How this was calculated")
Row actions: View details | AI Advice | Delete budget (hidden once approved)
Status badges: pending = amber, approved = green, rejected = red; allocation status: Within limit = green, Reduced allocation = amber, No funds available = red; risk text high = red, medium = amber, low = green
Bulk/Toolbar: Propose budget
Paging: none   Empty: "No budgets yet"
Mobile: cards stack
  Drawer "<budget title>": stepper, next step, Allocated | Remaining | Warning at
  Modal "Propose budget" / "Edit budget": Title * ("e.g. Sports Fest 2026 Budget") | Allocated Amount (PHP) * | Warning Threshold (PHP) * | Linked Event (optional) (No linked event) | Financial semester (optional) (No semester) | Cancel | Submit for Approval / Resubmit for Approval

## Finance > Ledger (/dashboard/finance/financial-ledger)
Tiles: Income | Expenses | Net balance | Ledger entries
Filters: search "Search transactions..."; "Filter by academic semester" (All semesters | AY <label> · 1st|2nd Semester (active|closed)); "Filter by transaction type" (All types | Income | Expense); "Filter by event" (All events | <events>); Filter from date; Filter to date; Apply; Clear; "<n> transactions"
Table "Ledger": Date | Description | Source | Payer / Recorder | Category | Type | Amount | (Actions)
Row actions: Edit transaction | Delete transaction (locked rows show a lock note instead; entries from collections, cash advances, invoices, orders are locked)
Status badges: Type Income = green, Expense = grey; Amount +green for income
Bulk/Toolbar: Record transaction
Paging: 10 ("Showing a-b of n", prev/next)   Empty: "No transactions recorded yet" / "No matching transactions"
Mobile: list cards (description, date, category, +/- amount, sources, receipt, Payer, Recorded by, Edit transaction, Delete transaction); at 768 to 1023 px Source and Payer/Recorder columns fold into the Description cell
  Modal "Record Transaction"/"Edit Transaction": Description * ("e.g. Event supplies purchase") | Amount (PHP) * | Type * (Expense | Income) | Category (Operations | Events | Elections | Merchandise | General) | Date * | Linked Budget (No linked budget) | Linked Event (No linked event) | Receipt Reference ("GCash reference, OR number, or payment note") | Cancel | Save Transaction / Update Transaction

## Finance > Collections and advances (/dashboard/finance/collections)
Tiles: Available funds | Verified collections | Remitted | Awaiting remittance
Filters: Status select (All | Pending | Verified); Cash advances Status select (All statuses | Awaiting approval | Approved, not released | Released | Partially repaid | Fully repaid)
Table "Collection records": cards (no headers): source + status badge | "<reference> · <date>" | notes | "Remitted <amt> · Remaining <amt>" | amount collected
Row actions: Verify (pending, only by a different admin than the recorder) | Remit (verified with balance)
Status badges: pending = amber, verified = green
Bulk/Toolbar: Record collection
Paging: none   Empty: "No collections recorded yet" / "No collections match this status"
Table "Cash advances": cards (no headers): purpose + status badge | "<reference> · requested by <name> · <date time>" | "<amt> advanced · <amt> repaid · <amt> outstanding"
Row actions: Approve | "Another admin approves your request." (own request) | Release funds | Record repayment
Status badges: Pending = amber, Approved = green, Released = green, Partially Repaid = amber, Fully Repaid = green
Bulk/Toolbar: Request cash advance
Empty: "No cash advances yet" / "No cash advances with this status"
Mobile: cards stack
  Dialog "Record collection": Source | Amount collected | Expected amount (optional) | Notes | Cancel | Record collection
  Dialog "Record remittance": "<reference> · Available <amt>" | Amount | Cancel | Record remittance
  Dialog "Request cash advance": Amount (PHP) | Purpose | Notes | Submit request
  Dialog "Record repayment" (cash advance repayments): "<reference> · <borrower> · <amt> outstanding" | Amount repaid (PHP) | Notes | Record repayment
  Confirm "Release funds"

## Finance > Student accounts (/dashboard/finance/student-accounts)
Tiles: Total Outstanding ("<n> students with balances") | Students Owing ("<n> financially cleared") | Overdue Accounts ("Past at least one due date") | Cleared Students ("Out of <n> students")
Filters: search "Name, school ID, email, course..."; "Financial status" (All statuses | Has outstanding debt | Overdue | Payment pending | Financially cleared); "Department" (All departments); "Year level" (All year levels); "Sort accounts" (Highest debt first | Student name | Recent activity); Clear all filters; label "10 rows per page"
Table "Student accounts": Student | Academic profile | Invoices | Merchandise | Total balance | Standing | Action
Row actions: View account
Status badges: Overdue = red, Pending clearance = amber, Cleared = green
Bulk/Toolbar: Add student charge
Paging: 10   Empty: "No student accounts yet" (+ "Add members") / "No student accounts match these filters"
Mobile: cards (name, school ID, Pending|Cleared badge, balances)
  Modal "Student Financial Account": Department | Course / Program | Year & Section | Email; Invoice balance | Pending merchandise | Total; list "Open invoices" (reference · description, "Due: <date> · Paid <amt>", balance; buttons Record payment | Cancel or waive); list "Pending merchandise" (ORD-<id> · item, "Payment proof awaiting verification" | "Reserved and not yet paid", price); footer Add charge | Close
  Modal "Add Student Charge": Student school ID | Description | Amount due | Due date | Add charge
  Modal "Record Invoice Payment": Payment amount | Record payment
  Modal "Cancel or Waive Invoice": Action (Cancel: charged in error | Waive: student is excused) | Reason | Keep invoice | Cancel invoice | Waive balance

## Finance > Financial reports (/dashboard/finance/transaction-history)
Tiles: Ledger net balance (strip)
Form "Prepare a report": Document (Financial Report | Income Statement) | Covered period (Semester | One event | This month | Custom dates) | Semester (Select semester) / Event (Select event) / Start date + End date | Letterhead image (PNG or JPG, up to 5 MB) | income statement only: Letter date | Subject | Recipient | Letter body | Closing | Treasurer | President | Adviser | SBO Adviser (each "<role> full name") | Generate Financial Report / Generate Income Statement; collapsible "Need a new semester? Add one here" (Semester name "Semester 2026-2027" | Start date | End date | End today | Add)
Result block: title, summary, Excel | Download PDF | Preview / print; Income | Expenses | Closing balance (or Net income)
Cards "Exports" (2): Full Transaction Log "Complete ledger of all recorded transactions" | Category Breakdown "Spending totals grouped by category and type"; each: Export Excel | Print / Save PDF; chip "All time"
Filters: search "Search reports"; "Filter reports by status" (All statuses | draft | pending department head | pending sao | approved | rejected); "Filter reports by document" (All documents | Financial report | Income statement); "Filter reports by event" (All events)
Table "Financial reports": cards (no headers): title + date generated | summary text | document chip (Income Statement | Financial Report) + status chip | stepper + next action
Row actions: View details | Export Excel | Download PDF | Preview / print
Status badges: draft, pending department head, pending sao, approved, rejected (all rendered as grey chip)
Paging: none   Empty: "No saved reports yet" / "No saved reports match these filters"
Mobile: forms stack to 1 column
  Drawer "<report title>": stepper, next step (Submit for review / Resubmit for review), summary, "Supporting files" upload ("<n> file(s) attached")

## Finance > Forecast (/dashboard/finance/financial-insights)
Tiles: Ledger net balance (strip)
Table "Forecast": cards (no headers): "Forecast for <period>" + "Balance <amt>" | Income | Balance | Safe spend | Risk | chips (engine, "<n> sample months", "<n> with recorded transactions", "Income fit R² x.xx", "Expense fit R² x.xx", "Fit quality: <q>") | warnings | confidence note; line chart above
Table "Summary by Category": cards: category + income|expense + total
Row actions: Delete forecast
Bulk/Toolbar: Generate forecast
Paging: none   Empty: "No forecasts yet" / "No category data available."
Mobile: single column

## Events and tasks > Events (/dashboard/events/manage-events)
Tiles: Total Events ("This academic year") | Upcoming ("Scheduled") | Completed ("Successfully held") | Total Tasks ("Across all events")
Filters: Academic period select (Active period | AY <label> · 1st|2nd Semester · <status>); view toggle List | Calendar; search "Search events"; Event date (date); Status (All statuses | Pending Approval | Approved | Ongoing | Completed | Cancelled); Sort by (Soonest | Latest date | Newest created | Title); Clear; "<n> events"
Table "Events": Event | Organizer | Schedule | Venue | Attendance | Tasks | Status | Budget Status | Actions
Row actions (kebab "Event actions"): View event | Edit event | Delete event | Cancel event
Status badges: Pending Approval/planning = amber (text can show the approval stage), Approved/Ongoing/Upcoming = blue, Completed = green, Cancelled = red; Budget Status: Not linked = red, Not required = grey, Pending = amber, Approved = green, Rejected = red; row shows "Returned: <remarks>" in red when returned; compact stepper under status
Bulk/Toolbar: New event
Paging: 10 (page size selector 10 | 25 | 50)   Empty: "No events proposed yet" (+ "Propose your first event") / "No events match these filters" / "No events in this semester"
Mobile: under 1024 px cards (title, description, status badge, stepper, Schedule, Venue, Operations "<n> present / late · <n> tasks", Budget, buttons View details | Edit event | Delete event | Cancel event)
  View "Calendar" (toggle): month grid with Previous month | Go to today | Next month, event chips coloured by status, day panel "No events scheduled on this day."
  Modal "Event details": poster, status badge, title, approval stepper and files; Schedule | Location | Event type | Expected participants | Description; Preparation progress ("<n> of <n> event tasks completed") | Attendance Summary ("Present n · Late n · Excused n · Absent n") | Approval stage; Planning Details (Requirements | Resources | Budget requirements | Vendor deadlines | Logistics checklist); "Linked Budget Status" (Manage Budgets button; Allocated | Spent | Income | Remaining; Financial Risk / Latest Organization Forecast; list of budgets: title + status, "Allocated · Spent · Income · Remaining · n transaction(s)"); "Update Event Status" (Mark Cancelled | Mark Ongoing | Mark Completed); Registrations; SAO event requirements
    List "Registrations": Seats taken meter "<n> of <n> · <n> left"; Registered | Attended | No-show | Cancelled; rows: name, "program · year · section · registered date", status badge; Empty "No one has registered yet. Students see a Register button on this event once it is approved."; Page x of y · n total, Previous | Next
    List "SAO event requirements": uploaded files (requirement, file, view), upload a PDF per required item, "Review: <status>"; Empty "SAO has not listed any file requirements."
  Modal "New event" / "Edit event": Event Name * | Event Type | Expected Participants | Start Date * | Start Time * | End Date | End Time | Venue type (On campus | Off campus) | SAO venue (Choose a venue) / Off-campus location | Description | Planning Requirements | Available / Required Resources | Event poster (optional, JPEG PNG WebP up to 5 MB) | Requires budget allocation (Proposed Budget | Warning Threshold) | Budget Requirements / Notes | Vendor Deadlines | Logistics Checklist | Cancel | Submit proposal / Save Changes
  Confirm "Delete this event?" and "Cancel this event?" (Keep event | Cancel event)

## Events and tasks > Venue booking (/dashboard/venues)
Tiles: none
Filters: Venue select ("<venue name> - capacity <n>"); From (date); To (date)
Panel "Find a venue": venue name, "<location> - capacity <n>", Request this venue; day chips (up to the first 14 days, reserved/pending dots); legend Reserved (navy) | Pending (amber); hour bar 5 AM to 10 PM; slot cards "<start> - <end>" + "Reserved by <org>" | "Pending request from <org>"; Empty "No bookings on this date."; first run "No venues available yet"
Table "My organization's requests": Venue | Event | Requested time | Status | SAO remarks | Actions
Row actions: Withdraw (pending, or approved and not started); Venue name opens detail
Status badges: Pending = amber, Approved = green, Rejected = red, Cancelled = red; second line = approval stage text
Bulk/Toolbar: Request a venue, Request an off-campus venue
Paging: 20   Empty: "No booking requests yet" (+ "Request a venue")
Mobile: DataTable cards under 768 px (label/value rows, Withdraw at bottom)
  Drawer "Booking detail": stepper, next step (Book again when rejected), Event | Requested time | SAO remarks, Withdraw request
  Modal "Request a venue booking": Venue type (On campus | Off campus) | Venue (Choose a venue) / Off-campus location | Start | End | Link to an event (Not linked to an event) | Send request
  Modal "Booking request sent": reference summary, Done
  Confirm "Withdraw this booking request?"

## Events and tasks > Planning (/dashboard/events/event-planner)
Tiles: none
Filters: Event select (Choose an event); Optional planning context (textarea)
Steps strip: 1 Choose an event | 2 Describe what is needed | 3 Review and assign
Button: Draft Editable To-do List; chips "Previous drafts": "Draft <n> · Needs review | Tasks created | Removed | Could not create"
Draft review (cards, no table): Plan outline | Key dates | What is needed | Setup and coordination | Possible problems; "To-do items" cards each: Task name | Due date and time | What needs to be done? | When should it happen? (Before the event | During the event | After the event) | Importance (Low | Medium | High | Critical) | Best officer role | This can start after (It can start right away | <earlier to-do>) | Assign to * (Choose an eligible officer; "<rank>. <name>, <position>, <n>/100 overall match") + Review officers; officer match panel: Role match | Available workload | Past task completion | Not recently assigned; buttons Add to-do | Remove Draft | Save and Assign Tasks; chip "Nothing saved yet"
Table "Assigned Event Tasks": Task | Assigned Officer | Event | Due Date | Status
Status badges: pending = grey, ready = blue, in progress = blue, blocked = amber, completed = green, overdue = red
Paging: 10   Empty: "No event tasks yet" ; page empty "No event to plan yet" (+ "Propose your first event")
Mobile: table scrolls horizontally (min 600 px); draft cards stack

## Events and tasks > Tasks (/dashboard/tasks/task-board)
Tiles: Total Tasks | Event-Related ("Linked to an event") | Standalone ("Organization work") | Pending ("Awaiting work") | In Progress ("Active assignments") | Completed ("Successfully done") | Overdue ("Past deadline")
Filters: view toggle Board | Progress; Academic period (Active period | AY <label> · 1st|2nd Semester · <status>); search "Search tasks, assignees, or events"; "Filter tasks by status" (All statuses | Pending | In Progress | Completed | Overdue); "Filter tasks by assignee" (All assignees | <officers>); "Filter tasks by event" (All events); "Filter tasks by type" (All task types | Event-related | Standalone); "Filter tasks by priority" (All priorities | Low | Medium | High | Critical); "Filter tasks by deadline" (date); Clear; "<n> tasks"
Table "All Tasks": Task | Assignee / Position | Academic Profile | Related Event | Type / Progress | Deadline | Status | Assigned By / Dates | Action
Row actions: Start | Complete (inline); kebab "Task actions": View task | Start task | Complete task | Reopen task | Edit task | Delete task
Status badges: Pending = grey, Ready = blue, In Progress = blue, Blocked = amber, Completed = green, Overdue = red; progress bar "<n>% complete"; stepper under status
Bulk/Toolbar: New task, Export
Paging: 10   Empty: "No tasks yet" (+ "Create your first task") / "No tasks match these filters"
Mobile: under 1024 px cards (title, Event task|Standalone task, description, status badge, stepper, Assignee, Deadline, Related event, progress bar, buttons View details | Start | Complete | Reopen | Edit | Delete)
Table "Officer Workload" (Progress view, no table): per officer row: avatar, name, "<completed>/<total>", progress bar, expandable "Show <n> tasks and progress" list (title, "<Status> · <n>%", View details); Empty "No assigned tasks yet"
  Page "New task" (/dashboard/tasks/task-board?new=1): Task type (Standalone task | Event-related task) | Task Title * ("e.g. Prepare election materials") | Description | Assigned category (Coordination | Finance | Publicity | Documentation | Logistics) | Required position (Any eligible position | <positions>) | Priority (Low | Medium | High | Critical) | Assign To * (Review recommendation first) | Related Event * (Select an event) | Deadline * | Initial Status (Pending | In Progress) | Review officer recommendation (ranked buttons "<name> · <position>" + score, "Recommended") | Clear Form | Create Task; side cards: Assignment readiness (Active SBO officers | Available events | Current open tasks), Best-fit recommendation, Before creating
  Modal "Task details": title, Event task|Standalone task, Due, status, stepper, next step; Description | Related Event; Assigned officer | Priority | Category | Required position | Progress | Academic period; "Add Progress Update" (Progress (%) | Update note "Describe what changed..." | Save Progress Update); "Reopen task" (Set to Not Started); list "Progress History" ("<Status> · <n>%", date, note, "By <name>"); Empty "No progress updates yet."
  Modal "Edit task": Task title | Description | Task type | Related event | Assigned category | Priority | Assigned officer | Deadline | Cancel | Save changes
  Confirm "Delete this task?", "Confirm Task Completion" (Cancel | Confirm Completion)

## Events and tasks > AI delegation (/dashboard/tasks/ai-delegation)
Tiles: same seven as Tasks (Total Tasks | Event-Related | Standalone | Pending | In Progress | Completed | Overdue)
Filters: Academic period select (Active period | AY ...)
No table: two panels.
  Panel "AI Task Suggestions" ("Weighted officer fit scoring, per task"): collapsible "Full officer ranking" with engine badge, "Inferred task area: <area>", list per officer: name + chips "Recommended" and position tier; Position | Workload | Performance | Recency (score with weight, e.g. 0.80 (x35%)); explanation text
  Cards "Scored assignments" (one per task): title | "Recommended: <name>" | engine badge | Role | Workload | Performance | Recency | note
  Panel "How AI Delegation Works": checklist ("Filters candidates to active, policy-eligible SBO Officers", "Weighs <factor> at <n>%" ...); "Eligibility rules for the latest request" bullets
Empty: "Create a task to generate an eligible officer recommendation and score breakdown."
Mobile: panels stack to 1 column

## Events and tasks > Check-in (/dashboard/events/check-in)
Tiles (per selected event): Currently inside ("Not checked out") | Attendance records ("Total arrivals") | Late ("After start") | Check-in rate ("of <n> expected" / "No target set")
Layout: left "Event queue" list (title, start, location; "<n> events open for check-in"), right detail; Refresh live data
Panel "Fingerprint check-in / checkout": optional candidate filters (All programs | All sections | year level), scan, "Is this the correct Student?" (School ID, Action, Match score), buttons Cancel | No, Scan Again | confirm
Panel "Manual check-in": Member search "Search name or School ID" ("No matching members found."); Attendance status (Present | Late | Excused | Absent); Confirm Check-In
Filters: search "Search attendee or academic profile"; "Filter attendance status" (All statuses | Present | Late | Excused | Absent)
Table "Attendance log": Member | School ID | Academic Profile | Method | Status | Check In / Out | Recorded By
Status badges: Present = green, Late = amber, Excused = blue, Absent = red; Method Biometric = blue, Manual = green
Bulk/Toolbar: Export CSV; "<n> matching"
Paging: 10   Empty: "No attendance records yet" / "No attendance records match the filters." / "No events ready for check-in" / "Check-in is closed"
Mobile: under 1024 px cards (name, School ID, status badge, Check-in, Method, academic profile line); event queue and detail show one at a time with "All Events" back button

## Voting > Elections (/dashboard/elections/manage-elections)
Two states. Picker (no election chosen), then Workspace (election chosen).
Tiles (picker): Total elections | Live voting | Awaiting approval | Closed
Filters (picker): Academic period (Active period | AY ...); search "Search by election title..."; "Filter elections by status" (All statuses | Pending approval | Upcoming | Live | Closed)
Table "Elections": cards (2 per row, 6 per page, no headers): banner image + status chip (Pending Approval = amber, Upcoming = blue, Live = green, Closed = grey, Returned = red) | title | timeline | compact stepper + "Next: <step>" | start and end date times | Positions | Candidates | Votes
Row actions: Open election | Informative letter | Edit (or "Edit and resubmit") | Delete | Open voting (upcoming, finalized) | Close (live) | "In review" (pending approval chip)
Bulk/Toolbar: Create election (also from Approvals > New request > Election)
Paging: 6   Empty: "Create your first election" (+ button) / "No elections match" / "No elections in this semester"
Mobile: cards stack to 1 column
  Dialog "Create election" / "Edit election": title ("e.g. HIUSA General Elections 2026"), venue/room ("Online ballot or room name"), schedule, artwork (Remove artwork), ballot positions (rows: Position <n> title, maximum winners, remove), submit for Department Head approval; Confirm "Delete Election"
Workspace header: election title + status chip (Pending approval = amber, Upcoming = blue, Voting open = green, Closed = grey, Returned = red), Change election; step tabs Overview | Party lists | Candidates | Voters | Results; next-step actions Finalize ballot | Open voting | Release results | Edit and resubmit
Table "Ballot positions" (Overview, no table): per position card: position title, "Up to <n> winner(s)", "<n> candidates" chip, Remove; rows "<candidate name>" + party list or "Independent" + "<n> votes"; Empty "No candidates for this position."; header "<n> positions, <n> candidates, <n> votes"
Bulk/Toolbar: Add Position
Empty: "Position setup is locked for this election." (banner when locked)
  Modal "Add Election Position": Position Title | Max Winners | Cancel | Add Position; Confirm "Remove Election Position"

## Voting > Elections > Party lists (/dashboard/elections/manage-partylists)
Filters: search "Search party roster"
Table "Party rosters": cards (no headers): banner, name, acronym, description, assigned candidates grid (photo, name, position) | counts "<n> rosters shown" and "<n> total partylists"
Row actions: Edit | Remove
Bulk/Toolbar: Register New Party
Empty: "No partylists registered for this election." / "No partylist matches your search." / "No assigned candidates yet."
Mobile: cards stack
  Modal "Register Partylist": Partylist Name * ("e.g. Alab") | Acronym ("e.g. ALAB") | Description ("Party description or tagline...") | Party Banner
  Modal "Edit": tabs General Information (Official Party Name | Acronym / Abbreviation | Mission Statement, Party Banner) | Roster Management | Platform & Documents; Confirm "Remove Partylist"

## Voting > Elections > Candidates (/dashboard/elections/manage-candidates)
Filters: position chips (All | <each position>)
Table "Candidates": cards (2 per row, no headers): photo, name, position, party list chip (or "Independent"), expandable "View candidate details" (platform; "No campaign platform has been added.")
Row actions: Edit | Remove
Bulk/Toolbar: Add Candidate; "<n> candidates registered for <election>"
Empty: "No candidates yet for this election." ; banner "Candidate setup is locked because votes have already been cast."
Mobile: cards stack to 1 column
  Modal "Add Candidate" / "Edit Candidate": Student * (search "Search student..."; "No students found.") | Position * (Select a position...) | Party List (Independent | <lists>) | Candidate Photo | Platform Statement ("Candidate's platform and vision...") | Cancel; Confirm "Remove Candidate"

## Voting > Elections > Voters (/dashboard/elections/manage-elections?view=voters)
Tiles: Total Voters | Voted | Not Yet Voted ("Still pending") | Election Status ("Current state")
Filters: search "Search by name or school ID..."; status chips All | Voted | Not Yet
Table "Voters: <election title>": Name | School ID | Role | Email | Vote Status
Status badges: Voted = blue, Not Yet = grey
Paging: 10 (label "voters")   Empty: "No eligible voters are registered in this organization yet." / "No voters match your search."
Mobile: Role hidden under 1024 px, Email hidden under 768 px; table min width 350 px

## Voting > Results (/dashboard/elections/election-results)
Tiles: Ballots | Selections | Positions | Candidates (hero card with banner, chip "Official final results" or "Live vote totals", "Election concluded" or "Voting in progress")
Filters: "Available results" election cards (when more than one); "Filter by position" chips (All | <positions>)
Table "Results by position": cards (2 per row, no headers): "Ballot position" + title + "Votes cast"; head-to-head strip for top two; candidate rows: portrait, name, party list, "Winner" badge, votes, percent, bar
Cards "Winner spotlight": winner name and position (final only)
Status badges: Winner = highlighted row with blue bar
Empty: "No candidate result data is available." / "No result data is available for this position." / "Election results are not available yet." ("Vote totals appear once the finalized ballot opens. Winners are declared after closing.")
Mobile: cards stack to 1 column

## Store > Inventory (/dashboard/merchandise/manage-inventory)
Tiles: Total Items ("In inventory") | Low Stock ("Needs restocking") | Active Orders ("Pending fulfillment") | Revenue ("From paid orders")
Panel "Top sellers": podium of top 3 (name, "<n> sold") and ranked list "#<n> <item>  <amt> collected  <n> sold"; Empty "No paid merchandise sales yet."
Filters: "Filter inventory by category" (All categories | <categories>); search "Search items..."
Table "Product catalog": cards (3 per row, no headers): image | name | "<price> per unit" (or promo price struck through + "<n> slots left") | category chip | "Out of Stock" (red) / "Low Stock" (amber) chip | variants "<name>: <stock> · ..." | View audit history | "In stock:" "<n> units" | Add Stock | ACTIVE/INACTIVE switch | Edit | Deactivate
Row actions: Add Stock | Edit | Deactivate | View audit history | selling-status switch
Status badges: Out of Stock = red, Low Stock = amber, ACTIVE = green switch, INACTIVE = grey switch
Bulk/Toolbar: Add product; Set up GCash / Add stock prompts when out of stock
Paging: none   Empty: "No items yet." (+ "Add your first item") / "No items match these filters."
Mobile: cards stack to 1 column (2 columns from 640 px)
  Modal "Add Product" / edit: Item Name * ("e.g. HIUSA T-Shirt (XL)") | Unit Price (PHP) * | Initial Stock * | Category * (Select category | Enter category name) | Low stock at or below | Promo price (Optional) | First buyers ("e.g. 100") | Sizes and variants (Size / variant, Add variant) | Description ("Optional description...") | Selling Status | Product Image
  Modal "Add Stock": Variant (Select variant) | Quantity to Add | Reason for stock addition ("e.g. New delivery received")
  Modal "Product history" (audit): "No recorded changes yet."; entries Note | Stock | Price
  Modal "GCash payment settings": official QR upload

## Store > Orders (/dashboard/merchandise/manage-orders)
Tiles: Pending review ("<amt> awaiting approval") | Ready for pickup ("Approved orders with active tokens") | Claimed ("Orders released to buyers") | Collected ("<n> paid orders")
Filters: status tabs (All orders | Pending review | Ready for pickup | Claimed | Cancelled); search "Search order, student, item, reference..."; "Merchandise item" (All merchandise | <items>); "Sort orders" (Newest first | Oldest first | Highest amount | Lowest amount | Student name | Merchandise item | Order status); "More filters": "Program or course" (All programs), "Major or specialization" (All majors), "Year level" (All year levels | 1st Year ... 4th Year), "Section" (All sections), "User role" (All user roles), "SBO position" (All SBO positions), "Payment method" (All payment methods), Ordered from, Ordered to, Paid from, Paid to, Claimed from, Claimed to, Clear all filters; view toggle Responsive | Cards; label "10 rows per page"
Table "Order queue": Order / Reference | Student / User | Role | Item | Amount | Quantity | Total | Mode of payment | Fulfillment | Actions   (Academic Profile, Review Trail and Dates columns exist but are always hidden)
Row actions (kebab "Order actions"): Review order | Release at claim desk (paid) | Approve directly (Admin) or Verify & submit (Officer) (pending) | Reject order (pending)
Status badges: Fulfillment pending = blue, paid ("Ready for pickup", shown as Paid) = amber, claimed = green, cancelled = red; Mode of payment cell: CASH|GCASH, reference, Paid (green) / Pending (amber) / Cancelled (red), chips "Officer: <status>" and "Admin: <status>" (approved = green, rejected = red, otherwise amber); claim token box (16 characters) for paid orders
Bulk/Toolbar: Payment settings (Admin) or View GCash QR, Export CSV; footer "Cohort: <n> of <n> users purchased (<n>%)" with View purchasers | View non-buyers
Paging: 10 ("Showing a-b of n", page n / n)   Empty: "No orders yet." (+ "Open inventory") / "No orders match these filters."
Mobile: cards below 1280 px (order id, status, student, item, amount, payment, review chips, claim token, buttons)
  Modal "Order record" (ORD-<id> · <item>): stepper, next step, receipt document (view payment proof), "Order activity history" list (action, actor and position, time, Remarks, Status old -> new, Variant, Order total); Empty "No review actions have been recorded yet."; "No payment proof is attached."
  Modal "Merchandise drill-down" (purchasers / non-buyers): Export Excel; Table: Student ID | Full Name | Department | Program / Major | Year / Section | Role / Position | Item | Qty | Unit Price | Total | Payment | Order | Ordered | Paid | Claimed | Approved / Released By | Reference; Empty "No users match this drill-down."
  Modal "Verify merchandise payment": Amount verified; Modal "Reject merchandise payment": Rejection reason

## Store > Claim desk (/dashboard/merchandise/claim-tokens)
Tiles: none
Form "Release an order": 16-character claim token ("16-character token") | Claim
Filters: "Filter claim tokens by status" (Waiting to be claimed | Claimed)
Table "Claim desk register": Order | Purchaser | Section | Department | Course / program | Payment mode | Number of items | Status / token | Details
Row actions: Review order
Status badges: Waiting to be claimed = amber, Claimed = green (token shown below in monospace)
Paging: 10 (label "paid orders")   Empty: "Nothing is waiting at the claim desk." (+ "Open orders") / "No orders have been claimed yet."
Mobile: table scrolls horizontally (min 1050 px)
  Modal "Verify purchaser and release": receipt document; Cancel | Confirm Claim / Release

## Updates > Announcements (/dashboard/announcements/manage-announcements)
Tiles: Matching records | Published | Waiting for approval | Recorded views
Chart "Announcement interactions": per announcement (first 8) bars Views and Likes; Empty "No interaction data for the current selection."
Filters: search "Search title, content, or author"; category (All Categories | General | Election | Training | Events | Merchandise); audience (All audiences | Students | SBO Officers | Admins | Department Heads | Super Admin); publication (All publication states | Published | Unpublished / Draft); Created from (date); Created to (date); sort (Newest first | Oldest first | Title A-Z | Most viewed); Clear; "<n> announcements"
Table "Announcement list": Title | Status | Audience | Actions
Row actions (kebab "Announcement actions"): View full record | Edit announcement | Publish announcement / Unpublish announcement / Approve & publish | Delete announcement; title click expands an inline preview (org name, published date, title, body, image, Posted by | Created | Updated | Reviewer | Category | Views)
Status badges: Waiting for Admin approval = yellow, Returned = red, Published = green, Draft = grey
Bulk/Toolbar: New announcement, Export CSV
Paging: 20   Empty: "No announcements yet" (+ "New announcement") / "No announcements match these filters"
Mobile: Audience column hidden under 640 px; table min width 580 px at 640 px and above
  Modal "Edit Announcement": Title | Audience (All Members | Students | SBO Officers | Admins | Department Heads | Super Admin) | Category | Announcement content | Cancel | Save Record
  Modal "Announcement details": Audience | Category | Stage | Publication | Unique Views | Created | Updated | Published; Author; Review trail ("No review remarks."); Full announcement
  Confirm "Publish announcement" / "Unpublish announcement" / "Delete announcement"

## Updates > New announcement (/dashboard/announcements/create-announcement)
No table: form. Title * ("e.g. General Assembly - Second Semester") | Instructions for AI draft (optional) | Content * ("Write your announcement content here...") | Publishing settings: Audience (All Members | Officers Only | Students Only | Admins Only | Department Heads Only) | Category (General | Election | Training | Events | Merchandise) | Poster or image (optional) | Pin to the top | Mark as important | Publish Now / Submit for approval | Save Draft

## Updates > Feed (/dashboard/announcements/view-announcements)
Filters: search "Search announcements"; "Announcement category" (All categories | General | Election | Training | Events | Merchandise)
Table "Feed": cards (no headers): organization name + date | title | body | image | Like / Liked button
Paging: 20   Empty: "No announcements yet" ("Your officers post them here.") / "No announcements match"
Mobile: single column feed

## Records > Compliance (/dashboard/compliance)
Tiles: header meter "Requirements met <n>/<n>" with "Academic year <label>"; accreditation stepper and next step
Table "Organization compliance requirements": Requirement | Submitted | Deadline | Status | Upload | Actions
Row actions: Upload document (not submitted) | Replace document (returned or pending) | "Locked" (approved)
Status badges: Not submitted = amber (Pending), Under review/Submitted = blue, Approved = green, Returned = red; second line stage text; red "SAO: <remarks>" under requirement when returned; Deadline shows date and relative time (red when overdue)
Paging: none   Empty: "No requirements assigned yet"
Mobile: DataTable cards under 768 px
  Drawer "<requirement name>" (Due <date>): description, "Why this was returned" box, file dropzone, selected file name, upload progress, Cancel | Submit for review

## Records > Grievances (/dashboard/grievances)
Tiles: none ("<n> grievances" count in filter bar)
Filters: "Filter by status" (All statuses | Submitted | Under review | Resolved | Dismissed); "Filter by urgency" (All urgencies | Critical | High | Medium | Low); "Filter by category" (All categories | Safety & Security | Financial Integrity | Facilities & Maintenance | Academic / Faculty | General); Clear filters
Table "Grievances": Grievance | Urgency | Status | Filed by | Filed
Row actions: row title opens drawer
Status badges: Urgency Critical = red, High = amber, Medium = blue, Low = grey; Status Submitted = blue, Under review = blue, Resolved = green, Dismissed = grey (second line stage text); Filed by shows "Confidential" (blue) when the filer is hidden
Paging: 20   Empty: "Nothing to review" / "No grievances match these filters"
Mobile: DataTable cards under 768 px
  Drawer "<grievance title>" (Filed <relative>): urgency badge and category badge; stepper; Addressed to; Description; Filed; Remarks; "Update status" buttons (Move to under review | Resolve | Dismiss) opening a dialog with Remarks (required, "What was found, and what happens next...")

## Records > Clearance signing (/dashboard/clearances)
Tiles: none ("<n> in queue" count)
Filters: search "Search by name or school ID..." (current page only); "Filter by clearance period" (All periods | <periods>); "Filter by status" (All statuses | Pending | Held | Cleared); Select all pending (<n>) / Clear selection
Table "Clearance signing queue": Student | Role | Period | Stage | Actions
Row actions: checkbox (pending rows, for bulk clear) | Clear (or Clear hold when held) | Hold (pending); student name opens drawer
Status badges: pending, held, cleared via stage text in the Stage column
Bulk/Toolbar: Clear <n> selected
Paging: 20   Empty: "Nothing waiting on your signature" / "No signatures match these filters"
Mobile: DataTable cards under 768 px
  Drawer "<student name>" (<period> · <role>): stepper, next step, Clear / Hold actions
  Dialog "Hold <role>" / "Clear <role>": Reason (required for hold, "e.g. Unpaid organization dues"); Modal "Clear selected signatures" (Cancel | Clear selected)

## Records > Audit log (/dashboard/audit-logs)
Tiles: none ("<n> entries" count)
Filters: search "Search actor, action, module, or record ID"; "Module" (All modules | <module names>); "Action category" (All actions | Create | Update | Delete | Approve | Reject | Payment | Collection | Remittance | Attendance | Status Change); "Actor role" (All actor roles | <role labels>); "Actor department" (All departments); "Actor program" (All programs); From (date); To (date); "Sort audit logs" (Newest first | Oldest first | User name | User role | Module | Action); Clear
Table "Audit records": Time | Actor | Role | Module | Action | Affected record | Record ID | Details
Row actions: View details
Bulk/Toolbar: Export CSV
Paging: 10   Empty: "No audit activity yet" / "No audit activity matches these filters"
Mobile: table scrolls horizontally (min 1000 px)
  Modal "Audit record LOG-<id>": Actor | Actor role / position | Actor academic profile | Affected record | Record type | Record ID | IP address | Timestamp
    Table "Before / after changes": Field | Before | After   (10 per page; Empty "No field-level change payload was recorded for this action.")

## My activity > Vote (/dashboard/elections/cast-vote)
No table: election cards (2 per row). Fields in order: icon + state badge (Open = green, Voted = blue, Upcoming = amber, Closed = grey) | title | date | "<start> to <end>" with duration | room ("Online ballot" default) | action: "Vote in this election" button (open), "Your ballot receipt" + hash (voted), "Voting opens <date>. Come back then to cast your ballot." / "The ballot is still being built. Voting opens after the Admin finalizes it." (upcoming), "Voting has ended for this election." (closed) | "Results: <View results link or text>"
Empty: "No election is open for voting"
Mobile: cards stack to 1 column
  Page "Ballot" (/elections/<id>/vote): immersive full-screen ballot, no table.

## My activity > Shop (/dashboard/merchandise/order-merchandise)
Filters: search "Search product, category, or description"; "Filter merchandise category" (All categories | <categories>); "Sort merchandise" (Available first | Most stock | Price: low to high | Price: high to low); line "<n> total units available across <n> products"
Table "Shop": cards (3 per row, no headers): image | name | category | price (promo struck through) | stock | "Size / variant" (Select variant) | quantity stepper | Add to Cart | "View product details"
Bulk/Toolbar: cart bar (item count, order total) leading to cart
Paging: none   Empty: "Nothing to buy yet." ("Your officers add merchandise here.") / "No merchandise matches your filters."
Mobile: cards stack (2 per row from 640 px)
  Page "Your merchandise cart" (cart view): rows (image, name, variant, price, quantity - and +, Remove <item> from cart); "<n> total items"; "Order total: <amt>"; Clear Cart | Review & Continue; note "Placing an order does not reserve stock. Stock is reserved after payment approval."
  Modal "Confirm your reservation" ("Final review"): payment method (Cash on pickup | GCash (single order only), GCash reference "13-digit reference")

## My activity > My orders (/dashboard/merchandise/my-orders)
Filters: search "Search orders or token..."
Table "My orders": cards (no headers): image | "ORD-<id>" | item name | "Qty: <n> · Total: <amt>" | date | status chip (Pending = blue, Paid = amber, CLAIMED = green, Cancelled = red) | buyer stepper | View details | claim ticket with token (paid) | callouts: "Payment confirmed! Show your token again to collect your item." / pending payment hint with Submit GCash Proof or Replace Proof and Cancel Order / red cancelled reason / "Item successfully claimed on <date>."
Row actions: View details | Submit GCash Proof | Replace Proof | Cancel Order | print claim ticket
Paging: 10 (label "orders")   Empty: "No orders yet." (+ "Browse the shop") / "No orders on this page match your search."
Mobile: cards stack
  Drawer "ORD-<id>": stepper, next step; Quantity | Total | Payment | Ordered | Claim token | Claimed

## My activity > My receipts (/dashboard/finance/personal-receipts)
Table "Personal Receipts": cards (3 per row, no headers): "Receipt" header | description | "<date> - <event, budget or category>" | receipt reference or "Receipt #<id>" | amount | View Receipt
Row actions: View Receipt
Paging: none   Empty: "No receipts yet"
Mobile: cards stack (2 per row from 640 px)
  Modal "<receipt reference>": receipt document; Close | Open receipt file | Print receipt

## My activity > Statement of account (/dashboard/finance/statement-of-account)
Table "Statement of Account & Financial Clearance": Description | Reference | Due date | Status | Amount due | Paid | Balance
Status badges: none, plain text (status value with underscores replaced by spaces, capitalised)
Paging: none   Empty: "No invoices have been issued to you."
Mobile: DataTable cards under 768 px (header/value rows)
Student-only summary (hidden for Admin): account summary and clearance holds.

## Footer > Profile (/dashboard/profile)
No table: profile header (name, role; fields School ID | Organization | Email address), then forms.
  Card "Personal information": First name | Last name | Email address | Mobile number (optional, "e.g. 0917 123 4567") | Discard changes | Save profile
  Card "Password & security": Current password | New password | Confirm new password
  Card "Notifications": toggles Announcements | Events and reminders | Elections | Merchandise orders
  Card "Your recent activity": list rows "<action> in <module>" + record label + date time; "Showing <n> of <n>"; Show more; Empty "Nothing recorded yet. Registering for an event or submitting a request will show up here."

## Footer > Study objectives (/dashboard/objectives)
No table: read-only evidence page. Sections in order: general objective banner | Research foundation (SO1, SO4) | SO2 pillar system (one card per pillar) | Synthesis (SO3). Each objective card: statement, evidence counters (label + value pairs, "No evidence has been counted for this objective yet."), "No activity recorded yet." line.
Empty: "No objectives are configured yet" / error "Study objectives could not be loaded"
Mobile: cards stack

COVERAGE: 35 pages, Dashboard, Approvals, People, Officer positions, Programs and sections, Budgets, Ledger, Collections and advances, Student accounts, Financial reports, Forecast, Events, Venue booking, Planning, Tasks, AI delegation, Check-in, Elections, Results, Inventory, Orders, Claim desk, Announcements, Feed, Compliance, Grievances, Clearance signing, Audit log, Vote, Shop, My orders, My receipts, Statement of account, Profile, Study objectives
