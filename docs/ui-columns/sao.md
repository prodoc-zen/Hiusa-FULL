# SAO (SUPER_ADMIN) screens: table columns

Conventions. Column headers render UPPERCASE via CSS (text shown here in source case). "DataTable" = shared component: table at 768 px and up, under 768 px each row becomes a card (one line per column: header on the left, value on the right; row actions in a footer row under a divider). Actions column header is "Actions" for DataTable, "Action" for the hand-built Admins table. Status badge tones: success = green, warning = amber, danger = red, info = blue, neutral = grey. Default StatusBadge labels: pending Pending (warning), submitted Submitted (info), under_review Under Review (info), approved Approved (success), returned Returned (danger), rejected Rejected (danger), active Active (success), inactive Inactive (neutral), disabled Disabled (danger), archived Archived (neutral), resolved Resolved (success, grievance override), dismissed Dismissed (neutral), held Held (warning), cleared Cleared (success), withdrawn Withdrawn (neutral), draft Draft (neutral), published Published (success).
Registration stepper (compact, used on registration rows): Registered > SAO review > Administrator > First use. Row line above it: "Review this registration" | "Provision an administrator" | "Active: administrator can sign in" | "Active".
Sidebar footer (all roles): Profile, Study objectives. Redirects (no screen): /super-admin/event-requirements, /approvals, /financial-reports -> Compliance tabs.

## Dashboard (/dashboard/super-admin)
Tiles: Registered organizations | Active organizations | Inactive organizations | Financial reports to review | Unread Notifications
Filters: dropdown "Organization filter": All organizations, then "<ACRONYM>: <Name>" per organization
No table: RoleBriefing card, metric tiles (2-col grid), "SAO actions" link list (Registrations and organizations | Administrators | Colleges and Department Heads | Compliance and financial reports | University announcements | Notifications), "Recent notifications" list (cards: title, 2-line message; link "View all")
Empty: "No student organizations registered yet" (button "Open colleges"); notifications: "No new notifications. Organization notices will appear here when they need your attention."
Mobile: tiles 1 col, action list and notification list stack

## Organizations > Agency overview (/dashboard/super-admin/agency)
Tiles (links): Pending reviews | Organizations | Colleges | Archived
Filters: none
Table "<College name> (<CODE>)" (one collapsible section per college, header button with chevron; open by default when it has pending, returned or awaiting-administrator organizations; header line: "<n> organization(s) · <n> pending · <n> active · <n> returned · <n> archived · <n> awaiting administrator"): Organization | Status | Members | Needs attention
  Cell detail: Organization = name over acronym; Status = badge + registration line + compact stepper; Members = right-aligned number; Needs attention = "<n> approval(s), <n> document(s)" or "Nothing waiting"
Table "Organizations without a college" (shown only if any): same columns (Organization | Status | Members | Needs attention)
Row actions: Review (pending only) | Provision administrator (active, 0 administrators) | Open
Status badges: pending = amber, active = green, returned = red, archived = grey (read only)
Paging: none (all colleges listed; rows sorted by action needed)   Empty: "No student organizations yet. The Department Head registers them." (college with none shows this inline); page empty: "No colleges or organizations yet"
Mobile: DataTable cards

