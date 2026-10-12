# Student: screens and table columns

SHARED (not repeated below)
- Row actions menu: kebab button labelled "Actions" (or the named label) opening a menu of items.
- Pager (PaginationControls): "Showing a-b of n <label>", prev/next arrow buttons, numbered page buttons; under 640 px it collapses to prev, "page/total", next. Hidden when total fits one page.
- Filter bar (TableFilterBar): search box with clear X, "Filters" toggle (count badge) opening a grid of selects, "Active" chips with "Clear all", result count at right.
- Badge tones: green = success, amber = warning, red = danger, blue = info, grey = neutral.
- DataTable (used where noted): under 768 px each row becomes a card of "COLUMN: value" pairs with row actions at the bottom.
- Top bar on every page: search, Cart button, Notifications bell, account menu (see "Top bar" sections at the end).

## Dashboard > Dashboard (/dashboard/student)
Tiles: none (briefing + feed)
Briefing above feed: greeting "Good <time of day>, <first name>" + date, role, organization + headline; checklist "Next for you" (progress "n of m done", "Hide checklist", "Show all n steps", per step button or "Where to go"); "Needs attention" list rows [severity badge High/Medium/Low | title | detail | due | Open]; collapsible "Organization indicators" (Elections, Events, Merchandise, Communication: label, value, context, delta, meter); "What HIUSA noticed" insight cards.
Table "Organization feed": No table: post cards [organization name, Pinned chip, Important chip, time ago, type chip Announcement / Event update / Election update, title, body, event card (start time, location) or election counts (Positions | Candidates), image, footer button "View announcements" / "View activity calendar" / "Enter secure voting" / "View results" / chip "Vote submitted"]; infinite scroll, 12 per page
Side panel "Active election": chip "Active election", title, text, button "Enter secure voting" or chip "Vote submitted"
Side panel "Coming up": rows [date chip, title, location]; link "Open activity calendar"; empty "No upcoming events yet."
Side panel "Your account": rows "Statement of account" (You owe <amount> / Nothing owed / "See what you owe and your receipts") and "My clearance" (Clearance: n signatures pending / Clearance: Cleared / On hold: see My clearance / No clearance period / "See which offices have signed")
Status badges: severity High = red, Medium = amber, Low = blue
Empty: feed "Your feed is quiet" ("Official organization updates will appear here when published. In the meantime, find an event to join.") + button "Find an event to join"; end "You're all caught up."; briefing "Nothing is waiting on you"; error button "Try again"
Mobile: side panels move above the feed; single column.

## My payments > Statement of account (/dashboard/finance/statement-of-account)
Tiles: summary block "Account summary": Outstanding balance (<amount>, breakdown "n unpaid invoices and n reserved orders" or "Nothing owed") | Clearance (badge On hold amber / Cleared green / Not confirmed grey, with reasons list)
Filters: none
Table "Statement of Account & Financial Clearance" ("Approved payments are reflected in your balance."): Description | Reference | Due date | Status | Amount due | Paid | Balance
Row actions: none
Status badges: plain capitalized text (underscores removed); Paid in green text, Balance in red bold text
Paging: none   Empty: "No invoices have been issued to you."
Mobile: DataTable cards below 768 px ("COLUMN: value" lines); account summary stays on top.

## My payments > Receipts (/dashboard/finance/personal-receipts)
Tiles: none
Table "Personal Receipts": cards (no header row) [Receipt label, description, "date - event / budget / category", reference or "Receipt #id", amount, button "View Receipt"]
Row actions: View Receipt
  Dialog "<receipt label>" ("Saved payment record from your personal transaction history."): receipt [Date, Received from, Number, Amount, Mode of payment (cash, check, credit/debit card, bank transfer, gcash), Payment for, Received by, Signature] + "Transaction details"; buttons Close | "Open receipt file" | "Print receipt"
Paging: none   Empty: "No receipts yet" ("A receipt appears here after a payment you made is verified by the organization.")
Mobile: cards 1 column (2 at 640 px, 3 at 1280 px).

