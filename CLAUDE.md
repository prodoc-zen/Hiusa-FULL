# HIUSA System — Project Guide

HIUSA is a decoupled monorepo: a React frontend (`/client`) and a Laravel backend (`/server`). It is a school/organization admin system covering members, payments, events, attendance, tasks, budget, merchandise, elections/voting, and notifications.

---

## Claude Behavior Rules

These rules govern how Claude should operate in this project. Follow them without being asked.

### Output Rules

- **Never use the Artifact tool.** It does not render reliably. Always write output to files in the project or reply in plain text/markdown.
- For plans, reports, or structured documents: write them as markdown directly in the chat response or append to CLAUDE.md.

### Git Commit Rules

- **Never add AI model co-authorship** to commit messages. No `Co-Authored-By: Claude` or any AI model name.
- Always co-author the project collaborator: `Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>`
- Keep commit messages concise and use the `feat:`, `fix:`, `chore:` prefix convention.

### Always Use Skills When They Apply

- After implementing any feature or fix, run `/verify` to confirm the change works correctly in the running app.
- Before shipping any feature branch, run `/code-review` to catch correctness bugs, missed edge cases, or redundant code.
- After a code-review pass, run `/simplify` to clean up reuse and efficiency issues.
- When the user asks to run or start the app, use `/run`.
- When a task needs planning across multiple files or modules, use Plan mode before writing code.
- When researching multi-source topics (APIs, docs, error causes), use `/deep-research`.

### Completeness Standard

Do the whole thing. No partial implementations. No "I'll leave X for later." No workarounds when the real fix is reachable. The bar is: holy shit, that's done — not "good enough."

### Anti-Slop Rules

Never produce generic AI output. Specifically:
- Do not use or suggest generic fonts like Inter, Roboto, or system-ui. This project uses **Poppins only**.
- Do not use generic blue shades. Only use the exact hex values from the HIUSA color system below.
- Do not create gradient-heavy hero sections, decorative stripes, big marketing copy, or rounded card-in-card layouts.
- Do not produce "starter template" looking code — no placeholder lorem ipsum, no generic card grids with fake data that look nothing like the design.
- Do not add AI-style animations or glow effects not in the design spec.
- Do not invent component patterns not established in this codebase or design.md.
- If the design.md says do not do something, do not do it. Period.

### Code Discipline

- No comments unless the WHY is non-obvious and would surprise a future reader.
- No error handling for scenarios that cannot happen.
- No feature flags or backwards-compat shims — just change the code.
- No added abstractions beyond what the task requires.
- Prefer editing existing files over creating new ones.
- Do not introduce security vulnerabilities (XSS, SQL injection, command injection, etc.).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19.2.6, Vite 8.0.12 |
| Styling | Tailwind CSS 4.3.1 (`@tailwindcss/vite` plugin) |
| Routing | React Router Dom 7.18.0 |
| HTTP Client | Axios 1.18.1 |
| Icons | Lucide React 1.21.0 |
| Backend | Laravel 12.0, PHP 8.2+ |
| Auth | Laravel Sanctum 4.0 (Bearer token via `localStorage`) |
| Database | SQLite (`server/database/database.sqlite`) |

---

## Directory Map

```
HIUSA-FULL/
├── client/
│   └── src/
│       ├── assets/                  # Logos and images (Hiusa Logo.png)
│       ├── components/
│       │   ├── elections/           # Election sub-nav/breadcrumb components
│       │   └── layout/              # DashboardLayout, Sidebar, TopBar
│       ├── mockData/                # Temporary mock data
│       ├── pages/
│       │   └── elections/           # Election/voting page views
│       ├── services/
│       │   ├── api.js               # Axios instance (reads VITE_API_URL, injects Bearer token)
│       │   └── authService.js       # login, register, logout, current user
│       ├── App.jsx                  # Router tree
│       ├── LoggedInRoute.jsx        # Redirects logged-in users away from /login
│       └── ProtectedRoute.jsx       # Redirects unauthenticated users to /login
└── server/
    ├── app/Http/Controllers/        # API business logic
    ├── app/Models/                  # Eloquent models
    ├── database/migrations/         # Schema definitions
    ├── database/seeders/            # Test data
    └── routes/api.php               # REST routes (guest + auth:sanctum groups)
```