## Organizations > Registrations and organizations (/dashboard/super-admin/organizations?status=pending)
Filters: tabs "Pending review (n)" | "Active (n)" | "Returned (n)" | "Archived (n)"; search "Name, code, or college" (label "Search organizations")
No table: cards in 2 columns, grouped under a college heading (color swatch + college name). Card fields in order: logo | name | "<ACRONYM> · <College>" | "Sub organization of <parent>" | status badge | description | registration line + stepper | "Submitted <date>" (pending) or "Returned with remarks" box (returned) | "<n> members · <n> admins"
Row actions: Open | Review (pending) | Provision administrator (active, 0 admins) | Restore (archived) | menu "Organization actions": Edit organization, Add existing user, Manage user profiles, Archive organization (active only)
Status badges: pending = amber, active = green, returned = red, archived = grey
Bulk/Toolbar: none
Paging: 100 per page, "Previous | Page n of m | Next" only when more than 1 page   Empty: "No organizations are waiting for review." / "No active student organizations match this view." / "No organizations are returned to their Department Head." / "No archived organizations." with hints; searching: "Try a different search term."
Mobile: cards stack to 1 column (lg:grid-cols-2 below becomes 1)
  Drawer "Review registration": fields Organization | College | Description | Submitted | Submitted by; stepper on top; remarks field "Remarks (required to return)"; footer Return | Approve
    Table "Registration documents" (list rows, cards): file label (item) with icon | "<file name> · <date>" | button Open. Empty: "No registration documents were submitted."
  Modal "Archive organization": field "Reason (optional)"; buttons Cancel | Archive organization
  Modal "Edit organization": Organization name | Organization code | Main organization (This is a main organization, or parent) | College (read only) | Organization color | Organization logo (optional) | Description; section "Organization members" buttons Add existing user, Manage user profiles; buttons Cancel | Save organization
  Modal "Add existing user": Destination organization | Search existing users ("Name, school ID, or email") | Choose a user (radio list: name, "School ID <id> · <email>"; empty "No eligible users found in this college.") | Role in destination organization (Student, SBO Officer, Department Head, Admin) | pager Previous / Page n of m / Next
  Modal "Manage user profiles": Search profiles ("Name, school ID, or email"); cards: "<name> · <school id>" | "<organization> · <role> · <status>" | "Primary profile / Additional profile · <n> total profiles" | button Delete profile. Empty: "No profiles found in the organizations you manage."

## Organizations > Registrations and organizations > detail (/dashboard/super-admin/organizations/:organizationId)
Tiles: Members by role: Students | SBO officers | Admins | Total; Approved budgets: Allocated | Spent | Income | Remaining; Compliance: Accreditation (badge) | Documents awaiting review; Pending approvals: count sentence
No table: header (logo, name, "<ACRONYM> · <College>", status badge, button "Restore organization" when archived), stepper + next-step callout, sections as cards
Table "Leadership" (list rows): name over "<Position> · <Role>" | status badge. Empty: "No administrators or officers yet. Provision an administrator so the organization can sign in."
Table "Events" (two lists): "Upcoming" and "Recent": title over "<date time> · <location>" | status badge. Empty: "None."
Table "Latest documents" (list rows, max 10): item over "<file name> · <date>" | status badge | button Open. Empty: "No documents have been submitted."; links "Open the review queue", "View all documents", "Back to agency overview"
Status badges: accreditation: Accredited = green, Pending review = blue, Incomplete = amber, Returned = red, Not applicable = grey; event statuses use default map
Mobile: sections stack to 1 column

## Organizations > Administrators (/dashboard/super-admin/admins)
Tiles: Total Admins | Active Accounts | Organizations Covered
Filters: search "Search name, School ID, email, or position"; dropdown "Filter by organization": All organizations, "<ACRONYM>: <Name>"; dropdown "Filter by account status": All statuses, Active, Inactive, Disabled
Table "Administrators" (grouped by row bands "Main organizations" / "Sub organizations"): Administrator | Organization | Position | Status | Action
  Cell detail: Administrator = full name over "<email> · <school id>"; Organization = acronym; Position = title or "Organization Admin"
Row actions (menu "Administrator actions"): Add to organization | Manage profiles | Hand over role | Reset access | Edit administrator | Delete administrator
Status badges: active = green, disabled = red, inactive = grey (plain lowercase text pill)
Bulk/Toolbar: button "New Admin User"
Paging: all 100 loaded, no pager   Empty: "No administrator accounts match this view." / "Change the filters or create a new Admin user."
Mobile: table keeps min width 760 px and scrolls horizontally
  Modal "Create New Admin User" / "Edit Admin User": School ID * | First name * | Last name * | Email address * | Contact number | Position title (suggestions: Adviser, President, Vice President - Internal, Vice President - External, Secretary) | Assigned organization * | Password * | Confirm password * (create only) | Account status (edit only: Active: can sign in, Inactive: temporarily unavailable, Disabled: access revoked); buttons Cancel | Create Admin User / Save Changes
  Drawer "Hand over administrator role": toggle (existing member / new account); "Find a member" (search "Name, School ID or email") radio list: name over "<Role> · <position> · <school id>", empty "No matching members. Check the spelling, or create a new account for the successor."; or new account fields School ID | First name | Last name | Email | Contact number | Initial password | Confirm password; buttons Cancel | Hand over
  Dialogs: "Initiate password reset" (Send reset link), "Delete administrator" (Delete administrator)

