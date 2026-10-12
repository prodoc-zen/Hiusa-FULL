# Department Head: screen columns (HIUSA)

Shell: sidebar groups, top-level rows first, then band "College view (read only)". Footer: Profile, Study objectives. Breakpoints used below: sm 640, md 768, lg 1024, xl 1280 (Tailwind).
Status tones: success = green, warning = amber, danger = red, info = blue, neutral = grey. Primary blue #0878B7, navy #0F2F62, border #DDE7EF.

## (top level) > Dashboard (/dashboard/department-head)
Tiles: Returned | Pending review | Active | Archived (college organizations by status, each a link to Organizations?status=..., Returned shows "Action needed" in red when count > 0)
Tiles: Active Elections | Closed Elections | Upcoming Events | Pending Approvals (section "Oversight snapshot")
Briefing block (RoleBriefing, above the tiles): header "Good <morning|afternoon|evening>, <first name>" + weekday, "Department Head", scope; headline; button "Review approvals"; list "Needs attention"; collapsed section "Organization indicators" (pillar tiles Finance | Events | Elections | Comms, each: label, value, context, delta, meter; labels are server data); section "What HIUSA noticed" (AI insight cards).
Banner: "<n> item(s) awaiting your approval" + "Events, elections, and first-stage financial reports need your sign-off." + "Review" (only when n > 0)
No table: dashboard cards and lists.
  List "Needs attention" (cards): severity badge | title | detail | waiting-on line | due time | "Open"
  List "Upcoming Events" (cards, max 4): title | "<date> - <location>" | status chip (capitalised raw status: upcoming, approved)
  List "Pending Approvals by Type" (cards, max 3): title | "<Type> · <date>"; then bars: Type label | "<count> (<pct>%)"
  List "Recent Announcements" (cards, max 3): title | body (2 lines)
  Card "Active Election": "Active Election" | title | "<date> to <date>" | LIVE | buttons "View Details", "View Results"
Row actions: link "Manage organizations"; links "View all", "Review"
Status badges: severity High = red, Medium = amber, Low = blue, Notice = grey; LIVE = blue solid
Empty: "No student organizations yet" (desc "Register your first student organization. It goes to the SAO for review, and you follow it from here." + button "Register an organization"); "No Active Election" / "No elections are currently running."; "No upcoming events."; "Nothing awaiting your review."; "No announcements yet."; "Nothing is waiting on you" / "New approvals, deadlines, and alerts will show up here first."
Mobile: tiles 1 column (2 at sm, 4 at xl); two-column body collapses to one column below xl.

## (top level) > Approvals (/dashboard/department-head/approvals)
Tiles: none (summary line "<n> matching request(s) · <n> awaiting action")
Filters: search "Search requests" placeholder "Search requester, ID, remarks..."; select "Request type" [All request types, Event, Budget, Election, Announcement, Payment, Financial Report]; select "Organization" [All organizations, <college organizations>]; date "Requested from"; date "Requested to"; select "Sort order" [Newest first, Oldest first]
Tabs (toggle buttons): Pending (<n>) | All History
Table "Requests to review" (cards, list with no headers), fields in order: type icon | title | type chip | organization chip | status badge | summary line | "Requested by <First Last> (<school id>) | <date time>" | requester profile "<role> · <position> · <program> · <year> · <section>" | stage stepper (events, budgets, elections, financial reports) + stage text + "Waiting on <role>" | "Remarks: <text>" (decided only)
Row actions: Review (when you can decide) or Details; Open event | Open budget | Open election | Open report
Status badges: pending = amber, approved = green, rejected = red
Bulk/Toolbar: Reset, Export CSV ("Exporting...")
Paging: 20 per page (pager "Showing a-b of n requests", prev/next, page numbers; n/N on mobile)   Empty: "Nothing to review" ("Events, budgets, elections and financial reports from the organizations in your college appear here for your decision. The organization Admin sends them."); history: "No approval history yet" ("Requests you approve or reject are listed here afterwards."); filtered: "No requests match these filters" ("Try a different type, date range or search.")
Mobile: filters 1 column (2 at md, 7 at xl); row actions wrap under the row below lg; pager shows n/N.
  Drawer "Approval request" (title = request title, subtitle "Request #<id> · <Type>"): stepper; next-step callout; receipt rows (label : value): Request number | Organization | Type | Status | Required role | Requester | School ID | Email | Role / position | Department | Academic profile | Submitted | Record ID; "Record summary"; list "SAO event files" (events: "<requirement>: <file name>"); financial reports: button "Download submitted report", "Required signatories" (<role>: <name>), "Supporting documents" (file buttons, "No supporting documents."); list "History" (Requested by <name> + time; "Waiting for <role> to decide" or "Approved|Rejected by <name>" + time + "Remarks: <text>"). Footer: Open event|budget|election|report, Reject, Approve.
  Dialog "Approve|Reject "<title>"": receipt (adds Reviewer, Reviewed), textarea "Remarks (optional)" or "Remarks (required)", placeholders "Optional note for the requester..." / "e.g. Budget not yet finalized."; buttons Cancel, Approve|Reject ("Processing...").
  Drawer empty: "This request is not available to you".

