# SBO Officer: screens and table columns

SHARED (not repeated below)
- Row actions menu: kebab button labelled "Actions" (or the named label) opening a menu of items; danger items red.
- Pager (PaginationControls): "Showing a-b of n <label>", prev/next arrow buttons, numbered page buttons; under 640 px it collapses to prev, "page/total", next. Hidden when total fits one page.
- Filter bar (TableFilterBar): search box with clear X, "Filters" toggle (count badge) opening a grid of selects, "Active" chips with "Clear all", result count at right.
- Badge tones: green = success, amber = warning, red = danger, blue = info, grey = neutral.
- DataTable (used where noted): under 768 px each row becomes a card of "COLUMN: value" pairs with row actions at the bottom.
- Top bar on every page: search, Cart button ("Cart" panel), Notifications bell, account menu.

## Dashboard > Dashboard (/dashboard/officer)
Tiles: Open Tasks (Pending and in progress) | Upcoming Events (Scheduled and approved) | Completed Tasks (Finished assignments) | Pending Orders (Merchandise awaiting action)
Briefing above tiles: greeting "Good <time of day>, <first name>" + date, role, organization + headline; "Getting started" checklist (progress "n of m done", "Hide checklist", "Show all n steps"); "Your work queue" list rows [severity badge High/Medium/Low | title | detail | due | Open]; collapsible "Organization indicators" (Events, Tasks, Merchandise, Communication, Finance: label, value, context, delta, meter); "What HIUSA noticed" insight cards.
Table "Urgent Tasks" (next 4 open tasks by deadline, link "View all"): Task | Assignee | Deadline | Status
Status badges: Pending = amber, In Progress = light blue, Completed = green, Overdue = red
No table: "Task Status Distribution" = 4 bars (Pending, In Progress, Completed, Overdue) each "count (pct%)"
Toolbar: "Quick Actions" tiles: My tasks | Check-in | My Receipts | New announcement
Empty: "No open tasks. You're all caught up!" ; distribution "No tasks recorded yet." ; first run "No work has been assigned to you yet" + button "Open My tasks"; work queue "Nothing is waiting on you"
Mobile: tiles 1 column; Urgent Tasks table scrolls sideways (min 560 px); quick actions 2 columns.

## Events and tasks > Check-in (/dashboard/events/check-in)
Tiles: none on the list; line "n events open for check-in". After selecting an event: Currently inside (Not checked out) | Attendance records (Total arrivals) | Late (After start) | Check-in rate (of n expected / No target set)
Filters: attendance log: search "Search attendee or academic profile"; select "Filter attendance status" (All statuses, Present, Late, Excused, Absent)
Layout: left list "Event queue" (cards: title, start time, location) | right panel "Choose an event to begin"
  Event queue cards: cards [status dot, title, start time, location]
Table "Attendance log" (shows "n matching"): Member | School ID | Academic Profile | Method | Status | Check In / Out | Recorded By
Row actions: none
Status badges: Present = green, Late = amber, Excused = blue, Absent = red; Method: Biometric = blue, Manual = green; event chip: Pending Approval = amber, Approved/Ongoing = blue, Completed = green, Cancelled = red; "Live now" green text
Bulk/Toolbar: "Refresh live data", "Export CSV"; panel "Door controls": "Fingerprint check-in / checkout" card (reader status, optional filters year-level checkboxes, selects "Fingerprint program filter" All programs / "Fingerprint section filter" All sections, button "Scan Fingerprint", "Cancel"); "Manual check-in" card (search "Search name or School ID", select Attendance status Present/Late/Excused/Absent, button "Confirm Check-In")
  Drawer "Confirm Fingerprint Check-In / Checkout" (dialog): "Is this the correct Student?" name, Action, Match score; buttons "No, Scan Again" | confirm
Paging: 10   Empty: "No events ready for check-in" ; "No event is ongoing right now." ; "No attendance records yet" ; "No attendance records match the filters."
Mobile: attendance log becomes cards [name, School ID, status badge, Check-in, Method, academic profile] below 1024 px; event list and detail stack with "All Events" back button.