## Organizations > Colleges (/dashboard/super-admin/colleges)
Filters: search "College name or code" (label "Search colleges")
No table: cards, 2 columns. Card fields in order: logo | name | "<code or No code> · <n> organization(s) · Active/Inactive" | description | "Department Head": name + status badge + email, or "No Department Head yet"
Row actions: Manage (when a head exists) | Assign Department Head (when no active head) | View organizations | Upload logo
Status badges: head account status: active = green, inactive = grey
Bulk/Toolbar: none
Paging: none   Empty: "No colleges found" / "No colleges match your search." / "The college list is empty. Colleges are added by the system administrators."
Mobile: cards 1 column
  Modal "Assign Department Head": School ID | First name | Last name | Email | Password | Confirm password; buttons Cancel | Assign Department Head
  Modal "Manage Department Head": School ID (text) | First name | Last name | Email; "Account status" badge; buttons Send password reset | Deactivate / Reactivate; footer Cancel | Save changes

## Reviews > Compliance (/dashboard/super-admin/compliance)
Filters: tabs "Accreditation" | "Requirements" | "Review queue (n awaiting)" | "Event requirements" | "Financial reports" | "Track documents" (URL ?tab=accreditation|requirements|review|events|financial|documents)
Table "Organization accreditation" (tab Accreditation; card subtitle "Academic year <label>"): Organization | Accreditation | Requirements met | Overdue | Next action
  Cell detail: Accreditation = badge + compact stepper (Requirements > SAO review > Accredited); Requirements met = progress bar "<approved>/<total>"; Overdue = right-aligned count; Next action = button "Review <n> submission(s)" or text "Awaiting submission" | "Waiting on the organization" | "All caught up" | "No active requirements"
  Status badges: Accredited = green, Pending review = blue, Incomplete = amber, Returned = red, Not applicable = grey
  Paging: none   Empty: "No organizations to track yet"
  Mobile: DataTable cards
Table "Requirement catalog" (tab Requirements): Requirement | Academic year | Deadline | Description
  Row actions: active switch (label "<name> active") | Edit | Delete   Toolbar: "New requirement"
  Paging: none (100 loaded)   Empty: "No requirements defined yet" (button "New requirement")
  Mobile: DataTable cards
  Modal "New requirement" / "Edit requirement": Academic year (Choose academic year; "<label> · Current") | Deadline | Name (placeholder "e.g. Accomplishment report") | Description | Requirement active switch; buttons Cancel | Add requirement / Save changes
  Dialogs: "Mark this requirement inactive?" (Mark inactive), "Delete this requirement?" (Delete requirement)
Table "Review queue" (tab Review queue): Organization | Requirement | Submitted | Submitted by | Status
  Cell detail: Requirement = name over kind ("Registration document" | "Semestral report" | "Renewal document"); Status = badge + stage sentence ("Waiting for SAO review" | "Returned: replace the file" | "Approved"; registration files: "Decided in the organization review" | "Registration returned, waiting for the Department Head")
  Filters: dropdown "Filter by status": Awaiting review (default), Approved, Returned, All statuses; dropdown "Filter by organization": All organizations (+ "<name> (registration)" entries); button "Clear filters"; counter "<n> submission(s)"
  Row actions: Open document (icon) | Open organization review (registration files) | Return | Approve (submitted only)
  Status badges: submitted = blue, approved = green, returned = red
  Paging: 20   Empty: "Nothing to review" (unfiltered) / "No submissions match these filters"
  Mobile: DataTable cards
    Drawer "<requirement name>" (subtitle organization): stepper Required > Submitted > Approved; next-step callout; fields Submitted | Submitted by | SAO remarks; buttons Open document | Open organization review | Return | Approve
    Modal "Return this submission": field "Remarks" (required); buttons Cancel | Return to organization. Dialog "Approve this submission?" (Approve)