---

## Auth & Routing

- Token stored in `localStorage` as `auth_token`.
- `api.js` interceptor auto-appends `Authorization: Bearer <token>`.
- Guest routes (`/login`) wrapped in `LoggedInRoute.jsx` — authenticated users go to `/dashboard`.
- Protected routes wrapped in `ProtectedRoute.jsx` — unauthenticated users go to `/login`.
- Dashboard shell renders via `DashboardLayout.jsx` with `<Outlet />` for nested routes.

---

## Database Models

| Model | Table | Purpose |
|---|---|---|
| User | users | Credentials, roles, profiles |
| Announcement | announcements | Bulletins and notices |
| Event | events | Calendared activities |
| Attendance | attendance | Event check-in records |
| Task | tasks | Action items with assignees and deadlines |
| Budget | budgets | Budget categories and totals |
| Transaction | transactions | Financial logs (deposits, expenses) |
| FinancialForecast | financial_forecasts | Future budget estimates |
| Merchandise | merchandise | Store items, stock, unit prices |
| Order | orders | Merchandise purchases by users |
| Election | elections | Election instances |
| ElectionPosition | election_positions | Positions per election |
| Candidate | candidates | Candidates tied to position and partylist |
| Vote | votes | Cast ballots (prevents double voting) |
| Notification | notifications | System alerts per user |

---

## Adding Features

### New Page & Route
1. Add JSX file in `client/src/pages/` (or a module subfolder).
2. Import and register in `App.jsx` under the appropriate route block.
3. Add a nav link in `Sidebar.jsx`.

### New API Endpoint
```bash
# In /server
php artisan make:model ModelName -mcr   # Model + Migration + Controller
php artisan migrate
```
Then:
1. Write controller logic in the generated Controller.
2. Register the route in `server/routes/api.php` under the `auth:sanctum` group.
3. Create `client/src/services/exampleService.js`:
   ```js
   import api from './api';
   export const fetchExamples = () => api.get('/examples');
   ```
4. Call from the page component inside `useEffect` or a handler.

---

## Design System

This is the only design reference. Do not deviate from these values.

### Colors

| Token | Hex | Usage |
|---|---|---|
| Primary Blue | `#0B8ED0` | Buttons, active nav, links |
| Primary Blue Hover | `#0878B7` | Hover state |
| Electric Cyan | `#16C7F3` | Focus rings, chart accents only |
| Deep Navy | `#0B1831` | Sidebar background |
| Dashboard Navy | `#0F2F62` | Secondary dark panels |
| Page Background | `#EEF6FB` | Main app background |
| Surface White | `#FFFFFF` | Cards, forms, modals |
| Border | `#DDE7EF` | Dividers, input borders |
| Text Strong | `#0F172A` | Titles, table values |
| Text Muted | `#64748B` | Descriptions, helper text |
| Text Soft | `#94A3B8` | Placeholders |
| Success | `#16A34A` | Completed, approved |
| Warning | `#F59E0B` | Pending, review |
| Danger | `#DC2626` | Destructive, failed |

### Typography

- **Font: Poppins only.** Applied via `font-sans` in Tailwind.
- Page title: 28–32px, weight 800–900.
- Section title: 20–24px, weight 700–800.
- Card title: 16–18px, weight 700.
- Body: 14–16px, weight 400–500.
- Labels: 13px, weight 600.
- Tables: 13–14px, weight 500.
- Helper/metadata: 12–13px, weight 500.
- No negative letter-spacing. No long centered paragraphs in admin screens. Uppercase only for short labels, badges, tabs.

### Spacing System (8px base)

4px / 8px / 12px / 16px / 20px / 24px / 32px

### Layout

- Sidebar: fixed, 260px wide, background `#0B1831`.
- Top bar: 64–72px height, white, border-bottom `#DDE7EF`.
- Content padding: 24px desktop / 16px tablet / 14px mobile.
- Main background: `#EEF6FB`.
- Desktop grid: 12 columns, 2–4 metric cards per row.
- Tablet: 2 columns. Mobile: 1 column, sidebar collapses to drawer.