## Events and tasks > Calendar (/dashboard/events/activity-calendar)
Tiles: Total Events (This academic year) | Upcoming (Scheduled) | Completed (Successfully held) | Total Tasks (Across all events)
Filters: select "Academic period" (Active period, "AY <label> · 1st/2nd Semester · <status>") when periods exist; view switch List | Calendar (default Calendar); List view filter bar: search "Search events"; Event date (date); Status (All statuses, Pending Approval, Approved, Ongoing, Completed, Cancelled); Sort by (Soonest, Latest date, Newest created, Title)
Calendar view: month title, buttons "Previous month", "Today", "Next month"; grid Sun Mon Tue Wed Thu Fri Sat; day click opens day panel (event cards: image, title, description, time, location, status chip); empty "No events scheduled for <Month Year>." ; day panel empty "No events scheduled on this day."
Table "Events (List view)": Event | Organizer | Schedule | Venue | Attendance | Tasks | Status | Actions
Row actions ("Event actions"): View event
Status badges: Pending Approval = amber, Upcoming/Approved/Ongoing = blue, Completed = green, Cancelled = red; Returned note red
Paging: 10 (selector 10, 25, 50, label "events")   Empty: "No events yet" (restricted: "Only your organization's Admin can propose events. Approved events appear here with their tasks and check-in.") ; filtered "No events match these filters"
  Drawer "Event details" (centered dialog): status chip, title, stepper, Schedule, Location, Event type, Expected participants, Description, Preparation progress, Attendance Summary (Present, Late, Excused, Absent), Approval stage, Planning Details; panel "Registrations": progress "Seats taken" ("n of cap · n left") or "n registered...", tiles Registered | Attended | No-show | Cancelled, list [name, program · year · section · registered time, badge Registered blue / Attended green / No-show amber / Cancelled grey], pager "Page n of m · total" Previous | Next; empty "No one has registered yet. Students see a Register button on this event once it is approved."
Mobile: month grid replaced by one card per day that has events; list view rows become cards below 1024 px with buttons "View details".

## Events and tasks > Venue booking (/dashboard/venues)
Tiles: none
Filters: card "Find a venue": select Venue ("<name> - capacity n"), From (date), To (date); date strip (one button per day up to 14, dots Reserved/Pending)
No table: availability timeline 5 AM to 10 PM with slots + list "Pending request from <org>" / "Reserved by <org>" ; empty "No bookings on this date." ; legend Reserved (navy), Pending (amber)
Table "My organization's requests": Venue | Event | Requested time | Status | SAO remarks | Actions
Row actions: Withdraw (button, only when pending or future approved)
Status badges: Pending = amber, Approved = green, Rejected = red, Cancelled = red, Withdrawn = grey; stage text under badge
Bulk/Toolbar: header "Request an off-campus venue" (secondary), "Request a venue" (primary), "Request this venue" (in card)
Paging: 20 (label "requests")   Empty: "No booking requests yet" ; "No venues available yet"
  Drawer "<venue> / Venue request #id": stepper "Venue booking progress", NextStep, Event, Requested time, SAO remarks, button "Withdraw request"
  Dialog "Request a venue booking": Venue type (On campus / Off campus), Venue or Off-campus location, Start, End, "Link to an event" (Not linked to an event), buttons Cancel | Send request
  Dialog "Booking request sent": Venue request #id, Venue, Requested time, Status
Mobile: DataTable becomes cards below 768 px.