Table "Submission checklist" (tab Event requirements, left card, "<n> active"): # | File | Details
  Cell detail: Details = "PDF · <All venues | On campus | Off campus> · <Required | If applicable | Inactive>"
  Row actions: Edit (icon) | Remove (icon)
  Paging: none   Empty: "No files required yet" / "Add the first checklist item."
  Mobile: DataTable cards; form card stacks below
  Form card "Add requirement" / "Edit requirement": File name (placeholder "Event proposal") | Venue type (All venues, On campus, Off campus) | Instructions for organizations | Accepted file type: PDF | checkbox "Only if applicable" | Active requirement switch; buttons Add requirement / Save changes | Cancel
Table "Events waiting for SAO" (tab Event requirements, list rows, cards): event title over "Event #<id> · <requester name>" | buttons View files / Hide files | Reject | Approve
  Empty: "No event submissions are waiting for review."
    Inline panel "SAO event requirements" (View files): rows "<requirement name> · <file name>" with View; empty "SAO has not listed any file requirements."; line "Review: <status>"
    Modal "Reject this event": "Remarks for rejection" (required); buttons Cancel | Reject event. Dialog "Approve this event?" (Approve event). Dialog "Remove this requirement?" (Remove requirement)
Table "Report inbox" (tab Financial reports; list rows, cards; subtitle "Only reports that completed Department Head review appear here."): icon | report title over "<ACRONYM> · <Financial Report | Income Statement> · <date>" | status pill | buttons PDF, View
  Filters: search "Search report titles"; Filters button opens: dropdown "Organization" (All organizations, "<ACRONYM> - <Name>"), dropdown "Document type" (All document types, Financial reports, Income statements), dropdown "Report status" (All statuses, Awaiting SAO review, Approved, Rejected); active chips + "Clear all"; counter "<n> financial report(s)"
  Status badges: pending_sao ("pending sao") = amber, approved = green, other = grey
  Paging: 20   Empty: "No financial reports found." / "Only reports approved by a Department Head appear here. A notification about a report deadline does not mean a report has been submitted."
  Mobile: rows stack, buttons below
    Modal "<report title>" (footer Download PDF | Reject | Approve): summary text; cards "Required signatories" (role: name) and "Supporting documents" (document name links; empty "No supporting documents were attached.")
    Modal "Reject financial report": "Rejection reason" (required, placeholder "Describe the missing or incorrect report details."); buttons Cancel | Reject report. Dialog "Approve financial report" (Approve report)
Table "Track documents" (tab Track documents; list of collapsible organization rows, cards): chevron | "<ACRONYM> - <Name>" over college or "No college assigned" | "<n> file(s)" over "Latest <date>" or "No submission date"
  Filters: "Search organizations" (placeholder "Name or acronym"); dropdown "Organization" (All organizations); dropdown "Semester" (All semesters, "AY <label> · 1st|2nd Semester · <status>"); dropdown "Document type" (All document types, Event requirements, Semestral report, Semester renewal, Financial reports, Financial report supporting documents, Registration documents); button "Clear filters"
  Paging: 20 organizations   Empty: "No documents submitted yet." / "No documents match these filters"
  Mobile: rows stack
    Expanded panel "<document type>" groups (list rows): item over "<parent title> · <file name>" over "Submitted <date> by <name>" or "Not submitted" | status badge + "With the Department Head | With the SAO | Returned by ..." | buttons Open organization review (pending registration), View. Footer "Showing <n> of <total> file(s)" + button "Load more files" (50 per load). Empty: "No files match these filters."