### Sidebar Sections (in order)

Dashboard — Members — Payments — Events — Voting — Reports — Settings

Settings and logout go at the bottom.

### Components

**Buttons**
- Primary: bg `#0B8ED0`, hover `#0878B7`, text white, height 44px, border-radius 6–8px, weight 700.
- Secondary: bg white, border `#DDE7EF`, text `#0F172A`, hover bg `#F8FBFD`.
- Danger: bg `#DC2626`, hover `#B91C1C`, text white.
- One primary button per form or page header.

**Inputs**
- Height 44px, border `#DDE7EF`, focus border `#0B8ED0`, focus ring `rgba(22,199,243,0.15)`, border-radius 6px.
- Labels: 13px, weight 600, color `#0F172A`, placed above input.

**Cards**
- bg white, `1px solid #DDE7EF`, border-radius 8px, padding 16–20px, `shadow-sm` or none.
- No nested cards. Use internal dividers or spacing for sections.

**Badges**
- Height 24–28px, border-radius 999px, font-size 12px, weight 700.
- Light bg with colored text: paid=green, pending=amber, failed=red, active=blue.

**Tables**
- Header bg `#F8FBFD`, row height 52–60px, border `#E5EDF3`, hover `#F8FBFD`.
- Actions on the right. Status via badges.

**Modals**
- White bg, radius 8px, 420–640px wide (near full-width on mobile with 16px margin).
- Overlay: dark navy at 40–55% opacity.

**Icons**
- `lucide-react` only. Sidebar: 18–20px. Cards: 20–24px. Buttons: 16–18px. Empty states: 36–48px.
- Icons support labels — do not replace text with icons.

### Auth Page

- Left brand panel: dark blue gradient + HIUSA logo.
- Right panel: white, form width ~370px.
- No stripes, no overlapping text, no gradients on form side.
- Mobile: brand panel stacks above form.

### Responsive

- Mobile < 640px: single column, stacked cards, sidebar drawer, 14–16px padding, no horizontal scroll, 42px+ touch targets.
- Tablet 640–1024px: 2 columns.
- Desktop ≥ 1024px: fixed sidebar + top bar, 12-column data grids.

### Accessibility

- Strong contrast on all text/background pairs.
- Every input has a visible label.
- Icon-only actions have `aria-label`.
- Focus states visible on all interactive elements.
- Status must include text label, not just color.
- Buttons use real `<button>` elements.

---

## Visual Rules

**Do:** Deep navy for structure. Primary blue for actions. Subtle borders over heavy shadows. Poppins + exact palette only. Mobile as first-class.

**Do not:** Stripe decorations. Heavy gradients on dashboard pages. Cards inside cards. Hero text in admin screens. Random blue shades. Overuse of cyan. Text overlapping decorative elements. Generic fonts (Inter, Roboto, system-ui). AI slop UI patterns.

---

## Recommended Component Structure

```
components/auth/AuthLayout.jsx
components/auth/BrandingPanel.jsx
components/auth/LoginForm.jsx
components/ui/Button.jsx         — variant="primary"|"secondary"|"danger"
components/ui/InputField.jsx
components/ui/Card.jsx
components/layout/DashboardShell.jsx
components/layout/Sidebar.jsx
components/layout/TopBar.jsx
```

Use semantic prop names (`variant="primary"`, `status="paid"`). Keep component APIs minimal at first.

---

## Implementation Plan — v1.0

Full-stack build roadmap. Follow phases in order. Do not start Phase 2 until all Phase 1 routes return correct responses from Postman/curl.

### Codebase Audit — Current State

**Fully Built (Frontend + Backend)**
- Auth: login / register / logout
- User Management: admin CRUD (list, update, disable, delete)
- Elections: full backend + frontend + service file
- All 15 database migrations (schema exists for everything)
- Role-based routing and auth guards
- Sidebar, TopBar, DashboardLayout shell
- `electionService.js`, `userService.js`, `authService.js`