## Events and tasks > My tasks (/dashboard/tasks/assigned-tasks)
Tiles: Total Tasks | Event-Related (Linked to an event) | Standalone (Organization work) | Pending (Awaiting work) | In Progress (Active assignments) | Completed (Successfully done) | Overdue (Past deadline)
Filters: select "Academic period" (when periods exist); search "Search tasks, assignees, or events"; selects: "Filter tasks by status" (All statuses, Pending, In Progress, Completed, Overdue), "Filter tasks by event" (All events), "Filter tasks by type" (All task types, Event-related, Standalone), "Filter tasks by priority" (All priorities, Low, Medium, High, Critical), "Filter tasks by deadline" (date)
Table "Assigned Tasks" (subtitle "View and update your assignments"): Task | Assignee / Position | Academic Profile | Related Event | Type / Progress | Deadline | Status | Assigned By / Dates | Action
Row actions: buttons "Start" (pending) and "Complete" (in progress or overdue) plus menu "Task actions": View task | Start task | Complete task
Status badges: Pending = grey, Ready = blue, In Progress = blue, Completed = green, Overdue = red, Blocked = amber; stepper under status
Bulk/Toolbar: Export
Paging: 10 (server, label "tasks")   Empty: "Nothing assigned to you yet" ("Your Admin delegates tasks here.") ; filtered "No tasks match these filters"
  Drawer "Task details" (dialog): title, Event task/Standalone task, Due, stepper "Task stages", NextStep, Description, Related Event, tiles Assigned officer | Priority | Category | Required position | Progress | Academic period; form "Add Progress Update" (Progress (%), Update note "Describe what changed...", button "Save Progress Update"); "Progress History" list [status · %, time, note, By <name>]; empty "No progress updates yet."
  Dialog "Confirm Task Completion": Cancel | confirm
Mobile: table becomes cards below 1024 px [title, Event task/Standalone, description, status, stepper, Assignee, Deadline, Related event, progress bar, buttons View details / Start / Complete].

## Events and tasks > AI delegation (/dashboard/tasks/ai-delegation)
Tiles: same 7 tiles as My tasks
Filters: select "Academic period"
No table: card "AI Task Suggestions" ("Weighted officer fit scoring, per task"): collapsible "Full officer ranking" (engine badge; per officer: name, Recommended chip, tier chip, Position / Workload / Performance / Recency scores with weight %, explanation); task cards [title, "Recommended: <name>", engine badge, Role | Workload | Performance | Recency scores, note]; empty "Create a task to generate an eligible officer recommendation and score breakdown." ; side card "How AI Delegation Works" (3 bullet rules) + "Eligibility rules for the latest request"
Mobile: two cards stack.

## Finance (view only) > Budgets (/dashboard/finance/budget-allocation)
Tiles: none; banner "View only. You can review and export these records; the organization admin records and changes them."; strip "Ledger net balance" <amount>
Table "Budgets": cards (no header row): title + status badge, stepper, event, "Semester: x", Allocated | Remaining | Warning at, "<risk> overspending risk", "AI recommended allocation x · Safe spending ceiling y", advisory note
Row actions: View details
Status badges: pending = amber, approved = green, rejected = red; risk text high red / medium amber / low green
  Drawer "<budget title>": stepper "Budget progress", NextStep, Allocated | Remaining | Warning at
Paging: none   Empty: "No budgets to show yet" ("Only the organization Admin proposes budgets. They appear here, with their approval stage, once the Admin proposes one.")
Mobile: cards stack, buttons wrap.

## Finance (view only) > Ledger (/dashboard/finance/financial-ledger)
Tiles: Income | Expenses | Net balance | Ledger entries
Filters: search "Search transactions..." (Enter applies); Filters panel: select "Filter by academic semester" (All semesters, "AY <label> · 1st/2nd Semester (active/closed)"), "Filter by transaction type" (All types, Income, Expense), "Filter by event" (All events), "Filter from date", "Filter to date", button Apply
Table "Ledger" (Income and expenses, with their source and receipt): Date | Description | Source | Payer / Recorder | Category | Type | Amount   (Source and Payer / Recorder only at 1024 px and wider; Category only at 768 px and wider)
Row actions: none for officer
Status badges: Income = green, Expense = grey; amount green "+" or dark "-"
Paging: 10 (own prev/next "Showing a-b of n", "page / total")   Empty: "No transactions to show yet" ("Only the organization Admin records transactions. Verified collections, cash advances, paid charges and orders post here by themselves.") ; filtered "No matching transactions"
Mobile: list items [description, date · category, signed amount, source, receipt label, "Payer: x", "Recorded by x"] below 768 px.