## Reviews > Venues (/dashboard/super-admin/venues)
Filters: tabs "Calendar" | "Booking requests" | "Venue catalog"
Calendar tab "Venue calendar": view toggle Day | Week | Month; buttons Previous <unit>, Today, Next <unit>; date input "Jump to date"; dropdown "Venue to show" (All venues, venue names); legend Approved (green solid) / Pending (amber dashed) / Conflict (red badge). No table: time grid. Empty: "No pending or approved bookings this <day|week|month>."
Table "Booking requests": Organization | Venue | Event | Requested time | Status
  Cell detail: Venue = venue name or off-campus location; Event = title or "Not linked"; Requested time = "<date>, <h:mm AM> - <h:mm PM>"; Status = badge + optional "Conflict" badge + stage sentence ("Waiting for SAO approval" | "Rejected by the SAO" | approved and withdrawn text not read)
  Filters: dropdown "Filter by status": Awaiting decision (default), Approved, Rejected, Withdrawn, All statuses; dropdown "Filter by venue": All venues, venue names; "Clear filters"; counter "<n> request(s)"
  Row actions: Reject | Approve (pending only)
  Status badges: pending = amber, approved = green, rejected = red, withdrawn = grey, Conflict = red outlined
  Paging: 20   Empty: "Nothing to review" / "No booking requests match these filters"
  Mobile: DataTable cards
    Drawer "<venue>" ("Venue request #<id>"): stepper Requested > SAO review > Approved; next-step callout; Organization | Event | Requested time | Remarks; Reject | Approve
    Modal "Approve this booking?": overlap list "<Status>: <reserved by>, <range>" or "No overlapping bookings for this venue and time."; Cancel | Approve. Modal "Reject this booking": "Remarks" (required); Cancel | Reject booking
Table "Venues" (tab Venue catalog): Venue | Location | Capacity | Status
  Cell detail: Capacity right-aligned; Status = switch + badge (Active green / Inactive grey)
  Row actions: Edit | Delete (icon)   Toolbar: "New venue"
  Paging: none (100 loaded)   Empty: "No venues added yet" (button "New venue")
  Mobile: DataTable cards
  Modal "New venue" / "Edit venue": Name * (placeholder "e.g. Main Gymnasium") | Location * (placeholder "e.g. Building A, Ground Floor") | Capacity * (hint "Number of people this venue can hold") | checkbox "Active (organizations can request this venue)"; Cancel | Add venue / Save changes. Dialog "Delete this venue?" (Delete venue)

## Reviews > Grievances (/dashboard/super-admin/grievances)
Tiles (8, click to filter): Submitted | Under review | Resolved | Dismissed | Critical | High | Medium | Low (each with a count)
Filters: dropdown "Filter by addressed to": Organization + SAO, Addressed to organizations, Addressed to SAO; dropdown "Filter by status": All statuses, Submitted, Under review, Resolved, Dismissed; dropdown "Filter by urgency": All urgencies, Critical, High, Medium, Low; dropdown "Filter by category": All categories, Safety & Security, Financial Integrity, Facilities & Maintenance, Academic / Faculty, General; "Clear filters"; counter "<n> grievance(s)"
Table "Grievances": Grievance | Urgency | Status | Filed by | Filed
  Cell detail: Grievance = title (button) over "<category> · <organization name or Student Affairs Office>"; Status = badge + stage sentence; Filed by = name or "Student <id>" + "(anonymous to org)"; Filed = relative time. Sortable: Urgency (default, Critical first), Filed
Row actions: row title opens drawer (no buttons)
Status badges: submitted = blue, under_review = blue, resolved = green, dismissed = grey; urgency: Critical = red, High = amber, Medium = blue, Low = grey
Paging: 50   Empty: "Nothing to review" / "No grievances match these filters"
Mobile: DataTable cards
  Drawer "<grievance title>" ("Filed <relative time>"): badges status, "<urgency> urgency", category; stepper + next-step callout; filer box; Addressed to; Description; Filed; Remarks; "Update status" buttons Move to under review | Resolve | Dismiss; closed text "This grievance is closed and cannot be reopened."
  Modal (title = action label): field "Remarks" (required, placeholder "What was found, and what happens next..."); Cancel | action

