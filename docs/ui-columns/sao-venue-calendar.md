# SAO Venues page and venue calendar: UI spec (paste into a UI design tool)

Source of truth: client/src/pages/modules/venues/*.jsx, server VenueController.php, VenueBookingController.php, models Venue and VenueBooking, routes/api.php. Text below is verbatim from code. "(unknown)" marks anything not determined from code. All times are Asia/Manila wall-clock. Icons are lucide-react. Font: Poppins. Min touch target 44px.

## 0. Screens covered

| Screen | Route | Role | File |
|---|---|---|---|
| SAO Venues (3 tabs) | /dashboard/super-admin/venues (sidebar label "Venues", group "Reviews", pin icon MapPin) | SUPER_ADMIN (the SAO) | SaoVenuesPage.jsx |
| Organization Venue booking | /dashboard/venues (sidebar label "Venue booking", group "Events and tasks") | ADMIN, SBO_OFFICER | VenueBookingPage.jsx |

Important: the organization screen does NOT have the day/week/month calendar. It has a "Find a venue" panel: one venue, a From/To date range, a row of day chips, and a one-day 5 AM to 10 PM bar plus a list. Only the SAO screen has the calendar grid.

Non-SAO user opening the SAO page sees: page header, then a card with restricted empty state, title "SAO access only", description "Only the Student Affairs Office manages the venue catalog."
Non-org user opening the org page: title "Organization access only", description "Only organization admins and officers can request venue bookings."

## 1. SAO Venues page layout

### 1.1 Page header
- Breadcrumb (from route meta, group "Reviews")
- H1: "Venues" (28px, extrabold, #0F172A)
- Lead: "See who has each venue and when, and decide booking requests with conflicts in view." (14px, medium, #475569)
- Header primary button (right side), only on Venue catalog tab and only when the catalog has at least one venue: "New venue" (Plus icon)
- Header bottom border 1px #DDE7EF

### 1.2 Tab bar (underline tabs, 44px high, horizontally scrollable, active tab text #0878B7 with 2px #0B8ED0 underline that slides)
1. Calendar (CalendarDays icon) - default tab. Opens "Booking requests" instead when URL has ?record=<id>
2. Booking requests (ClipboardCheck icon)
3. Venue catalog (Building2 icon)

### 1.3 Calendar tab: card
- Card title: "Venue calendar"
- Card description: "Who holds each venue and when. A pending request that overlaps another booking is labelled Conflict."
- Defaults: view = Week, anchor = today (Manila), venue = All venues

#### Toolbar row 1 (stacks vertically below 1024px, one wrapped row at 1024px and up)
1. Segmented control (radiogroup, pill with sliding white thumb): Day | Week | Month
2. Button group: icon button chevron-left, aria label "Previous day" / "Previous week" / "Previous month" (secondary); button "Today" (secondary); icon button chevron-right, aria label "Next day" / "Next week" / "Next month"; date input aria label "Jump to date" (width 176px)
3. Select, aria label "Venue to show", 240px wide at 1024px and up (full width below): first option "All venues", then every venue name. Includes inactive venues. This venue filter is shared with the Booking requests tab "Filter by venue" select.

There is NO status filter and NO organization filter on the calendar. The calendar only ever shows pending and approved bookings (rejected and withdrawn are never fetched).

#### Toolbar row 2
- Range label (bold 14px, aria-live): Day = "Monday, October 13, 2026" ; Week = "Oct 12 - Oct 18, 2026" ; Month = "October 2026"
- "Updating..." (12px muted, role status) while the next window loads; grid stays visible at 60% opacity
- Legend (right aligned from 640px up, label "Legend"), three items:
  - 12px swatch, border #16A34A, fill #EBF7EF, text "Approved"
  - 12px swatch, dashed border #F59E0B, fill #FEF3DB, text "Pending"
  - Conflict pill: border #DC2626, fill #FBE9E9, text #B91C1C, bold 12px, triangle-alert icon 12px, text "Conflict"
- Venue colour legend (only in Week view when venue = All venues): list labelled "Venue colours", each entry a 6x12px swatch plus venue name. Swatch cycles by venue id mod 5: #0B8ED0, #16C7F3, #0F2F62, #94A3B8, #64748B (deliberately not status colours). A venue is listed if active, or if it holds a booking in the window.

#### Calendar grid by view
Time axis: 5 AM to 10 PM (hours 5 to 22), 52px per hour, so grid height 884px, hour labels in a 56px left gutter (12px semibold #64748B, e.g. "5 AM"; format from en-PH locale, exact casing unknown), 1px #DDE7EF hour lines. The axis grows beyond 5 AM to 10 PM (down to earlier start, up to 24:00) if any booking falls outside, never drops one.

Week view
- 7 day columns Monday to Sunday, min 112px each, gutter 56px, so min grid width 840px (more if bookings are in lanes). Grid scrolls horizontally inside its own bordered box (region label "Week of bookings. Scroll sideways to see every day."), never the page.
- Column header (light #F8FBFD): uppercase short weekday ("MON"), below it a 28px circle with the day number; today's circle is filled #0878B7 with white text, plus the word "Today" under it (bold 12px, #0878B7).
- A booking belongs to the column of its start day.

Day view
- Caption above grid, uppercase 12px bold: "Monday, October 13" and " (today)" suffix when today (brand colour when today, muted otherwise)
- 768px and up: one column per venue (lane) on the shared time axis, min 160px per lane, header = venue name (truncated). Lanes = venues that are active or hold a booking that day (filtered by the venue select). If no lanes: "No venues to show."
- Below 768px: no grid; a vertical list "Bookings by venue". Per venue: H3 venue name, then bookings sorted by start, each a full-width 44px+ tappable card: clock icon, "9:00 AM - 11:00 AM", status pill (Approved or Pending), Conflict pill if conflict, line with organization acronym (bold), line with event title (muted). Empty venue shows "Nothing booked."

Month view
- Weekday header row (hidden from assistive tech): Mon Tue Wed Thu Fri Sat Sun (uppercase 12px bold muted)
- Whole weeks, so it includes days of neighbouring months (those cells tinted #F8FBFD, day number in #94A3B8; in-month cells white). Min cell height 112px, min grid width 560px, scrolls horizontally in a bordered box (region label "Month of bookings. Scroll sideways to see every day.")
- Day number is a 28px circle button (aria "Open Monday, October 13"); today = filled #0878B7 white text plus word "Today" beside it. Clicking the number switches to Day view on that date.
- Up to 3 chips per day, then a text button "+N more" (bold 12px, #0878B7), which opens that day in Day view.
- Chip (single line, truncated, 20px line height): optional bold "Conflict " prefix, bold time range (e.g. "9-11 AM" or "11 AM-1 PM"), then organization acronym. Chip uses the status style below. Tooltip and aria label carry the full description.

#### How a booking appears (Week and Day grids)
Absolutely positioned block, 4px radius, 1px border, 12px text/16px leading, top and height proportional to time (min height 22px), clickable button. Content, in order:
1. Status icon (check for Approved, clock for Pending) + bold text "Approved, 9-11 AM" or "Pending, 9-11 AM" (range uses compact form: "9-11 AM", "11 AM-1 PM", "9:30-10:30 AM")
2. Conflict pill (only when conflicting)
3. Organization acronym (semibold). Falls back to organization name, then "Unknown organization"
4. Event title (medium), only if linked
5. Venue name (medium), only in Week view when venue select = All venues. In that case the block also has a 6px left stripe in the venue colour.

Status styles
- Approved: solid 1px border #16A34A, fill #EBF7EF, text #15803D
- Pending: dashed 1px border #F59E0B, fill #FEF3DB, text #B45309
- Never colour alone: the status word and icon are always in the block; Conflict is a labelled pill with icon.
- Aria label example: "Pending booking, Conflict, NSTP, Leadership Summit, Main Gymnasium, 9:00 AM to 11:00 AM"

Overlap handling (layout)
- Bookings in the same column that chain-overlap share side-by-side lanes: each gets width 100%/lanes minus 4px, left offset lane/lanes. Only the overlapping cluster narrows, other bookings that day stay full width.
- The column's minimum width grows with its lane count (112px or 160px per lane) so text stays readable.
- Conflict definition (client and server): a PENDING request strictly overlaps another PENDING or APPROVED booking of the same venue. Back to back (end equals start) is not a conflict. Off-campus bookings (no venue) never conflict and never appear on the calendar.

#### Calendar states
- First load: skeleton block 256px high, role status, label "Loading venue calendar"
- Error: centered error state, title "Could not load the calendar", description from server or fallback "Could not load the venue calendar.", button "Try again"
- Empty window: line with calendar icon, "No pending or approved bookings this day." (or "week", "month"), shown above the still-drawn empty grid
- Truncated (more than 50 pages x 100 bookings): amber line with triangle icon "Showing the first {shown} bookings of {total}. Pick one venue to narrow the {day|week|month}."

### 1.4 Clicking a booking: "Booking details" dialog (calendar)
Modal, max width 448px, title "Booking details". Read-only. Fields (label uppercase 12px bold muted, value 14px semibold):
1. ORGANIZATION: full organization name (fallback acronym)
2. EVENT: event title, or "Not linked"
3. VENUE: venue name, or "Not specified"
4. DATE: "Monday, October 13, 2026" (if it spans days: "<start date> to <end date>")
5. TIME: "9:00 AM to 11:00 AM"
6. STATUS: status badge (Approved or Pending) plus Conflict pill when conflicting
- If conflicting, red text under the list: "This request overlaps another booking for the same venue. Check the calendar before approving."
- Footer buttons: "Close" (secondary); "Show in booking requests" (secondary, list-checks icon). The latter closes the dialog, switches to Booking requests tab and sets status filter = that booking's status and venue filter = that booking's venue.
- NO Approve or Reject in this dialog. Decisions happen in the Booking requests tab (section 2).

## 2. Booking requests tab

Card title: "Booking requests"
Card description: "Approve or reject requests. Overlapping bookings are shown before you decide, and clashing requests are labelled Conflict."

### 2.1 Filter bar (white, bottom border, padding 12px, 16px at 640px+; column below 640px, row from 640px)
1. Select, aria "Filter by status", 224px wide from 640px: options in order "Awaiting decision" (value pending, DEFAULT), "Approved", "Rejected", "Withdrawn", "All statuses"
2. Select, aria "Filter by venue", 224px: "All venues" then every venue name
3. Ghost button "Clear filters" (only when status is not "Awaiting decision" or a venue is chosen) resets to pending and all venues
4. Right aligned count text (12px semibold muted, tabular): "{N} request" / "{N} requests" (server total)
- No organization filter, no search, no date filter in the UI (API also accepts organization_id, from, to: unused by this page). No column sorting; server order is start time newest first, then id newest first. 20 per page.

### 2.2 Table columns (in order) from 768px up; below 768px each row becomes a card with label/value pairs (label uppercase 12px bold muted left, value right aligned) and the actions under a divider
1. Organization: organization full name as a bold link-like button (opens the drawer, section 2.5); fallback "Unknown"
2. Venue: venue name, or off-campus location, or "Unknown"
3. Event: event title, or "Not linked"
4. Requested time: "October 13, 2026, 9:00 AM - 11:00 AM" (long date)
5. Status: stacked: status badge; Conflict pill if conflicting (pending only); stage text line (12px semibold #475569)
6. Actions (right aligned): for pending rows only: "Reject" (secondary, 44px high below 640px, 36px above) then "Approve" (primary). No actions on approved, rejected or withdrawn rows.

Header row: #F8FBFD, uppercase 12px bold muted text, sticky. Row hover #F8FBFD.

Stage text per status (as read by the requesting organization): pending "Waiting for SAO approval"; approved "Approved: venue booked"; rejected "Rejected by the SAO" for non-Admin viewer, but this column renders as the Admin viewer so it reads "Rejected: read the remarks and request again"; withdrawn "Withdrawn".

### 2.3 Status badges (pill 24px high, 12px bold, dot + label)
| Status | Label | Fill | Text | Dot |
|---|---|---|---|---|
| pending | Pending | #FEF3DB | #B45309 | #B45309 |
| approved | Approved | #EBF7EF | #15803D | #15803D |
| rejected | Rejected | #FBE9E9 | #B91C1C | #B91C1C |
| withdrawn | Withdrawn | #F8FBFD plus 1px #DDE7EF border | #64748B | #94A3B8 (no entry in the status map, so falls back to the neutral tone with a humanized label) |
| active (venue) | Active | #EBF7EF | #15803D | #15803D |
| inactive (venue) | Inactive | #F8FBFD plus border | #64748B | #94A3B8 |

### 2.4 Conflict warnings
- Pill "Conflict" (see 1.3) on queue rows, drawer, calendar blocks, details dialog.
- Computed by fetching every pending and approved booking spanning the pending rows currently on screen (not just this page's week).
- If that check fails: amber alert above the table (triangle icon), "Could not check these requests for conflicts. Conflict labels may be missing." plus ghost button "Retry".
- Approve dialog (below) lists the overlaps again.

### 2.5 Request drawer (right side drawer; opens on row click or ?record=<id>)
- Title: venue name, or off-campus location, or "Venue request". Description: "Venue request #{id}".
- Content top to bottom:
  1. Progress stepper, aria "Venue booking progress", steps: "Requested" (actor Admin), "SAO review" (actor SAO), "Approved". Pending: step 2 current. Approved: all done. Rejected: step 2 blocked, note "Rejected". Withdrawn: step 2 stopped, note "Withdrawn", step 3 skipped.
  2. Next-step callout, shown for SAO as: pending: title "Review the booking", body "Approve it or return it with remarks." (no button in the callout); approved: "Approved: venue booked" / "The venue is reserved for the requested time."; rejected: "Rejected by the SAO" / "No action needed from you."; withdrawn: "Withdrawn" / "The organization withdrew this booking request."
  3. If conflicting: Conflict pill and red text "This request overlaps another booking for the same venue. Check the calendar before approving."
  4. Definition list (label 12px semibold muted, value 14px bold):
     - Organization: full name, or "Unknown"
     - Event: event title, or "Not linked"
     - Requested time: "October 13, 2026, 9:00 AM - 11:00 AM"
     - Remarks: only shown when remarks exist (the SAO rejection text)
  5. Only when status is pending: buttons "Reject" (secondary) and "Approve" (primary).
- Deep link to a booking not in the list: toast "That booking request is not in the list."

### 2.6 Approve dialog
- Title "Approve this booking?"; description "{venue or off-campus location} - October 13, 2026, 9:00 AM - 11:00 AM"
- Body states: loading "Checking for overlapping bookings..."; check failed (amber, alert) "Could not check for overlapping bookings. Check the calendar before approving."; overlaps found: amber box (border #F59E0B at 30%, fill #FEF3DB) with heading "Overlaps {N} other booking(s) for this venue" (uppercase 12px bold #B45309, triangle icon), list items "Approved: Nursing Society, October 13, 2026, 9:00 AM - 10:30 AM" (status label, organization full name, range), then footnote "The server rejects this approval if it overlaps another approved booking. Back to back bookings do not overlap."; none: "No overlapping bookings for this venue and time."
- Footer: "Cancel" (secondary), "Approve" (primary, loading state). Success toast: `Booking for "{venue}" approved.` Error toast: server message or "Could not approve this booking."
- The SAO can still approve a conflicting request (warning only); the server blocks only an overlap with an APPROVED booking.

### 2.7 Reject dialog
- Title "Reject this booking"; description "A remark is required so the organization knows why."
- Field "Remarks" (required, textarea, autofocus). No placeholder, no client max length (server max 2000).
- Footer: "Cancel" (secondary); "Reject booking" (danger red #DC2626, disabled until remarks has non-space text). Success toast: `Booking for "{venue}" rejected.` Error toast: server message or "Could not reject this booking."

### 2.8 Withdrawn state (SAO side)
Withdrawn bookings only appear when filter = Withdrawn or All statuses. Badge "Withdrawn" (neutral), no row actions, no drawer buttons, drawer stepper shows stopped state. The SAO cannot withdraw. Not shown on the calendar.

## 3. Venue catalog tab

Card title: "Venues"; description: "Capacity, location, and whether an organization can book it."
Header button "New venue" (Plus icon) only when at least one venue exists.

### 3.1 Table columns (in order; cards below 768px)
1. Venue: name, bold
2. Location
3. Capacity (right aligned, tabular numbers)
4. Status: a 44px-high switch control (role switch, aria label "{name} active status"): 44x24 track, green #16A34A when active, grey #94A3B8 when inactive, white 16px knob; next to it the Active or Inactive badge. Clicking toggles immediately (no confirm), disabled while saving.
5. Actions: "Edit" (secondary) and an icon-only trash button (danger, aria label "Delete {name}")

Toasts: `"{name}" marked inactive.` / `"{name}" marked active.`; error "Could not update this venue."
Load error state message: "Could not load the venue catalog." with Try again.

### 3.2 Empty state (first-run, building icon)
Title "No venues added yet"; description "Add a venue so organizations can request bookings against it."; button "New venue" (Plus).

### 3.3 Add or edit dialog
Title "New venue" or "Edit venue"; footer "Cancel" (secondary) and "Add venue" / "Save changes" (primary, loading). 2 column grid from 640px, 1 column below.
| Field | Type | Required | Placeholder or hint | Rules |
|---|---|---|---|---|
| Name | text, full width, autofocus | yes | "e.g. Main Gymnasium" | client: not blank; server: string, max 255 |
| Location | text, full width | yes | "e.g. Building A, Ground Floor" | client: not blank; server: string, max 255 |
| Capacity | number, min 0 | yes | hint "Number of people this venue can hold" | client: not empty and not negative; server: integer, min 0 (decimals rejected by the server) |
| Active (organizations can request this venue) | checkbox, default checked | no | | boolean |
- Inline error (red 14px semibold, role alert), client: "Complete the name, location, and a valid capacity before saving." ; server errors shown verbatim, fallback "Could not save this venue."
- Success toasts: "Venue added to the catalog." / "Venue updated."

### 3.4 Delete
- Confirm dialog: title "Delete this venue?"; message "This cannot be undone. A venue that has any booking, even a past or declined one, cannot be deleted. Mark it inactive instead to stop new requests."; shows the venue name as the record name; buttons cancel and "Delete venue" (danger).
- Server refuses with 409 and message: "This venue has booking history, so it cannot be deleted. Mark it inactive instead to stop new requests." Shown as an error toast (fallback "This venue could not be deleted."). Success toast: `"{name}" deleted.`
- Deactivate rule: inactive venue accepts no NEW requests (server validates venue is active), keeps its history and still shows on the calendar if it holds bookings.

## 4. Organization side: Venue booking page (ADMIN, SBO_OFFICER)

### 4.1 Header
- H1 "Venue booking"; lead "Check availability, request a booking, and track your organization's requests."
- Secondary button "Request an off-campus venue"
- Primary button "Request a venue" (calendar-range icon), hidden until the org has at least one booking request

### 4.2 Card "Find a venue"
Description: "Pending requests and approved bookings for the venue and dates you choose."
- Three fields in a row from 640px (stacked below): Venue select (options "{name} - capacity {n}", active venues only, first venue preselected, disabled while loading or empty), "From" date, "To" date (From max = To, To min = From; default today to today + 7 days)
- Empty catalog: first-run empty state, map-pin icon, title "No venues available yet", description "SAO has not added any bookable venues yet. Check back later."
- Venue load error: "Could not load the venue catalog."
- Under the fields, divider, then: venue name (bold) and "{location} - capacity {n}", right side secondary small button "Request this venue"
- Availability states: "Checking availability..."; error (red) "Could not load availability for this venue."; ready: availability panel.

### 4.3 Availability panel (anonymised, hard-coded hex colours)
- Day chips (horizontal scroll, 44px high, label like "Mon, Oct 13"): selected = border #0B8ED0, fill #EEF6FB, text #0F2F62; other = border #DDE7EF, white, text #64748B. A chip with bookings shows dots: navy #0F2F62 dot for reserved, amber-500 dot for pending. Max 14 days; if the range is longer: "Showing the first 14 days."
- Legend: navy square "Reserved", amber square "Pending"
- Bar: white box, 600px min width (scrolls), hour ticks "5 AM, 8 AM, 11 AM, 2 PM, 5 PM, 8 PM, 10 PM", track 48px high fill #EEF6FB (aria "Booking hours, 5 AM to 10 PM"); each booking is a bar: navy for approved, amber-500 for pending, tooltip "Reserved by {who}: 9:00 AM - 11:00 AM" or "Pending by {who}: ..."
- List cards (2 columns from 640px) for the selected day: clock icon, bold "9:00 AM - 11:00 AM", then "Reserved by {who}" or "Pending request from {who}". {who} is "Your organization" or "Another organization" (server anonymises; other organizations' names and events are never sent). Card border navy for reserved, amber-300 for pending.
- Empty day: "No bookings on this date."; invalid range: "Choose a date to see bookings."

### 4.4 Request dialog: "Request a venue booking"
Footer: "Cancel", "Send request" (loading). Grid 2 columns from 640px.
| Field | Control | Required | Details |
|---|---|---|---|
| Venue type | select: "On campus", "Off campus" | yes | default On campus; full width |
| Venue (on campus only) | select, first option "Choose a venue", then active venue names | yes | preselected from the chosen venue or linked event plan |
| Off-campus location (off campus only) | text, max 255 | yes | trimmed |
| Start | datetime-local | yes | defaults to From date at 09:00 |
| End | datetime-local | yes | defaults to From date at 17:00 |
| (help text) | "Bookings run from 5:00 AM to 10:00 PM on one day." | | |
| Link to an event | select, hint "Optional"; first option "Not linked to an event" | no | the org's events; opened with ?event=<id> preselects it |
- Client validation messages (shown in red role alert, in this order): "Choose an on-campus venue or enter an off-campus location and both times." ; "The end time must be after the start time." ; "Choose a time on one day between 5:00 AM and 10:00 PM." (start and end on same date, start at or after 05:00, end at or before 22:00)
- Server validation: same one-day window message (422); end must be after start; venue must exist and be active; event must belong to this organization ("Selected event does not belong to this organization." 422); "The selected venue is no longer available." (422); overlap: "This venue already has a pending or approved booking during that time. Choose another slot." (422, also reloads availability). Overlap is checked against PENDING and APPROVED bookings by any organization for on-campus venues; off-campus bookings get no overlap check. Back to back is allowed.
- Fallback error: "Could not submit this booking request."
- Bad ?event= link: toast "That event is not available for a venue booking."
- Success dialog: title "Booking request sent", description "SAO will review this request. This is your booking reference, not an approval.", ticket box (cream #FFFDF7, dashed divider) with "Venue request #{id}", Venue, Requested time, Status badge Pending, button "Done".

### 4.5 Card "My organization's requests"
Description: "Every venue booking your organization has requested."
Columns: Venue (bold button opens drawer; off-campus location if no venue) | Event ("Not linked") | Requested time | Status (badge plus stage text) | SAO remarks (rejection remarks, else "-"). Row action "Withdraw" (secondary) when pending, or approved with a future start.
Empty state: icon clipboard-list, title "No booking requests yet", description "Request a venue for an event and the SAO decides it. Each request shows up here with its status.", button "Request a venue". Load error fallback "Could not load your booking requests."
Drawer: same stepper and callout, rows Event, Requested time, "SAO remarks" (when present); for rejected the callout has a primary button "Book again"; pending or future-approved show a secondary "Withdraw request".
Withdraw confirm: title "Withdraw this booking request?"; message "SAO will be notified. You will need to submit a new request if you still need this venue."; confirm "Withdraw request" (danger). Toast "Booking request withdrawn."; errors: "Could not withdraw this booking." or server "Only a pending booking or a future approved booking can be withdrawn." (409) or "Venue booking not found." (404, another organization's booking).
Deep link miss: "That booking request is not in your organization's list."

## 5. Data fields, states, roles

### Venue (table venues)
| Field | Type | Rule |
|---|---|---|
| id | bigint | pk |
| name | string(255) | required |
| location | string(255) | required |
| capacity | unsigned integer | required on create, default 0 in DB, min 0 |
| is_active | boolean | default true |
| created_at, updated_at | timestamps | |

### VenueBooking (table venue_bookings)
| Field | Type | Rule |
|---|---|---|
| id | bigint | pk |
| venue_id | FK venues, nullable | null when off campus; required (active venue) for on campus |
| off_campus_location | string(255), nullable | required when venue_type = off_campus |
| event_id | FK events, nullable | must belong to the requesting organization; set null if event deleted |
| organization_id | FK organizations | taken from the logged in user, not the request |
| start_time, end_time | datetime | end after start; same day; 5:00 AM to 10:00 PM Manila |
| status | string(20) | pending (default), approved, rejected, withdrawn |
| remarks | text, nullable | required when rejecting (max 2000); cleared to null on approve |
| requested_by | FK users.school_id | the requester |
| reviewed_by | FK users.school_id, nullable | SAO who decided, or the organization user who withdrew |
| reviewed_at | datetime, nullable | |
| venue_type | request-only field, "on_campus" (default) or "off_campus" | not stored |
| API list adds | venue {id,name,location}, organization {id,name,acronym}, requester {school_id,first_name,last_name}, event {id,title} | |

### Availability item (GET /venues/{id}/availability)
Fields: id, start_time, end_time, status (pending or approved only), reserved_by. SAO also gets organization {id,name,acronym} and event_title; reserved_by is the full organization name. Organizations get reserved_by = "Your organization" or "Another organization" only.

### State transitions
- (new) -> pending: Admin or Officer requests (on campus: refused if overlap with pending or approved)
- pending -> approved: SAO (refused with 409 "Another booking for this venue was approved for an overlapping time in the meantime." if it overlaps an APPROVED booking; pending overlaps do not block)
- pending -> rejected: SAO, remarks required (terminal; the organization books again with a new request)
- pending -> withdrawn: requesting organization
- approved -> withdrawn: requesting organization, only if start time is in the future
- rejected, withdrawn: terminal. Only status pending can be reviewed: otherwise 409 "Only a pending booking can be reviewed."
- Archived organization: 409 "This organization is archived and read only."
- On request, review and withdraw, in-app notifications are created: SAO gets "New venue booking request" / "Venue booking withdrawn"; organization gets "Venue booking approved" / "Venue booking rejected" (message includes the remarks).

### Who may do what (route middleware)
| Action | Endpoint | Roles |
|---|---|---|
| List venues | GET /venues | SUPER_ADMIN (all, optional is_active filter), ADMIN and SBO_OFFICER (active only) |
| Create, edit, delete venue | POST, PUT, DELETE /venues | SUPER_ADMIN |
| Venue availability | GET /venues/{id}/availability | SUPER_ADMIN, ADMIN, SBO_OFFICER |
| List bookings | GET /venue-bookings | SUPER_ADMIN (all organizations, optional organization_id filter), ADMIN and SBO_OFFICER (own organization only) |
| Request booking | POST /venue-bookings | ADMIN, SBO_OFFICER |
| Approve or reject | PATCH /venue-bookings/{id}/review | SUPER_ADMIN |
| Withdraw | PATCH /venue-bookings/{id}/withdraw | ADMIN, SBO_OFFICER (own organization) |
| Students, Department Heads | | no access to either page |

## 6. Responsive behaviour under 640px (and the thresholds around it)
- Page: single column, 20px vertical gaps; header title stays 28px, header buttons wrap under the title.
- Tabs: stay one row, scroll horizontally if too narrow.
- Calendar toolbar: view switch, then prev/Today/next/date input wrap in a row, then the venue select full width, stacked vertically (single wrapped row only at 1024px and up). Legend sits below the range label and wraps; right aligned only at 640px and up.
- Week view: not reflowed; keeps 840px minimum width and scrolls sideways inside its own bordered box (keyboard focusable region). Month view: 560px minimum, same scroll box.
- Day view: list layout under 768px (see 1.3), grid at 768px and up.
- Tables become cards under 768px (each row: label/value pairs, actions in a footer row with divider).
- Row action buttons are 44px high below 640px, 36px at 640px and up.
- Booking requests filter bar stacks (status select, venue select, Clear filters, count) in a column below 640px; row from 640px; selects are full width below 640px.
- Venue form and request form: one column below 640px, two columns from 640px.
- Organization page: Find a venue fields stack below 640px; availability list cards 1 column below 640px; bar panel scrolls (600px minimum).
- Drawer and modals: widths unknown for mobile (drawer width not read; details dialog max 448px).

## 7. Empty states and error messages (exact)
| Where | Text |
|---|---|
| Calendar empty window | "No pending or approved bookings this day." / "week." / "month." |
| Calendar day view, no venues | "No venues to show." |
| Calendar day list, venue free | "Nothing booked." |
| Calendar load error | title "Could not load the calendar"; description "Could not load the venue calendar." (or server message); button "Try again" |
| Calendar truncated | "Showing the first {shown} bookings of {total}. Pick one venue to narrow the {unit}." |
| Queue empty, default or no filters | icon clipboard-check, title "Nothing to review", description "Organization admins and officers request venues from Venue booking. Each request appears here for your decision." |
| Queue empty, filters active | title "No booking requests match these filters", description "Try another status or venue, or clear the filters.", plus a clear filters action (filtered empty state; its own default query wording unknown) |
| Queue load error | "Could not load booking requests." |
| Queue conflict check failed | "Could not check these requests for conflicts. Conflict labels may be missing." |
| Catalog empty | "No venues added yet" / "Add a venue so organizations can request bookings against it." |
| Catalog load error | "Could not load the venue catalog." |
| Venue form | "Complete the name, location, and a valid capacity before saving." ; "Could not save this venue." |
| Venue delete | 409 "This venue has booking history, so it cannot be deleted. Mark it inactive instead to stop new requests." ; "This venue could not be deleted." |
| Review | "Could not approve this booking." ; "Could not reject this booking." ; "Only a pending booking can be reviewed." ; "This organization is archived and read only." ; "Another booking for this venue was approved for an overlapping time in the meantime." |
| Generic API fallback | "Something went wrong. Please try again." ; 503: "This service is temporarily unavailable. Please wait a moment and try again." ; other 5xx use the page's own fallback |
| Org availability | "Checking availability..." ; "Could not load availability for this venue." ; "No bookings on this date." ; "Choose a date to see bookings." |
| Org form | see 4.4 |
| Org list empty | "No booking requests yet" (4.5) |
| Access | "SAO access only" ; "Organization access only" |
| Loading skeletons | tables show skeleton rows; calendar shows a 256px skeleton block |
| Pagination footer | "Showing {from}-{to} of {total} requests" with Previous page / Next page buttons and numbered pages (page size 20) |

## 8. Design tokens used (all from index.css theme, matching CLAUDE.md palette)
- Primary blue #0B8ED0 (brand-600: tab underline, focus border, primary buttons); hover/active text #0878B7 (brand-700: active tab text, today circle fill, "+N more", current page)
- Cyan #16C7F3 (accent: focus rings, a venue colour swatch)
- Deep navy #0B1831 (sidebar); Dashboard navy #0F2F62 (navy-800: one venue colour swatch, org-side Reserved colour, info badge text)
- Page background #EEF6FB; surface white #FFFFFF; subtle #F8FBFD (table header, hover, out-of-month cells, segmented control track); border #DDE7EF; soft border #E5EDF3
- Text: strong #0F172A, muted #64748B, muted-strong #475569, soft #94A3B8
- Success #16A34A / strong #15803D / tint #EBF7EF (approved, active)
- Warning #F59E0B / strong #B45309 / tint #FEF3DB (pending, conflict-check warnings)
- Danger #DC2626 / strong #B91C1C / tint #FBE9E9 (rejected, Conflict pill, reject button)
- Radii: control 6px, booking blocks 4px, pills fully rounded, cards 8px. Buttons 44px high (36px small). Focus: 2px accent outline, 2px offset.
- Off-palette hard-coded values on the organization side (VenueAvailabilityTimeline, request form help text, ticket box): tailwind amber-500 (#F59E0B equivalent), amber-300 border, amber-600 icon, #FFFDF7 ticket background, #EEF6FB, #0F2F62, #DDE7EF, #64748B, #0F172A, #16C7F3 focus.

## 9. Unknowns
- Exact hour label casing ("5 AM" vs "5 am") depends on browser en-PH locale.
- Drawer and modal widths on mobile; Drawer width on desktop not read.
- Filtered empty-state boilerplate wording from EmptyState.jsx beyond the title and description passed in.
- Breadcrumb exact items (generated from route meta: Dashboard-like root, group "Reviews", page "Venues"); not read.
- Org-side date defaults use UTC date (toISOString) not Manila date, so around midnight Manila they can be one day behind.