## Finance (view only) > Financial reports (/dashboard/finance/transaction-history)
Tiles: none; banner "View only..."; strip "Ledger net balance"
Filters: search "Search reports"; selects "Filter reports by status" (All statuses, draft, pending department head, pending sao, approved, rejected), "Filter reports by document" (All documents, Financial report, Income statement), "Filter reports by event" (All events)
No table: two export cards "Full Transaction Log" ("Complete ledger of all recorded transactions", chip "All time") and "Category Breakdown" ("Spending totals grouped by category and type", chip "All time"), each with buttons "Export Excel", "Print / Save PDF"
Table "Financial reports" (cards): title | date | summary | chips [Financial Report/Income Statement, status] | compact stepper | next-action text
Row actions: View details | Export Excel | Download PDF | Preview / print
Status badges: draft grey; other statuses grey chip, stage in stepper
  Drawer "<report title>": stepper "Financial report progress", NextStep, summary text
Paging: none   Empty: "No saved reports to show yet" ("Only the organization Admin prepares financial reports. They appear here, with their approval stage, once saved.") ; filtered "No saved reports match these filters"
Mobile: export cards stack; report buttons wrap.

## Finance (view only) > Forecast (/dashboard/finance/financial-insights)
Tiles: none; banner "View only..."; strip "Ledger net balance"
No table: card "Forecast" ("OLS projections based on monthly transaction history"): line chart + cards [ "Forecast for <period>", Balance, Income, Balance, Safe spend, Risk, engine badge, "n sample months", "n with recorded transactions", "Income fit R² x", "Expense fit R² x", "Fit quality: x", warnings ]; side card "Summary by Category" rows [category, type, total]; empty side "No category data available."
Status badges: warning amber, clamp notice red
Empty: "No forecasts to show yet" ("Only the organization Admin generates forecasts. They appear here once one is generated.")
Mobile: two columns stack.

## Top level > Members and fingerprints (/dashboard/admin/users)
Tiles: Students | Fingerprint directory (Attendance use only)
Filters: search "Search name, school ID, program, or email"; selects: role (All roles, Student), "Filter by program" (All programs), "Filter by year level" (All year levels), "Filter by section" (All sections), "Filter by account status" (All account statuses, Active, Inactive, Disabled), "Sort users" (Name A-Z, School ID, Program / Year / Section, Newest accounts)
No table (above): donut "Filtered user distribution" + section distribution chart
Table "Users": School ID | Name | Role | Program / Major | Year Level | Section | Status | Actions
Row actions ("Actions for <name>"): View profile | Enroll fingerprint / Re-enroll fingerprint | Verify identity (1:N)
Status badges: Active = green check icon, Inactive = red cross icon; fingerprint-enrolled icon (blue)
Bulk/Toolbar: none for officer (no Export, Import, New User)
Paging: 10 (label "users")   Empty: "No users found." ; "No users on this page."
  Drawer "User Profile" (dialog): identity card, tiles Email | Contact number | Role | Account status | Department | Course / Program | Year level | Major / Specialization | Section | Organization position
  Dialog "Verify Fingerprint Identity", "Remove Fingerprint Enrollment" (enrollment flow dialogs; fields not documented here)
Mobile: cards below 768 px [name, School ID, actions, chips Role / Active / Fingerprint enrolled, Program / Major, Year level, Section].

## Voting > Candidates (/dashboard/elections/manage-candidates)
Screen "Election picker" (shown until an election is opened; same for Voters and Results): tiles Total elections | Live voting | Awaiting approval | Closed; search "Search by election title..."; select "Filter elections by status" (All statuses, Pending approval, Upcoming, Live, Closed); select "Academic period"; election cards [banner image, status chip Pending Approval amber / Upcoming blue / Live green / Closed grey / Returned red, title, timeline, stepper, dates, room or "Online ballot", Positions | Candidates | Votes, button "Open election", link "Informative letter"]; Paging: 6 (label "elections"); Empty: "No elections yet" ("Only the Admin creates elections. It appears here once the Department Head approves it.")
Workspace header after opening: "Change election" button, election title, status chip (Pending approval amber, Upcoming blue, Voting open green, Closed grey, Returned red), date range, stepper "Election progress", NextStep, step strip "1. Candidates  2. Voters  3. Results"
Tiles: none; line "n candidates registered for <title>"
Filters: chips All + one chip per position
Table "Candidates": cards (no header row) [photo or initials, name, position, party list chip (or "Independent"), "View candidate details" (campaign platform)]
Row actions: Edit | Remove
Bulk/Toolbar: "Add Candidate" (hidden when election closed or votes cast; banner "Candidate setup is locked because votes have already been cast.")
Paging: none   Empty: "No candidates yet for this election."
  Dialog "Add Candidate" / "Edit Candidate": Student * (search "Search student...", "No students found."), Position * ("Select a position..."), Party List ("Independent" + names), Candidate Photo, Platform Statement ("Candidate's platform and vision..."), Cancel | Add Candidate / Save Changes
  Dialog "Remove Candidate": "Are you sure you want to remove this candidate from the election?"