**Frontend Only — No Backend API Yet**
- Announcements: pages exist, running on mock data
- Events: pages exist, running on mock data
- Tasks: pages exist, running on mock data
- Finance (budgets/transactions/forecasts): pages exist, running on mock data
- Merchandise & Orders: pages exist, running on mock data
- Settings / Profile: page exists, no save endpoint
- Notifications: table exists, no controller or routes

**Not Yet Implemented at All**
- `AnnouncementController` + routes
- `EventController` + routes
- `TaskController` + routes
- `BudgetController` + `TransactionController` + `FinancialForecastController` + routes
- `MerchandiseController` + `OrderController` + routes
- `NotificationController` + routes
- `AttendanceController` + routes
- Profile update endpoints
- All frontend service files: `announcementService.js`, `eventService.js`, `taskService.js`, `financeService.js`, `merchandiseService.js`, `orderService.js`, `notificationService.js`, `profileService.js`
- Global 401 interceptor on Axios
- Logo integration (`hiusalogo.svg`)

---

### Phase 0 — Foundation & Pre-Flight

Fix the plumbing before building rooms. Errors here cascade into every phase.

**Environment Setup**
- Create `client/.env` with `VITE_API_URL=http://localhost:8000/api`
- Create `server/.env` from .env.example — set `APP_KEY`, `DB_CONNECTION=sqlite`, absolute path for `DB_DATABASE`
- Run `php artisan key:generate` if APP_KEY is missing — Sanctum token signing depends on it
- Create `client/.env.example` and `server/.env.example` for teammates
- Verify both `.env` files are in `.gitignore`

**CORS Configuration (`server/config/cors.php`)**
- `allowed_origins` must include the Vite dev URL: `http://localhost:5173`
- `supports_credentials` must be `true`
- For production: restrict to the deployed frontend domain only — never `*`

**Axios Global Error Interceptor (`client/src/services/api.js`)**
- Add response interceptor: `401` → clear `localStorage`, redirect to `/login`
- `403` → show "You don't have permission" message
- `422` → extract `response.data.errors` and return them to the calling form
- `5xx` → show generic "Something went wrong. Try again." toast

**Standardize Laravel API Responses**
- All controllers return `{ success, data, message }` on success
- All failures return `{ success: false, message, errors }`
- Use `$request->validate([...])` in every `store()` and `update()` — auto-returns 422 on failure
- Wrap controller methods in try/catch → return 500 with message on unexpected exceptions

**Database Index Additions (new migration file)**
- Index on `announcements(is_published, target_role)` — queried together on every feed load
- Index on `tasks(assigned_to, status)` — officer dashboard queries these
- Index on `events(status, start_time)` — upcoming events queries
- Index on `orders(student_id, status)` — student order history

---

### Phase 1 — Backend API: All Missing Modules

Build every unimplemented controller and register all routes. Do these in order.

#### 1A — AnnouncementController

| Method | Route | Action | Roles |
|---|---|---|---|
| GET | /announcements | index() | all |
| POST | /announcements | store() | admin, officer |
| PUT | /announcements/{id} | update() | admin, officer |
| DELETE | /announcements/{id} | destroy() | admin, officer |
| PATCH | /announcements/{id}/publish | togglePublish() | admin, officer |