## Events > Events (/dashboard/events/activity-calendar)
Tiles: Total Events (This academic year) | Upcoming (Scheduled) | Completed (Successfully held) | Total Tasks (Across all events)
Filters: select "Academic period" (Active period, "AY <label> · 1st/2nd Semester · <status>") when periods exist; view switch List | Calendar (default Calendar); List view: search "Search events"; Event date (date); Status (All statuses, Pending Approval, Approved, Ongoing, Completed, Cancelled); Sort by (Soonest, Latest date, Newest created, Title)
Calendar view: month title, buttons "Previous month", "Today", "Next month"; grid Sun Mon Tue Wed Thu Fri Sat; clicking a day with one event opens it, with several opens a day panel (event cards: image, title, description, time, location, status chip); empty month "No events scheduled for <Month Year>."; day panel "No events scheduled on this day."
Table "Events (List view)": Event | Organizer | Schedule | Venue | Attendance | Tasks | Status | Actions
Row actions ("Event actions"): View event
Status badges: Pending Approval = amber, Approved/Ongoing/Upcoming = blue, Completed = green, Cancelled = red
Paging: 10 (selector 10, 25, 50, label "events")   Empty: "No events to join yet" ("Approved events appear here with a Register button. Watch the announcements for dates, then come back to reserve your spot.") + button "Read announcements" ; filtered "No events match these filters"
  Drawer "Event details" (centered dialog): status chip, title, Schedule, Location, Event type, Expected participants, Description, Preparation progress, Attendance Summary, Approval stage, Planning Details; panel "Your registration" [badge Registered blue / Attended green / No-show amber / Cancelled grey, message, button "Register for this event" or "Cancel registration", stepper Register > Check in at the event > Attendance on record]
Mobile: month grid replaced by one card per day with events; list rows become cards below 1024 px with button "View details".

## Voting > Vote (/dashboard/elections/cast-vote)
Tiles: none
No table: election cards [state badge Open green / Voted blue / Upcoming amber / Closed grey, title, date, time range · n minutes, room or "Online ballot", action: button "Vote in this election" | box "Your ballot receipt" hash | status sentence, line "Results: <link or text>"]
Empty: "No election is open for voting" ("Elections appear here when the Admin opens one. Check back during the election period.")
  Screen "Secure ballot" (/elections/:id/vote, full screen, header "Secure Voting", chip "One secure submission", button "Exit ballot" with dialog "Leave secure voting?"):
    preview: "Official ballot", title, tiles Positions | Candidates | Ballots, button "Start my ballot", "How secure voting works" steps 01 Review candidates, 02 Complete the ballot, 03 Confirm once
    voting: left "Ballot progress" "n of m selected" + position buttons; right "Position n of m", candidate cards [photo or initials, name, position, party list or "Independent", platform] (one per position selectable), buttons "Ballot overview" / "Previous" | "Next position" | "Review ballot"; error "Select a candidate before continuing."
    review: "Review your ballot", "Submitted ballots cannot be edited.", selection cards [position, candidate or "Not selected"], buttons "Edit ballot" | "Submit final ballot"; dialog "Submit your final ballot?" with Keep reviewing | "Confirm and submit"
    done: "Ballot submitted", "Ballot receipt hash", "Your selections" cards, button "Back to Vote"
    blocked states: "Vote already recorded", "No election is currently open.", "Voting Opens Soon", "Voting Period Ended"
Mobile: cards one column; ballot progress list scrolls sideways above the candidates.