Mobile: cards one column (two at 1280 px).

## Voting > Voters (/dashboard/elections/manage-voters)
Tiles: Total Voters | Voted (n% turnout) | Not Yet Voted (Still pending) | Election Status (Current state)
Filters: search "Search by name or school ID..."; toggle buttons All | Voted | Not Yet
Table "Voters: <election title>": Name | School ID | Role | Email | Vote Status   (Role from 1024 px, Email from 768 px)
Row actions: none
Status badges: Voted = blue with check, Not Yet = grey
Paging: 10 (server, label "voters"); search applies to the loaded page only   Empty: "No eligible voters are registered in this organization yet." ; "No voters match your search." ; "No voters on this page match your search. Search and filters apply to the current page."
Mobile: table scrolls sideways (min 350 px) with Role and Email hidden.

## Voting > Results (/dashboard/elections/election-results)
Tiles: Ballots | Selections | Positions | Candidates (in hero card; badge "Official final results" or "Live vote totals")
Filters: heading "Available results" election buttons when more than one ("Final results"/"Live totals"); "Filter by position" buttons: "All positions" + one per position
No table: "Winner spotlight" cards [portrait, WINNER chip, name, position, "n votes · party"]; per-position cards "Ballot position <title>" with "Votes cast n", head-to-head strip for top two, candidate rows [portrait, name, WINNER chip, party list, votes, pct%, progress bar]
Status badges: winner amber chip
Empty: "No candidate result data is available." ; "No result data is available for this position." ; locked "Election results are not available yet." ("Vote totals appear once the finalized ballot opens. Winners are declared after closing.")
Mobile: cards one column; position filter scrolls sideways.

## Store > Orders (/dashboard/merchandise/manage-orders)
Tiles: Pending review (<amount> awaiting approval) | Ready for pickup (Approved orders with active tokens) | Claimed (Orders released to buyers) | Collected (<n> paid orders)
Filters: status tabs All orders | Pending review | Ready for pickup | Claimed | Cancelled; button "More filters"; search "Search order, student, item, reference..."; selects "Merchandise item" (All merchandise), "Sort orders" (Newest first, Oldest first, Highest amount, Lowest amount, Student name, Merchandise item, Order status); advanced: "Program or course" (All programs), "Major or specialization" (All majors), "Year level" (All year levels, 1st to 4th Year), "Section" (All sections), "User role" (All user roles), "SBO position" (All SBO positions), "Payment method" (All payment methods), static "10 rows per page", dates Ordered from/to, Paid from/to, Claimed from/to, link "Clear all filters"; view switch Responsive | Cards
Table "Order queue" (n orders): Order / Reference | Student / User | Role | Item | Amount | Quantity | Total | Mode of payment | Fulfillment | Actions   (columns Academic Profile, Review Trail, Dates exist in markup but are always hidden)
Row actions ("Order actions"): Review order | Release at claim desk (paid only) | Verify & submit (pending) | Reject order (pending, red)
Status badges: Fulfillment: pending = light blue, paid = amber, claimed = green, cancelled = red; Payment mini badge Paid green / Pending amber / Cancelled red; chips "Officer: <status>" and "Admin: <status>" (approved green, rejected red, pending amber); "Claim token" box on paid orders
Bulk/Toolbar: "View GCash QR", "Export CSV"; footer "Cohort: n of m users purchased (x%)" with links "View purchasers", "View non-buyers"
Paging: 10 (own prev/next "Showing a-b of n", "page / total")   Empty: "No orders yet." ("Orders appear here when students check out from the Shop.") ; filtered "No orders match these filters."
  Drawer "Merchandise drill-down" (dialog, Export Excel): Student ID | Full Name | Department | Program / Major | Year / Section | Role / Position | Item | Qty | Unit Price | Total | Payment | Order | Ordered | Paid | Claimed | Approved / Released By | Reference; pager 10 ("drill-down rows" and "matching users"); empty "No users match this drill-down."
  Drawer "Merchandise order details" (dialog): "Order record" ORD-id · item, stepper, NextStep, receipt document [Purchaser: Name, School ID, Department, Program / course, Year / section; Items: Product / variant | Qty | Subtotal; Payment: Receipt number, Payment date / time, Method, Reference, Payment status, Order status, Proof; Processing: Recorded / processed by, Approved by, Officer review, Admin review, Releasing officer, Claimed / released, Status; Total], "Order activity history" list [action, who · position, time, remarks]; empty "No review actions have been recorded yet."
  Dialog "Verify Payment Amount": receipt, field "Amount verified", Cancel | Verify & Submit. Dialog "Reject Payment": receipt, "Rejection reason", Cancel | reject.