## Reviews > Clearances (/dashboard/super-admin/clearances)
Filters: none
No table: period cards (rows). Fields in order: title | "<academic year> · Deadline <date or not set>" | role chips (Student Affairs Office (SAO), Organization adviser, Organization treasurer, Organization president, custom) | progress meter "Students fully cleared" (cleared of total) or "Calculating progress..." | buttons "View students" and delete (icon)
Bulk/Toolbar: "New clearance period"
Status badges: role chips = grey
Paging: 20   Empty: "No clearance periods yet" (button "New clearance period")
Mobile: card rows stack, meter full width
  Modal "New clearance period": Title (placeholder "Second Semester Clearance") | Academic year (placeholder "2026-2027") | Description | Deadline | Required signatory roles (presets + "Add another role, e.g. Org Secretary" + Add); Cancel | Open this period
  Drawer "<period title>" ("<academic year> · SAO signature line"): search "Search by name or school ID..."; student cards (cards): name over school id | badge "All cleared" | compact stepper + stage text | per signature row: "<role label>" with badge (Pending amber, Cleared green, Held amber) or, for the SAO line, buttons Clear / Hold / Clear hold; pager "Showing a-b of n students"; empty "No students in this period". Modal "Hold <role>"/"Clear <role>": field "Reason" (placeholder "e.g. Unpaid organization dues")
  Dialog "Delete this clearance period?" (Delete period)

## Updates > University announcements (/dashboard/super-admin/announcements)
Filters: none
No table: announcement cards, 2 columns. Fields in order: "Student Affairs Office · Official" | title | status pill PUBLISHED / SCHEDULED / DRAFT | body (3 lines) | "<n> recipients · <scope>" | actions
Row actions: Edit draft | Delete draft (drafts only) | Archive (published/scheduled)
Status badges: PUBLISHED = green, SCHEDULED = amber, DRAFT = amber
Bulk/Toolbar: "Create official notice"
Paging: none (100 loaded)   Empty: "No official announcements yet" / "Official notices reach every user, organization, or college you choose. Publish one here."
Mobile: cards 1 column
  Modal "Create official SAO announcement" / "Edit official SAO announcement": Title | Announcement | Audience scope (All HIUSA users, All organizations, Selected organizations, All departments, Selected departments) | Organizations checkboxes (acronyms) or Departments checkboxes | "Optional role filter" chips (STUDENT, SBO OFFICER, DEPARTMENT HEAD, ADMIN) | Schedule (optional) | Expires (optional) | checkboxes Important, Pin announcement, Confirm publish; Cancel | Save draft / Publish official notice
  Dialog "Delete this draft?" (Delete draft)

## Updates > Notifications (/dashboard/super-admin/notifications)
Filters: none
No table: notification rows (full-width buttons). Fields in order: type icon | title | message | date-time | external-link icon when it has a destination; unread rows have a blue left border and tinted background
Bulk/Toolbar: "Mark all as read"
Paging: none (100 loaded)   Empty: "No SAO notifications yet" / "Registrations, submissions, and requests that need the SAO are announced here as organizations send them."
Mobile: rows stack

## Setup and records > Academic years (/dashboard/super-admin/academic-years)
Tiles: none. Card "<label> is the current year" (dates) with checklist links: "Publish this year's accreditation requirements" | "Hand over administrator roles after elections" | "Open a clearance period for the semester"
Filters: none
Table "Calendar" ("Exactly one year is current at a time."): Academic year | Dates | Status
  Cell detail: Dates = "<long date> to <long date>"; Status = blue badge "Current" else text "Completed" / "Not current"
  Row actions: Make current | Close year | Edit | Remove (icon)
  Bulk/Toolbar: "Add academic year"
  Paging: none   Empty: "No academic year set" / "Add the current academic year. Until then, accreditation follows the newest set of requirements." (button "Add academic year")
  Mobile: DataTable cards