- `index()`: students and advisers see only `is_published=true`; admin/officer see all. Filter by `target_role` (show 'all' + user's own role)
- `store()`: validate `title` (required), `body` (required), `target_role` (enum: all/student/officer/adviser), `is_published` (bool). Set `created_by` = auth user
- `update()`: only creator or admin may edit
- `togglePublish()`: flip `is_published`, return updated record

#### 1B — EventController + AttendanceController

| Method | Route | Action | Roles |
|---|---|---|---|
| GET | /events | index() | all |
| GET | /events/{id} | show() | all |
| POST | /events | store() | officer |
| PUT | /events/{id} | update() | officer |
| DELETE | /events/{id} | destroy() | officer |
| PATCH | /events/{id}/status | updateStatus() | officer |
| GET | /events/{id}/attendance | getAttendance() | officer, adviser |
| POST | /events/{id}/attendance | recordAttendance() | officer |

- `index()`: students see status IN [approved, ongoing, completed] only; others see all. Order by `start_time ASC`
- `store()`: validate `title`, `start_time`, `end_time` (must be after start_time), `status` (enum), `location` (nullable)
- `recordAttendance()`: validate `user_id`, `method` (enum: biometric/manual). Unique constraint on (event_id, user_id) — return 409 if already checked in
- Eager load `creator` on all event responses to avoid N+1

#### 1C — TaskController

| Method | Route | Action | Roles |
|---|---|---|---|
| GET | /tasks | index() | officer, adviser |
| POST | /tasks | store() | officer |
| PUT | /tasks/{id} | update() | officer |
| DELETE | /tasks/{id} | destroy() | officer |
| PATCH | /tasks/{id}/status | updateStatus() | officer |

- `index()`: accept query params `?event_id=`, `?assigned_to=`, `?status=`. Eager load `assignee`, `creator`, `event`
- `store()`: validate `title` (required), `deadline` (required, date), `status` (enum: pending/in_progress/completed/overdue), `assigned_to` (nullable, must be valid user_id), `event_id` (nullable)
- Add artisan command `MarkOverdueTasks` scheduled daily to auto-set `status=overdue` when deadline passes

#### 1D — Finance: BudgetController + TransactionController + FinancialForecastController

| Method | Route | Action | Roles |
|---|---|---|---|
| GET | /budgets | index() | officer, adviser |
| POST | /budgets | store() | officer |
| PUT | /budgets/{id} | update() | officer |
| DELETE | /budgets/{id} | destroy() | officer |
| GET | /transactions | index() | officer, adviser |
| GET | /transactions/summary | summary() | officer, adviser |
| POST | /transactions | store() | officer |
| DELETE | /transactions/{id} | destroy() | officer |
| GET | /forecasts | index() | officer, adviser |
| POST | /forecasts | store() | officer |
| PUT | /forecasts/{id} | update() | officer |

- `transactions/summary`: return total income, total expense, net balance — grouped by category. Accept `?from=&to=` date range
- Budget `destroy()`: check for existing transactions — block deletion if found, return 409
- Transaction `store()`: validate `type` (income/expense), `amount` (numeric, min:0.01), `category`, `description`, `budget_id` (nullable), `transaction_date`
- Eager load `budget` and `recorder` on transaction responses

#### 1E — MerchandiseController + OrderController

| Method | Route | Action | Roles |
|---|---|---|---|
| GET | /merchandise | index() | all |
| POST | /merchandise | store() | officer |
| PUT | /merchandise/{id} | update() | officer |
| DELETE | /merchandise/{id} | destroy() | officer |
| PATCH | /merchandise/{id}/stock | adjustStock() | officer |
| GET | /orders | index() | officer, student |
| POST | /orders | store() | student |
| PATCH | /orders/{id}/status | updateStatus() | officer |
| POST | /orders/claim | claimByToken() | officer |

- Students: `GET /merchandise` returns only `is_active=true` items
- `orders index()`: officer sees all; student sees only own (`WHERE student_id = auth()->id()`)
- `orders store()`: validate stock available before accepting. Decrement `stock_quantity` atomically. Generate `claim_token = Str::upper(Str::random(8))`. Set `total_price = quantity * unit_price`
- `claimByToken()`: accept `{ claim_token }`, find order, validate `status=paid`, update to `claimed` + set `claimed_at`
- Block merchandise delete if it has pending/paid orders

#### 1F — NotificationController

| Method | Route | Action | Roles |
|---|---|---|---|
| GET | /notifications | index() | all |
| PATCH | /notifications/{id}/read | markRead() | all |
| PATCH | /notifications/read-all | markAllRead() | all |
| POST | /notifications | store() | admin, officer |

- `index()`: auth user's notifications only, ordered `created_at DESC`. Include unread count in response
- `markRead()`: verify notification belongs to auth user before updating
- `store()`: accept `user_id` or `target_role` for bulk-notify, `title`, `message`

#### 1G — Profile/Settings (additions to UserController)

| Method | Route | Action | Roles |
|---|---|---|---|
| PUT | /user/profile | updateProfile() | all |
| PUT | /user/password | updatePassword() | all |

- `updateProfile()`: allow update of `first_name`, `last_name`, `email`. Validate email uniqueness excluding own record
- `updatePassword()`: require `current_password`, validate against stored hash before allowing change

#### 1H — Voter Management (addition to ElectionController)

- Add `GET /elections/{id}/voters` → return all users with `role=student`, each with a boolean `has_voted` field (check votes table for this election_id + voter_id)
- Keep all students eligible by default for v1. No separate eligibility table needed.

---

### Phase 2 — Frontend Service Files

Create 8 missing service files in `client/src/services/`. All functions return the Axios promise directly — no try/catch inside service files, let the page handle errors.

- `announcementService.js`: `getAnnouncements(params)`, `createAnnouncement(data)`, `updateAnnouncement(id, data)`, `deleteAnnouncement(id)`, `togglePublish(id)`
- `eventService.js`: `getEvents(params)`, `getEvent(id)`, `createEvent(data)`, `updateEvent(id, data)`, `deleteEvent(id)`, `updateEventStatus(id, status)`, `getAttendance(id)`, `recordAttendance(id, data)`
- `taskService.js`: `getTasks(params)`, `createTask(data)`, `updateTask(id, data)`, `deleteTask(id)`, `updateTaskStatus(id, status)`
- `financeService.js`: `getBudgets()`, `createBudget(data)`, `updateBudget(id, data)`, `deleteBudget(id)`, `getTransactions(params)`, `createTransaction(data)`, `deleteTransaction(id)`, `getTransactionSummary(params)`, `getForecasts()`, `createForecast(data)`, `updateForecast(id, data)`
- `merchandiseService.js`: `getMerchandise(params)`, `createItem(data)`, `updateItem(id, data)`, `deleteItem(id)`, `adjustStock(id, qty)`
- `orderService.js`: `getOrders(params)`, `placeOrder(data)`, `updateOrderStatus(id, status)`, `claimByToken(token)`
- `notificationService.js`: `getNotifications()`, `markRead(id)`, `markAllRead()`, `sendNotification(data)`
- `profileService.js`: `updateProfile(data)`, `updatePassword(data)`

---

### Phase 3 — Wire Pages to Real API, Remove All Mock Data

Pattern to apply to every page:
1. Remove import from `mockData/` — delete the mock file if nothing else imports it
2. Add `isLoading` state → render skeleton or spinner while fetching
3. Add `error` state → render inline error message with a retry button
4. Add empty state → helpful message when API returns an empty array

Pages to update:
- `ManageAnnouncementsPage.jsx` → `announcementService.getAnnouncements()`
- `CreateAnnouncementPage.jsx` → `announcementService.createAnnouncement()`, navigate back on success
- `AnnouncementsFeedPage.jsx` → `announcementService.getAnnouncements()` with published filter
- `EventsPage.jsx` events tab → `eventService.getEvents()`; tasks tab → `taskService.getTasks()`; attendance tab → `eventService.getAttendance()` + `recordAttendance()`
- `FinancePage.jsx` → `financeService.getTransactions()` / `getBudgets()` / `getTransactionSummary()` / `getForecasts()` per tab
- `TasksPage.jsx` → `taskService.getTasks()`, status updates, create form
- `MerchandisePage.jsx` → `merchandiseService.getMerchandise()` / `orderService.getOrders()` / `orderService.claimByToken()` per tab
- `SettingsPage.jsx` → `profileService.updateProfile()`, prefill from `/user` endpoint
- `ManageVotersPage.jsx` → `electionService` new voters endpoint from Phase 1H
- `DashboardPage.jsx` (officer) → `Promise.all()` across task, event, budget, order counts
- `StudentHomePage.jsx` → elections, events, announcements, merchandise via real services
- `AdminHomePage.jsx` → user counts, announcement counts via real services
- `AdviserHomePage.jsx` → events, tasks, elections via real services

**Election pages — verify these edge cases:**
- `CastVotePage.jsx`: double-vote must show "You've already voted for this position", not a generic error
- `ElectionResultsPage.jsx`: must handle 0 votes gracefully

---

### Phase 4 — UI Refinements

**4A — Logo Integration (`hiusalogo.svg`)**
- `Sidebar.jsx`: `<img src="/hiusalogo.svg">` at 36–40px height in the 72px logo area. Pair with "HIUSA" uppercase weight 800 white text
- `TopBar.jsx`: compact logo 34–38px for mobile collapsed state
- `LoginPage.jsx`: logo at 44px on the dark navy brand panel

**4B — Login Page Role Tabs (match Figma)**
- 4 tabs: Admin, Adviser, Officer, Student. Active: `#0B8ED0` with bottom border. Inactive: `#64748B`
- Submit button label updates per tab: "Sign in as Officer" etc.
- Placeholder updates per role: Admin/Officer/Adviser use email; Student uses "Student ID"
- Pass `role` in login request body — backend verifies the user's actual role matches. Return 403 if mismatched

**4C — Role-Specific Dashboard Pages**
- **Officer**: 4 metric cards (Open Tasks, Upcoming Events, Budget Balance, Merch Orders pending). Tasks overview table (4 most urgent). Budget utilization bars by category. Quick Actions row. Use `Promise.all()` to load all widgets in parallel.
- **Admin**: User count by role (4 role pills), published announcements count, total users, Quick Actions: Create User + Create Announcement
- **Adviser**: Read-only — Upcoming Events list, Active Election card, Task completion progress bar, Recent announcements (3 items)
- **Student**: Active election card with "Cast Vote" CTA (if election active + student hasn't voted), Upcoming Events (next 3), Announcements feed (latest 5), Available Merchandise grid

**4D — Notification Bell in TopBar**
- Lucide `Bell` icon, 20px. Unread badge: `#16C7F3` bg, white text, 16px pill. Hide when count = 0
- Dropdown: last 5 notifications (title + message + relative time). "Mark all read" button
- Fetch on mount and on `window focus` event
- Each row: click → mark read + navigate to relevant section

**4E — TopBar Role Indicator**
- Show Admin / Adviser / Officer / Student chips. Current user's role chip highlighted in `#0B8ED0`. Others: muted outlines
- Display-only — not a live role switcher

---

### Phase 5 — Production Hardening

**Security**
- Audit every route in `api.php` — verify role middleware is correct on all routes
- Every `store()` and `update()` must have `$request->validate([...])`
- Frontend: validate required fields, email format, date ranges (end > start), positive numbers before submit
- Admin cannot be deleted or disabled — verify check covers ALL admin users, not just the authenticated one
- Ownership checks on updates/deletes: announcement and task edits must verify creator or admin, not just any officer

**Performance**
- Eager load all relationships in every controller returning a collection — use `->with([...])`
- Add `->paginate(20)` on all index() endpoints that can return large datasets (transactions, orders, announcements). Frontend must handle paginated responses.
- Dashboard widgets must use `Promise.all()` — no sequential awaits

**Database / Environment**
- SQLite → MySQL for production with concurrent users
- Set `APP_ENV=production`, `APP_DEBUG=false`, correct `APP_URL`, `VITE_API_URL` in production
- CORS: restrict `allowed_origins` to production frontend domain only
- Set Sanctum token expiry in `config/sanctum.php` — currently tokens never expire
- Take a verified DB backup before every production migration

**Critical Test Scenarios — Must Pass Before Any Deploy**
1. Double-vote attempt: cast vote, try again → "Already voted" error, not a 500
2. Student accesses `/dashboard/admin` → redirects to student dashboard, not 403 page
3. Expired token (delete from DB, reload) → redirects to `/login`
4. Place order with quantity > stock → "Insufficient stock" error, order not created
5. Delete budget with existing transactions → blocked with clear message
6. Create announcement with invalid `target_role` → 422 validation error
7. Admin tries to delete themselves → blocked
8. Vote after election closes → "This election is no longer active"
9. Claim merchandise token already claimed → "Token already used"