## (top level) > Organizations (/dashboard/department-head/organizations)
Tiles: college header card (logo, college name, "Department Head: <name>")
Filters: tabs All (<n>) | Returned (<n>) | Pending review (<n>) | Active (<n>) | Archived (<n>)
Table "Organizations of your college": Organization | Status | Admins | SBO Officers | Students | Submitted | Actions
  Cell Organization: org mark, name, acronym, registration line + compact stepper (Registered > SAO review > Administrator > First use), red "SAO remarks" box (returned), "Archived by the SAO. Read only." (archived)
Row actions: View checklist; Edit and resubmit (returned only); Withdraw (pending or returned)
Status badges: Returned = red, Pending review = amber, Active = green, Archived = grey
Bulk/Toolbar: header button "Register an organization"
Paging: none (all rows loaded)   Empty: all: "No organizations yet" ("Register your first student organization. The SAO reviews it, then provides its administrator." + button "Register an organization"); per tab: "No <status> organizations" ("Choose another status to see the rest of your college.")
Mobile: below md each row becomes a card (label/value pairs for Organization, Status, Admins, SBO Officers, Students, Submitted) with the action buttons under it, 42 px high.
  Drawer "<organization name>" (subtitle acronym): status badge + "Submitted <date>"; stepper; next-step callout; list "Leadership" (cards: name | "Admin|SBO Officer[, position]", empty "No Admin or SBO Officer is assigned yet."); counters Admins | SBO Officers | Students; list "Requirement checklist" (requirement name | file name or "No file" | status badge; empty "No registration documents are on file."); button Close. Checklist badges: Submitted = blue, Approved = green, Returned = red, Not submitted = grey.
  Dialog "Register an organization" (also "Edit and resubmit <name>"): fields Organization name*, Acronym*, Description (optional), Pick a color + Color (placeholder #0B8ED0); section "Registration requirements" note "PDF only, up to 10 MB each." (+ "Academic year <ay>, semester <n>."); list of requirements, each: name* | description | "Due <date>" | PDF file chooser | "Selected: <file> (<size>)" | on resubmit "Current file: <file> (<status>)"; resubmit shows red "SAO remarks" box; notice when no semester: "No registration requirements are open. The SAO must activate a semester first."; footer Cancel, Submit for review (resubmit: Resubmit to SAO).
  Dialog "Withdraw this registration?": buttons Withdraw registration, Keep registration.

## College view (read only) > Finance > Budgets (/dashboard/finance/budget-allocation)
Tiles: strip "Ledger net balance" (single figure)
Filters: select "Organization" [All organizations, <college organizations>]; banner "View only. You can review and export these records; the organization admin records and changes them."
Table "Budgets" (cards, section heading "Budgets", sub "Review allocations, where each budget is in approval, and the funds left to spend"), fields in order: title | status badge | stepper (Proposed > Second review > Approved > Spending > Reported) + next-action text | linked event title | "Semester: <name>" | Allocated | Remaining | Warning at | "<high|medium|low> overspending risk" | "AI recommended allocation <₱> · Safe spending ceiling <₱>" | advisory note
Row actions: View details
Status badges: pending = amber, approved = green, rejected = red; risk text high = red, medium = amber, low = green
Paging: none   Empty: "No budgets to show yet" ("Only the organization Admin proposes budgets. They appear here, with their approval stage, once the Admin proposes one.")
Mobile: cards stack; Allocated/Remaining/Warning at in 2 columns; buttons wrap.
  Drawer "<budget title>" (subtitle "<event> · Semester: <name>"): stepper; next-step callout; Allocated | Remaining | Warning at.

## College view (read only) > Finance > Ledger (/dashboard/finance/financial-ledger)
Tiles: Income | Expenses | Net balance | Ledger entries
Filters: search "Search transactions..." (Enter submits); select "Organization" [All organizations, ...]; button "Filters" opens: select "Filter by academic semester" [All semesters, "AY <label> · 1st|2nd Semester (<status>)"], select "Filter by transaction type" [All types, Income, Expense], select "Filter by event" [All events, <events>], date "Filter from date", date "Filter to date", button Apply; chips "Active ..." + "Clear all"; count "<n> transaction(s)"
Table "Ledger" (sub "Income and expenses, with their source and receipt"): Date | Description | Source | Payer / Recorder | Category | Type | Amount
  Column visibility: Source and Payer / Recorder from lg; Category from md; below lg their content moves under Description. Description cell: description + receipt label. Amount: "+₱..." or "-₱...".
Row actions: none for this role (Actions column is Admin only)
Status badges: Type Income = green pill, Expense = grey pill; Category = outlined pill
Bulk/Toolbar: none on this tab (export lives in Financial reports)
Paging: 10 per page (server fixed; pager "Showing a-b of n", "1 / N", prev/next, shown only when total > 10)   Empty: "No transactions to show yet" ("Only the organization Admin records transactions. Verified collections, cash advances, paid charges and orders post here by themselves."); filtered: "No matching transactions" ("Try a different search or clear the filters.")
Mobile: below md a list of cards: description | date · category | amount; source line | receipt label | "Payer: <name>" | "Recorded by <name>".

## College view (read only) > Finance > Financial reports (/dashboard/finance/transaction-history)
Tiles: strip "Ledger net balance"
Filters: select "Organization"; banner "View only..." (same as Budgets). Report history filters: search "Search reports" (aria "Search report history"); select "Filter reports by status" [All statuses, draft, pending department head, pending sao, approved, rejected]; select "Filter reports by document" [All documents, Financial report, Income statement]; select "Filter reports by event" [All events, <events>]
Cards "Full Transaction Log" ("Complete ledger of all recorded transactions") and "Category Breakdown" ("Spending totals grouped by category and type"), each chip "All time" + buttons "Export Excel", "Print / Save PDF"
Table "Financial reports" (cards, sub "Each saved report moves from draft to the Department Head, then the SAO."), fields in order: title | generated date | summary text | chip "Financial Report|Income Statement" | status chip (draft, pending department head, pending sao, approved, rejected; grey) | stepper (Draft > Department Head > SAO > Approved) + next-action text
Row actions: View details; Export Excel; Download PDF; Preview / print
Status badges: grey capitalised text for all statuses
Paging: none   Empty: "No saved reports to show yet" ("Only the organization Admin prepares financial reports. They appear here, with their approval stage, once saved."); filtered: "No saved reports match these filters" ("Try a different search or clear the filters.")
Mobile: cards stack; next-action text hidden below sm; buttons wrap.
  Drawer "<report title>" (subtitle "<Financial report|Income statement> · Generated <date>"): stepper; next-step callout; summary text. (The "Prepare a report" form is Admin only, not shown.)

## College view (read only) > Finance > Forecast (/dashboard/finance/financial-insights)
Tiles: strip "Ledger net balance"
Filters: select "Organization"; banner "View only..."
No table: panel "Forecast" ("OLS projections based on monthly transaction history") with a chart and one card per forecast; side panel "Summary by Category".
  Cards (per forecast): "Forecast for <period>" | "Balance <₱>" | Income | Balance | Safe spend | Risk | engine badge | chips "<n> sample months", "<n> with recorded transactions", "Income fit R² <x>", "Expense fit R² <x>", "Fit quality: <q>" | weak-confidence note | confidence note
  List "Summary by Category": category | type (income|expense) | total; empty "No category data available."
Row actions: none for this role (Generate forecast, Delete forecast are Admin only)
Status badges: Risk text; weak confidence = amber note; clamp notice = red note
Paging: none   Empty: "No forecasts to show yet" ("Only the organization Admin generates forecasts. They appear here once one is generated.")
Mobile: forecast metrics 2 columns (4 at sm); panels stack below xl.

## College view (read only) > Calendar (/dashboard/events/activity-calendar)
Tiles: Total Events ("This academic year") | Upcoming ("Scheduled") | Completed ("Successfully held") | Total Tasks ("Across all events")
Filters: select "Academic period" [Active period, "AY <label> · 1st|2nd Semester · <status>"]; view switch "List view" | "Calendar view" (opens on Calendar)
Calendar: month title, buttons "Previous month", "Today", "Next month"; weekday headers Sun | Mon | Tue | Wed | Thu | Fri | Sat; day cells with count badge, up to 2 event chips, "+n more"; selecting a day opens panel "<weekday, month day, year>" listing events (title, description, time, location, status chip); empty month "No events scheduled for <Month Year>."; empty day "No events scheduled on this day."
Table "Events" (List view): Event | Organizer | Schedule | Venue | Attendance | Tasks | Status | Actions
  Cells: Event = title + description; Organizer = name + position/role; Schedule = start + "Ends <time>"; Venue; Attendance = "<n> present/late" + "<n> total records"; Tasks = "<n> linked" + "Workflow tasks"; Status = badge + stepper (Proposal > Department Head approval > SAO files > Funding > Prepare > Run > Report; SAO files step only when the event needs SAO files) + "Returned: <remarks>". ("Budget Status" column is Admin only.)
Filters (List view): search "Search events"; button "Filters" opens date "Event date", select "Status" [All statuses, Pending Approval, Approved, Ongoing, Completed, Cancelled], select "Sort by" [Soonest, Latest date, Newest created, Title]; count "<n> event(s)"
Row actions: menu "Event actions" > View event (cards: View details)
Status badges: Pending Approval (planning) = amber (may read as stage text: Not submitted, Waiting for Department Head, SAO files needed, Waiting for SAO, Returned by SAO, Returned by Department Head), Approved/Upcoming/Ongoing = blue, Completed = green, Cancelled = red
Paging: 10 per page, options 10 | 25 | 50 ("Per page"), List view only   Empty: "No events from your college yet" ("Events that organizations propose appear here, and the ones waiting for your decision are in Approvals." + button "Open approvals"); filtered: "No events match these filters" ("Change the search, date or status, or clear the filters to see every event in this period.")
Mobile: below sm the calendar grid becomes a day agenda (cards with "<n> events" and event buttons); List view is cards below lg (title, status, stepper, Schedule, Venue, Operations "<n> present / late · <n> tasks", button "View details").
  Dialog "Event details": image; status badge; title; event stepper; "SAO event requirements" panel (uploaded files "<requirement> · <file name>" + View; "SAO has not listed any file requirements."); lines Schedule, Location, Event type, Expected participants, Description; tiles "Preparation progress", "Attendance Summary" (Present | Late | Excused | Absent), "Approval stage"; "Planning Details" (Requirements, Resources, Budget requirements, Vendor deadlines, Logistics checklist); "Approval remarks".

## College view (read only) > Election results (/dashboard/elections/election-results)
Tiles: Total elections | Live voting | Awaiting approval | Closed (election picker, shown until an election is open)
Filters: select Academic period [Active period, ...]; search "Search by election title..."; select "Filter elections by status" [All statuses, Pending approval, Upcoming, Live, Closed]
Table "Elections" (picker, cards, 2 columns from lg), fields in order: cover image | status badge | title | timeline ("Awaiting Department Head review", "<n> hours remaining", "Starts in <n> hours", "Ended <date>", "Returned by the Department Head") | stepper (Submitted > Build ballot > Ballot locked > Voting > Results) + "Next: <text>" | start and end date-time | room or "Online ballot" | Positions | Candidates | Votes
Row actions: Open election; Informative letter (link)
Status badges: Pending Approval = amber, Upcoming = blue, Live = green, Closed = grey, Returned = red
Paging: 6 per page   Empty: "No elections yet" ("Only the Admin creates elections. It appears here once the Department Head approves it."); filtered: "No elections match" ("Try another search or status.")
Mobile: cards 1 column; pager shows n/N.
  Workspace header after opening: button "Change election"; description "You approve elections for your college and read their results."; election title, status chip (Pending approval, Upcoming, Voting open, Closed, Returned), "<date> to <date>"; stepper; next-step callout. Step strip is hidden for this role (only Results).
  Results view: "Available results" picker cards (when more than one: "Final results|Live totals", title, dates, "<room> · <n> minutes"); hero: "Official final results|Live vote totals", title, tiles Ballots | Selections | Positions | Candidates; "Winner spotlight" cards (WINNER, name, position, "<n> votes · <partylist>"); filter chips "All positions" | <position titles>; per position card: "Ballot position", title, "Votes cast" total, optional VS head-to-head, candidate rows (portrait, name, partylist, votes, %, bar, WINNER tag).
  Not released: "Election results are not available yet." ("Vote totals appear once the finalized ballot opens. Winners are declared after closing."); "No candidate result data is available."; "No result data is available for this position."

## College view (read only) > Announcements (/dashboard/announcements/view-announcements)
Tiles: none
Filters: search "Search announcements"; select "Announcement category" [All categories, General, Election, Training, Events, Merchandise]
No table: single-column feed of cards (max width 2xl): header "<organization name | Student Affairs Office>" + date | title | body | image | button "Like"/"Liked" + count
Row actions: Like / Liked
Paging: 20 per page (pager label "announcements")   Empty: "No announcements yet" ("Your officers post them here."); filtered: "No announcements match" ("Try a different search or category.")
Mobile: same single column; filters stack (search then category); pager shows n/N.

## (footer) > Profile (/dashboard/profile)
No table: left card (initials, name, role chip "Department Head", position, School ID, Organization, Email address, "Protected account"); right sections "Personal information" (First name, Last name, Email address, Mobile number (optional); Discard changes, Save profile), "Password & security" (Current password, New password, Confirm new password; checks "At least 8 characters", "New passwords match"; Update password), "Notifications", "Your recent activity".
  List "Notifications" (switch rows): Announcements | Events and reminders | Elections | Merchandise orders (label + detail + toggle)
  List "Your recent activity": "<action> in <module>" | record label | date time; button "Show more"; "Showing <n> of <total>"; empty "Nothing recorded yet. Registering for an event or submitting a request will show up here."
Mobile: two columns collapse to one below lg; form fields 1 column below sm.

## (footer) > Study objectives (/dashboard/objectives)
No table: read-only report of the study objectives with live evidence, button "Print"; scope sentence "Evidence scoped to <organization> only." Sections: general objective banner "GO: <title>", "Research foundation" (SO1, SO4), "SO2: one system, six areas" (SO2.1 to SO2.6), synthesis "SO3: <title>". Cards only, no headers.
Empty: "No objectives are configured yet" ("The study team sets up the objectives catalog. Once it is in place, every objective appears here next to its live evidence.")
Mobile: cards stack in one column.

COVERAGE: 12 pages, Dashboard, Approvals, Organizations, Budgets, Ledger, Financial reports, Forecast, Calendar, Election results, Announcements, Profile, Study objectives