Mobile: below 1280 px (or "Cards" view) rows become cards [ORD-id, status badge, date, buyer, school ID, stepper; item, qty x price, total, method, reference; "Payment review" Officer/Admin chips; token or status panel ("Ready for pickup", "Claimed <date>", "Order cancelled", "Token unlocks after Admin approval"); buttons Review, Claim desk, Verify, Reject].

## Store > Claim desk (/dashboard/merchandise/claim-tokens)
Tiles: none
Filters: select "Filter claim tokens by status" (Waiting to be claimed, Claimed)
No table (above): card "Release an order": field "16-character claim token" (placeholder "16-character token"), button "Claim"
Table "Claim desk register" (Orders waiting to be claimed and orders already released): Order | Purchaser | Section | Department | Course / program | Payment mode | Number of items | Status / token | Details
Row actions: Review order
Status badges: Claimed = green, Waiting to be claimed = amber
  Dialog "Verify purchaser and release": receipt document, buttons Cancel | "Confirm Claim / Release"
Paging: 10 (label "paid orders")   Empty: "Nothing is waiting at the claim desk." ("Orders appear here once their payment is verified and the buyer has a claim token.") + button "Open orders" ; "No orders have been claimed yet."
Mobile: table scrolls sideways (min 1050 px), no card layout.

## Updates > Announcements (/dashboard/announcements/manage-announcements)
Tiles: Matching records | Published | Waiting for approval | Recorded views
Filters: search "Search title, content, or author"; selects Category (All Categories, General, Election, Training, Events, Merchandise), Audience (All audiences, Students, SBO Officers, Admins, Department Heads, Super Admin), Publication (All publication states, Published, Unpublished / Draft), "Created from", "Created to", Sort (Newest first, Oldest first, Title A-Z, Most viewed)
No table (above): "Announcement interactions" bars per announcement (Views, Likes), first 8
Table "Announcement list": Title | Status | Audience | Actions   (Audience from 640 px)
Row actions ("Announcement actions"): View full record | Edit announcement | Delete announcement (own, non-SAO only; Publish and Unpublish are Admin only)
Status badges: Waiting for Admin approval = amber, Returned = red, Published = green, Draft = grey; header badge "Needs Admin approval" amber
Bulk/Toolbar: "New announcement" (primary), "Export CSV"; title click expands detail card (NextStep, post preview, Posted by, Created, Updated, Reviewer, Category, Views)
Paging: 20 (label "announcements")   Empty: "No announcements yet" ("Write your first announcement. It goes to the Admin for approval before it is published.") ; filtered "No announcements match these filters"
  Dialog "Edit": Title, audience, category, rich-text "Announcement content"
  Page "New announcement" (/dashboard/announcements/create-announcement): fields Title, Audience, Category, Content, Instructions for AI draft + "Generate Draft", Poster or image, Mark as important, Pin to the top; section "Publishing settings"; buttons "Save Draft", "Submit for approval"