Table "Semesters" (cards per year, no headers): heading "AY <label>" + button "Add semester"; rows "<1st|2nd> Semester" | "<dates>" | status text (upcoming / active / completed) | buttons Set as active | Close semester | delete (icon). Empty: "No semesters added."
  Modal "Add academic year" / "Edit <label>": Starts on | Ends on | Label (hint "Two consecutive years, like 2026-2027.", placeholder "2026-2027"); Cancel | Add academic year / Save changes
  Modal "Add semester to AY <label>": Semester (1st Semester, 2nd Semester) | Starts on | Ends on; Cancel | Add semester
  Dialogs: "Make this the current year" (Make current), "Complete academic year" (Close year), "Delete semester" (Delete semester), "Remove academic year" (Remove year)

## Setup and records > Audit trail (/dashboard/super-admin/audit-logs)
Filters: search "Search actor, action, module, or record ID"; Filters button opens: dropdown "Module" (All modules + modules except ledger ones), dropdown "Action category" (All actions, Create, Update, Delete, Approve, Reject, Payment, Collection, Remittance, Attendance, Status Change), dropdown "Actor role" (All actor roles, SAO, Organization Admin, SBO Officer, Department Head, Student), dropdown "Actor department" (All departments, dynamic: values on the loaded page), dropdown "Actor program" (All programs, dynamic: values on the loaded page), date "From", date "To", dropdown "Sort audit logs" (Newest first, Oldest first, User name, User role, Module, Action); active chips + "Clear all"; counter "<n> entries"
Table "Audit trail": Time | Actor | Role | Organization | Module | Action | Affected record | Record ID | Details
  Cell detail: Role = "<role label> / <position>"; Affected record = subject over 2-line description; Details = menu "Audit actions" with "View details"
Row actions: View details
Status badges: none
Bulk/Toolbar: "Export CSV" (exports every entry matching the filters)
Paging: 10   Empty: "No audit activity yet" / "Every approval, payment, event, and setting change is recorded here as people work in the system." ; filtered: "No audit activity matches these filters" / "Try a wider date range or another module."
Mobile: table keeps min width 1000 px and scrolls horizontally
  Modal "Audit record details" (header "Audit record LOG-<id>", description, "<module> · <action> · <date>"): tiles Actor | Actor role / position | Actor academic profile | Affected record | Record type | Record ID | IP address | Timestamp
    Table "Before / after changes": Field | Before | After (10 per page; min width 560 px, scrolls). Empty: "No field-level change payload was recorded for this action."

## Profile (/dashboard/profile)
No table: left card (initials avatar, full name, role pill (shows raw "SUPER_ADMIN" because the page has no label for it), position, School ID, Organization, Email address, "Protected account" note); form "Personal information": First name | Last name | Email address | Mobile number (optional); buttons Discard changes | Save profile; form "Password & security": Current password | New password | Confirm new password; checks "At least 8 characters", "New passwords match"; button Update password
Card "Notifications" (toggle rows): Announcements | Events and reminders | Elections | Merchandise orders
Card "Your recent activity" (list rows): "<action> in <module>" over record label | date-time; button "Show more"; footer "Showing <n> of <total>". Empty: "Nothing recorded yet. Registering for an event or submitting a request will show up here."
Mobile: left card stacks above the forms, fields 1 column

## Study objectives (/dashboard/objectives)
No table: print button "Print"; scope line "University-wide evidence across every organization, for the Student Affairs Office."; sections as cards: general objective banner (GO), research foundation (SO1, SO4), pillar system (SO2.1 to SO2.6), synthesis (SO3). Each objective: statement, "Mechanism: ...", evidence list (value over label, "No activity yet" when zero)
Empty: "No objectives are configured yet" / "The study team sets up the objectives catalog. Once it is in place, every objective appears here next to its live evidence."; evidence: "No evidence has been counted for this objective yet."
Mobile: cards stack

COVERAGE: 16 pages (15 nav leaves + 1 detail route), Dashboard, Agency overview, Registrations and organizations, Administrators, Colleges, Compliance, Venues, Grievances, Clearances, University announcements, Notifications, Academic years, Audit trail, Profile, Study objectives