## Voting > Results (/dashboard/elections/election-results)
Screen "Election picker" (first step): tiles Total elections | Live voting | Awaiting approval | Closed; search "Search by election title..."; select "Filter elections by status" (All statuses, Pending approval, Upcoming, Live, Closed); select "Academic period"; election cards [banner image, status chip Pending Approval amber / Upcoming blue / Live green / Closed grey, title, timeline, stepper, dates, room or "Online ballot", Positions | Candidates | Votes, button "Open election"]; Paging: 6 (label "elections"); Empty: "No election is currently open" ("Voting and live totals become available after the Admin finalizes and opens an election.")
Workspace header: "Change election" button, election title, status chip (Upcoming blue, Voting open green, Closed grey), date range, stepper "Election progress", NextStep, banner "Vote while the election is open. Results appear after voting closes and they are released."
Tiles: Ballots | Selections | Positions | Candidates (hero card; badge "Official final results" or "Live vote totals")
Filters: "Available results" election buttons when more than one ("Final results"/"Live totals"); "Filter by position" buttons "All positions" + one per position
No table: "Winner spotlight" cards [portrait, WINNER chip, name, position, "n votes · party"]; per-position cards "Ballot position <title>" with "Votes cast n", head-to-head strip for top two, candidate rows [portrait, name, WINNER chip, party list, votes, pct%, progress bar]
Empty: "No candidate result data is available." ; "No result data is available for this position." ; locked "Election results are not available yet." ("Vote totals appear once the finalized ballot opens. Winners are declared after closing.")
Mobile: cards one column; position filter scrolls sideways.

## Store > Shop (/dashboard/merchandise/order-merchandise)
Tiles: Available Items (n units currently in stock) | My Orders (Total reservations) | Pending Payment (Awaiting payment) | My Cart (<amount> in cart · Open cart)
Filters: search "Search product, category, or description"; selects "Filter merchandise category" (All categories + categories), "Sort merchandise" (Available first, Most stock, Price: low to high, Price: high to low)
Table "Products": cards (no header row) [image, category chip, stock chip "n in stock" / "LOW STOCK" / "OUT OF STOCK", "FIRST n BUYERS", ACTIVE, name, price (struck price, "n buyer slots left"), description, "View product details", Size / variant select ("Select variant"), quantity - / input / +, button "Add to Cart" or "Currently unavailable"]
Status badges: stock >= 10 green, 1 to 9 amber, 0 red
Paging: none   Empty: "Nothing to buy yet." ("Your officers add merchandise here.") ; filtered "No merchandise matches your filters."
  Dialog product preview: image, price, "n units in stock", description, "Size / variant", "Quantity", button "Add to cart"
  Panel "Your merchandise cart" (replaces the shop view when the My Cart tile or top-bar "Open Cart" is used): rows [image, name, "variant · price each · n available", - qty +, remove, line total], "n total items", "Order total", buttons "Clear Cart" | "Review & Continue", "Continue Shopping"; empty "Your cart is empty." + button "Browse Merchandise"
  Dialog "Confirm your reservation": rows [name, "Qty: n × price · n in stock", line total], "Grand total", Payment Method (Cash on pickup, GCash (single order only)), GCash Reference * ("13-digit reference"), Payment Proof *, Cancel | "Place Reservation"
Mobile: product grid 1 column (2 at 640 px, 3 at 1280 px).

## Store > My orders (/dashboard/merchandise/my-orders)
Tiles: same 4 tiles as Shop
Filters: search "Search orders or token..."
Table "My orders": cards [image, ORD-id, item name, "Qty: n · Total: x", date, status badge, stepper with next-step text, button "View details", claim ticket with 16-character token and "Print ticket" for paid orders, banner by status]
Row actions: View details; pending orders: "Submit GCash Proof" / "Replace Proof", "Cancel Order"
Status badges: Pending = light blue, Paid = amber, CLAIMED = green, Cancelled = red
Paging: 10 server (label "orders")   Empty: "No orders yet." ("Browse the shop to place your first order.") + button "Browse the shop" ; "No orders on this page match your search."
  Drawer "ORD-id": item name, stepper, NextStep, Quantity | Total | Payment | Ordered | Claim token | Claimed
  Dialog "Submit GCash Payment": QR, "13-digit GCash Reference", "Payment Proof", Cancel | "Submit Payment"
Mobile: card list at all widths.