Mobile: table keeps Title, Status, Actions (Audience hidden).

## Updates > Feed (/dashboard/announcements/view-announcements)
Tiles: none
Filters: search "Search announcements"; select "Announcement category" (All categories, General, Election, Training, Events, Merchandise)
No table: post cards [organization name, date, title, body, image, button "Like"/"Liked" with count]
Paging: 20 (label "announcements")   Empty: "No announcements yet" ("Your officers post them here.") ; filtered "No announcements match" ("Try a different search or category.")
Mobile: single column, max width 672 px.

## Top level > Clearance signing (/dashboard/clearances)
Tiles: none; line "n in queue"
Filters: search "Search by name or school ID..."; selects "Filter by clearance period" (All periods), "Filter by status" (All statuses, Pending, Held, Cleared); link "Select all pending (n)" / "Clear selection"
Table "Clearance signatures": Student | Role | Period | Stage | Actions
Row actions: checkbox (pending rows), badge + buttons "Clear" / "Clear hold" and "Hold" (pending only)
Status badges: Pending = amber, Held = amber, Cleared = green
Bulk/Toolbar: button "Clear n selected"
Paging: 20 (label "signatures")   Empty: "Nothing waiting on your signature" ("The SAO opens a clearance period each semester. Once it does, your organization's students who need your signature show up here.") ; filtered "No signatures match these filters"
  Drawer "<student name>": stepper "Clearance signature", NextStep, status badge + Clear / Hold buttons, "Reason: x" for held
  Dialog "Clear <role>" / "Hold <role>": field Reason (placeholder "e.g. Unpaid organization dues") for hold; Cancel | "Confirm clear" / "Hold this signature". Dialog "Clear selected signatures": Cancel | "Clear selected"
Mobile: DataTable cards below 768 px.

## My activity > Vote (/dashboard/elections/cast-vote)
Tiles: none
No table: election cards [state badge Open green / Voted blue / Upcoming amber / Closed grey, title, date, time range · n minutes, room or "Online ballot", action: button "Vote in this election" | "Your ballot receipt" hash | status sentence, line "Results: <link or text>"]
Empty: "No election is open for voting" ("Elections appear here when the Admin opens one. Check back during the election period.")
  Screen "Secure ballot" (/elections/:id/vote, full screen, header "Secure Voting", "One secure submission", button "Exit ballot"): preview ("Official ballot", counts Positions | Candidates | Ballots, "Start my ballot", "How secure voting works" steps 01 Review candidates, 02 Complete the ballot, 03 Confirm once); voting (left "Ballot progress" "n of m selected" position list; right "Position n of m", candidate cards [photo, name, position, party list or Independent, platform], buttons "Ballot overview"/"Previous" | "Next position" | "Review ballot"); review ("Review your ballot", selection cards, "Edit ballot", "Submit final ballot", dialog "Submit your final ballot?" Keep reviewing | Confirm and submit); done ("Ballot submitted", "Ballot receipt hash", "Your selections", button "Back to Vote")
Mobile: cards one column; progress list scrolls sideways.

## My activity > Shop (/dashboard/merchandise/order-merchandise)
Tiles: Available Items (n units currently in stock) | My Orders (Total reservations) | Pending Payment (Awaiting payment) | My Cart (<amount> in cart · Open cart)
Filters: search "Search product, category, or description"; selects "Filter merchandise category" (All categories + categories), "Sort merchandise" (Available first, Most stock, Price: low to high, Price: high to low)
Table "Products": cards [image, category chip, stock chip "n in stock" / "LOW STOCK" / "OUT OF STOCK", "FIRST n BUYERS", ACTIVE, name, price (struck price, "n buyer slots left"), description, "View product details", Size / variant select ("Select variant"), quantity - / input / +, button "Add to Cart" ("Currently unavailable")]
Status badges: stock >= 10 green, 1 to 9 amber, 0 red
Paging: none   Empty: "Nothing to buy yet." ("Your officers add merchandise here.") ; filtered "No merchandise matches your filters."
  Dialog product preview: image, price, "n units in stock", description, "Size / variant", "Quantity", button "Add to cart"
  Panel "Your merchandise cart" (opened by the My Cart tile or top-bar Cart): rows [image, name, variant · price each · n available, - qty +, remove, line total], "n total items", "Order total", buttons "Clear Cart" | "Review & Continue", "Continue Shopping"; empty "Your cart is empty." + "Browse Merchandise"
  Dialog "Confirm your reservation": rows [name, Qty x price · stock, line total], "Grand total", Payment Method (Cash on pickup, GCash (single order only)), GCash Reference *, Payment Proof *, Cancel | "Place Reservation"