## Updates > Announcements (/dashboard/announcements/view-announcements)
Tiles: none
Filters: search "Search announcements"; select "Announcement category" (All categories, General, Election, Training, Events, Merchandise)
No table: post cards [organization name, date, title, body, image, button "Like"/"Liked" with count]
Paging: 20 (label "announcements")   Empty: "No announcements yet" ("Your officers post them here.") ; filtered "No announcements match" ("Try a different search or category.")
Mobile: single column, max width 672 px.

## Support > My clearance (/dashboard/my-clearance)
Tiles: none; progress bar "Signatures cleared" ("n of m"); line "Deadline: <date>"
Filters: select "Choose clearance period" (<title> (<academic year>)) when more than one period
No table: checklist rows [status icon, signatory role, status badge, note "<remarks> Please see <who>." for held or "Waiting on <who>." for pending]; header shows period title · academic year, stepper "Clearance signatures", NextStep
Status badges: Cleared = green, Held = amber, Pending = amber
Empty: "No clearance period yet" ("The Student Affairs Office opens a clearance period each semester. Once it does, your checklist shows up here with one line for every signature you need."); complete card "Your clearance is complete!"
Mobile: single column card.

## Support > My grievances (/dashboard/my-grievances)
Tiles: none
Filters: tabs "File a grievance" | "My grievances (n)"
No table: tab "File a grievance" = form [info box "What happens next...", "What's this about?" (placeholder "A short, clear title"), "Tell us what happened" (placeholder "Describe the situation in your own words..."), "Who should this go to?" (My organization | Student Affairs Office), checkbox "File this anonymously to my organization" (organization only), button "File this grievance"]
Table "My grievances": cards [title, "Addressed to <recipient> · Filed <relative time>", status badge, delete icon (Submitted only), stepper, stage text, box "AI classification (advisory)" (engine badge, "<urgency> urgency" badge, category badge, "Why this classification?"), box "Response" with reviewer remarks]
Row actions: Delete grievance (icon, Submitted only)
Status badges: Submitted = blue, Under review = blue, Resolved = green, Dismissed = grey; urgency Critical = red, High = amber, Medium = blue, Low = grey
Bulk/Toolbar: header button "File a grievance" (when list is not empty)
Paging: none   Empty: "No grievances filed" ("If something went wrong, file one here. You can follow its status and any remarks from reviewers on this page.") + button "File a grievance"
  Dialog "Delete this grievance?": Cancel | "Delete grievance"
Mobile: cards stack; form fields full width.

## Account > Profile (/dashboard/profile)
Tiles: none
No table: left card (avatar, name, role, School ID, Organization, Email address, "Protected account"); form "Personal information" (First name, Last name, Email address, Mobile number (optional), button "Save profile"); form "Password & security" (Current password, New password, Confirm new password, checks "At least 8 characters" and "New passwords match", button "Update password"); card "Notifications" with toggles (Announcements, Events and reminders, Elections, Merchandise orders); list "Your recent activity" [action in module, record, time] + button "Show more"; empty "Nothing recorded yet. Registering for an event or submitting a request will show up here."
Mobile: single column.

## Account > Study objectives (/dashboard/objectives)
No table: read-only sections (general objective banner, research foundation, pillar system, objective details with evidence lists, synthesis); empty "No objectives are configured yet".

## Top bar > Notifications panel (bell button "Notifications", all pages)
Tiles: header "Notifications" with "n new" chip
Table "Notifications": list rows [type icon, title, message (2 lines), time ago]; newest 5 shown; unread rows blue with left bar
Row actions: click row to open it (title, message, time, "Back to notifications", button to the linked page)
Bulk/Toolbar: "Mark all as read"
Empty: "No notifications yet"
Mobile: panel spans the screen width below the top bar.

## Top bar > Cart panel (button "Cart", badge shows item types)
Table "Your Cart": rows [name, "Qty: n - price", line total]; header "n item type(s)"; footer "Total: <amount>" and button "Open Cart"
Empty: "Cart is empty"
Mobile: panel spans the screen width.

COVERAGE: 13 pages, Dashboard, Statement of account, Receipts, Events, Vote, Results, Shop, My orders, Announcements, My clearance, My grievances, Profile, Study objectives (plus top-bar Notifications and Cart panels)