Mobile: product grid 1 column (2 at 640 px, 3 at 1280 px).

## My activity > My orders (/dashboard/merchandise/my-orders)
Tiles: same 4 tiles as Shop
Filters: search "Search orders or token..."
Table "My orders": cards [image, ORD-id, item name, "Qty: n · Total: x", date, status badge, stepper, button "View details", claim ticket (token) for paid, banner by status]
Row actions: View details; for pending: "Submit GCash Proof" / "Replace Proof", "Cancel Order"; paid: "Print ticket"
Status badges: Pending = light blue, Paid = amber, CLAIMED = green, Cancelled = red
Paging: 10 server (label "orders")   Empty: "No orders yet." ("Browse the shop to place your first order.") + "Browse the shop" ; "No orders on this page match your search."
  Drawer "ORD-id": stepper, NextStep, Quantity | Total | Payment | Ordered | Claim token | Claimed
  Dialog "Submit GCash Payment": QR, "13-digit GCash Reference", "Payment Proof", Cancel | "Submit Payment"
Mobile: card list at all widths.

## My activity > My receipts (/dashboard/finance/personal-receipts)
Tiles: none
Table "Personal Receipts": cards [Receipt label, description, date - event / budget / category, reference or "Receipt #id", amount, button "View Receipt"]
Paging: none   Empty: "No receipts yet" ("A receipt appears here after a payment you made is verified by the organization.")
  Dialog "<receipt label>": "Saved payment record from your personal transaction history." receipt (Date, Received from, Number, Amount, Mode of payment, Payment for, Received by, Signature) + "Transaction details"; buttons Close | "Open receipt file" | "Print receipt"
Mobile: cards 1 column (2 at 640 px, 3 at 1280 px).

## My activity > Statement of account (/dashboard/finance/statement-of-account)
Tiles: none (for officers the account summary is hidden)
Table "Statement of Account & Financial Clearance" ("Approved payments are reflected in your balance."): Description | Reference | Due date | Status | Amount due | Paid | Balance
Row actions: none
Status badges: plain capitalized text; Paid green text, Balance red text
Paging: none   Empty: "No invoices have been issued to you."
Mobile: DataTable cards below 768 px.

## Account > Profile (/dashboard/profile)
Tiles: none
No table: left card (avatar, name, role, School ID, Organization, Email address, "Protected account"); form "Personal information" (First name, Last name, Email address, Mobile number (optional), button "Save profile"); form "Password & security" (Current password, New password, Confirm new password, checks "At least 8 characters" and "New passwords match", button "Update password"); "Notifications" toggles (Announcements, Events and reminders, Elections, Merchandise orders); list "Your recent activity" [action in module, record, time] + "Show more"; empty "Nothing recorded yet. Registering for an event or submitting a request will show up here."
Mobile: single column.

## Account > Study objectives (/dashboard/objectives)
No table: read-only sections (general objective banner, research foundation, pillar system, objective details with evidence lists, synthesis); empty "No objectives are configured yet".

COVERAGE: 26 pages, Dashboard, Check-in, Calendar, Venue booking, My tasks, AI delegation, Budgets, Ledger, Financial reports, Forecast, Members and fingerprints, Candidates, Voters, Results, Orders, Claim desk, Announcements, Feed, Clearance signing, Vote, Shop, My orders, My receipts, Statement of account, Profile, Study objectives
