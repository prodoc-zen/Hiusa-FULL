# HIUSA Development Log

## Session: 2026-06-27 — Full-Stack Build (Phases 0–5)

**Developers:** JM + John Carlo Borgueta  
**Branch:** `main`  
**Commits this session:** `427dfb8`, `08eb489`, `c263f9b` + overdue task command

---

## What Was Built

This session took HIUSA from a partially wired skeleton to a fully functional full-stack application. Below is a phase-by-phase account of exactly what was done and why each decision was made.

---

### Phase 3 — Wiring All Pages to Real APIs (commit `427dfb8`)

**What:** Replaced every `mockData/` import across all frontend pages with real API calls via service files. Created the 8 missing service files (`announcementService`, `eventService`, `taskService`, `financeService`, `merchandiseService`, `orderService`, `notificationService`, `profileService`).

**Pages updated:**
- `ManageAnnouncementsPage`, `CreateAnnouncementPage`, `AnnouncementsFeedPage`
- `EventsPage` (events tab + tasks tab + attendance tab)
- `FinancePage` (transactions + budgets + forecasts)
- `TasksPage`
- `MerchandisePage` (inventory + orders + claim tokens)
- `SettingsPage` (profile prefill from localStorage, save via `profileService`)
- `DashboardPage` (officer), `AdminHomePage`, `AdviserHomePage`, `StudentHomePage`, `ManageVotersPage`

**Pattern used for every page:**
```js
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

function load() { /* fetch + setData, setError on catch */ }
useEffect(load, []);
```
- Loading state renders skeleton placeholders (animated `bg-slate-100` divs)
- Error state renders an inline message with a "Retry" button
- Empty state renders a helpful message when the API returns `[]`

**Key decision — ManageVotersPage:**  
Switched from the old approach (fetch all users + check `election.votes` client-side) to `getElectionVoters(election.id)`, which returns each student with a `has_voted` boolean from the backend. This avoids leaking all user data to the client and removes a O(n²) client-side filter.

**Key decision — SettingsPage:**  
After a successful profile save, `localStorage` is updated inline (`localStorage.setItem('user', JSON.stringify({...storedUser, ...res.data}))`) so the TopBar name and initials update immediately without a page reload.

---

### Phase 4 — UI Refinements (commit `08eb489`)

**What:** Four targeted UI improvements across login, navigation, and dashboards.

#### 4A — Login Role Tabs
- 4 tabs: Student / Officer / Adviser / Admin
- Active tab: `#0B8ED0` with bottom border. Inactive: `#64748B`
- Student tab shows a "Student ID" field (maps to `school_id`); all others show email
- Submit label changes per role: "Sign in as Officer" etc.
- Login payload: `{ [email or school_id]: value, password, role }`
- Backend (`UserController.login`) updated with `required_without` validation to accept either field and a 403 response if role doesn't match the DB record

#### 4B — Notification Bell (TopBar)
- Lucide `Bell` icon with `#16C7F3` unread badge
- Fetches on mount + on `window focus` event
- Dropdown: last 5 notifications, each row marks read on click, "Mark all read" button
- Backend `NotificationController.index()` returns `{ notifications: [...], unread_count: N }` — **not a plain array**

#### 4C — Role Chips in TopBar
- Shows Admin / Officer / Adviser / Student as pills at 1280px+
- Current user's role is filled `#0B8ED0` / white; others are muted outline
- Display-only — not a switcher

#### 4D — Role-Specific Dashboards
- **Officer:** 4 metric cards via `Promise.all([getTasks, getEvents, getTransactionSummary, getOrders])`, urgent tasks table (4 by deadline), expenses-by-category bars
- **Admin:** user counts by role (4 pills), published vs draft announcement counts
- **Adviser:** read-only — active election card, upcoming events, task progress bar, 3 recent announcements
- **Student:** active election CTA with "Cast Vote" if `election.status === 'active'`, upcoming events, announcements feed, merch grid

---

### Phase 5 — Production Hardening (commit `c263f9b`)

A security and performance audit was run before writing any code. All 9 critical test scenarios from the spec were verified as passing. The following real gaps were found and fixed:

| # | Fix | File | What Changed |
|---|---|---|---|
| 1 | Task ownership check | `TaskController` | `update()` and `destroy()` now 403 if caller is not the task creator or an admin |
| 2 | Clear double-vote message | `ElectionController.vote()` | Upfront `Vote::where(election+voter)->exists()` check returns 422 `"You have already voted in this election."` before the DB transaction |
| 3 | Token expiry | `config/sanctum.php` | `'expiration' => 10080` (7 days in minutes, was `null`) |
| 4 | Pagination | `TransactionController.index()` | `.get()` → `.paginate(20)` |
| 5 | Pagination | `OrderController.index()` | `.get()` → `.paginate(20)` |
| 6 | Notification extraction bug | `TopBar.jsx` | `res.data.notifications` instead of `Array.isArray(res.data)` (backend wraps array in object) |
| 7 | Paginated tx response | `FinancePage.jsx` | `txRes.data?.data ?? txRes.data` to handle Laravel paginate shape |
| 8 | Paginated orders response | `MerchandisePage.jsx` | Same paginate shape fix for orders |
| 9 | Event time validation | `EventsPage.jsx` | `end_time <= start_time` check before `createEvent()` call |

---

### Post-Phase-5 — Overdue Tasks Command

**What:** Implemented the `MarkOverdueTasks` artisan command that was spec'd in Phase 1C but never built.

- File: `server/app/Console/Commands/MarkOverdueTasks.php`
- Logic: `UPDATE tasks SET status='overdue' WHERE status IN ('pending','in_progress') AND deadline < today`
- Schedule: `dailyAt('00:05')` registered in `routes/console.php`
- Run manually: `php artisan tasks:mark-overdue`
- To activate the scheduler in production, add this cron on the server: `* * * * * php /path/to/server/artisan schedule:run >> /dev/null 2>&1`

---

## Current State of the Codebase

### What is 100% complete and verified

| Layer | Status |
|---|---|
| 12 HTTP Controllers | ✅ All built, all methods, all validated |
| 16 Eloquent Models | ✅ All with correct relationships |
| 21 DB Migrations | ✅ Including performance indexes (announcements, tasks, events, orders) |
| All 12 Service Files | ✅ All functions return raw Axios promises |
| All 24 Page Components | ✅ All wired to real API, no mock data |
| App.jsx routes | ✅ All roles, all modules, all redirects |
| Sidebar nav | ✅ All links match real routes |
| Role-based auth guards | ✅ ProtectedRoute enforces role at every path |
| 401 auto-redirect | ✅ api.js interceptor clears localStorage + navigates to /login |
| Login role tabs | ✅ School ID for student, email for others, role mismatch → 403 |
| Notification bell | ✅ Real API, mark read, mark all read, window focus refresh |
| Token expiry | ✅ 7 days |
| Task ownership | ✅ Only creator or admin can edit/delete |
| Double-vote guard | ✅ Clear 422 before DB transaction |
| Stock check | ✅ lockForUpdate + 422 if insufficient |
| Budget delete guard | ✅ 409 if transactions exist |
| Admin delete guard | ✅ 422 if target is admin |
| Overdue task scheduler | ✅ Daily at 00:05 |

### 9 Critical Test Scenarios — All Pass

1. ✅ Double-vote → "You have already voted in this election." (422)
2. ✅ Student accesses `/dashboard/admin` → redirected to `/dashboard/student`
3. ✅ Expired/deleted token → 401 interceptor → `/login`
4. ✅ Order qty > stock → "Insufficient stock. Only X unit(s) available." (422)
5. ✅ Delete budget with transactions → 409 with message
6. ✅ Invalid `target_role` → 422 from validation
7. ✅ Admin deletes themselves → 422 blocked
8. ✅ Vote after election closes → "This election is not currently accepting votes" (400)
9. ✅ Claim already-claimed token → "This token has already been used." (409)

---

## What the Next Developer Needs to Do

### 1. Environment Setup (30 min)

The app currently runs on SQLite for dev. Before any demo or deploy, switch to MySQL:

```bash
# In server/.env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=hiusa_db
DB_USERNAME=root
DB_PASSWORD=your_password

# Then run:
php artisan migrate:fresh --seed
```

Create `client/.env.production`:
```
VITE_API_URL=https://your-backend-domain.com/api
```

Create `server/.env` for production:
```
APP_ENV=production
APP_DEBUG=false
APP_URL=https://your-backend-domain.com
```

### 2. CORS (5 min)

In `server/config/cors.php`, change `allowed_origins` from `['*']` or the dev URL to your deployed frontend domain.

### 3. Build & Deploy

```bash
# Frontend
cd client && npm run build   # outputs to client/dist/

# Backend
php artisan config:cache
php artisan route:cache
php artisan optimize
```

### 4. Activate the Scheduler

On the production server, add this cron (replace path):
```
* * * * * php /var/www/hiusa/server/artisan schedule:run >> /dev/null 2>&1
```

### 5. Optional Polish (nice to have, not blocking)

These are non-critical quality-of-life items:

- **Database seeders** — Add `php artisan db:seed` with realistic sample data for the capstone panel demo. Create seeder classes in `server/database/seeders/` for: `UserSeeder`, `ElectionSeeder`, `EventSeeder`, `MerchandiseSeeder`, `AnnouncementSeeder`. A good demo needs data.
- **Report exports** — The Finance page has a "Reports" tab (`FinancePage initialTab="reports"`). The tab exists but the export-to-PDF/CSV functionality was never built. Low priority unless the panel asks.
- **Email notifications** — `NotificationController.store()` creates in-app notifications only. No email is sent. Would need Laravel Mail + an SMTP provider.
- **Merchandise images** — `Order` and `Merchandise` models have `image_url` fields but the create/edit forms have no image upload UI. Items display a placeholder icon.
- **Pagination UI** — `TransactionController` and `OrderController` now return paginated responses but the frontend doesn't show page navigation controls. It only renders the first 20 results. Add a pagination component if the data grows.

---

## Architecture Reference

### How Auth Works
1. `POST /api/login` with `{ email or school_id, password, role }` → returns `{ user, access_token }`
2. Token stored in `localStorage` as `auth_token`. User object stored as `localStorage.user`.
3. `client/src/services/api.js` interceptor adds `Authorization: Bearer <token>` to every request.
4. On any 401 response, the interceptor clears localStorage and redirects to `/login`.
5. Token expires after 7 days (set in `config/sanctum.php`).

### Role Routing
- `/dashboard` → `DashboardIndexRedirect` reads `localStorage.user.role` and sends to `/dashboard/{role}`
- `ProtectedRoute` wraps all routes with `allowedRoles`. A mismatch redirects to `/dashboard/{actual_role}` rather than showing a 403 page.
- Each role has its own home page: `AdminHomePage`, `DashboardPage` (officer), `AdviserHomePage`, `StudentHomePage`.

### Service File Convention
All service files return raw Axios promises — no try/catch inside service files. Error handling is done in the page component. This keeps services simple and testable.

```js
// Service file — always like this:
export const createTask = (data) => api.post('/tasks', data);

// Page component — handles errors:
try {
  await createTask(data);
} catch (err) {
  setError(err.response?.data?.message ?? 'Failed.');
}
```

### Laravel Response Convention
- All controllers return `{ success, data, message }` on success
- Failures return `{ success: false, message, errors }` with the appropriate HTTP status

### Paginated Responses
`TransactionController` and `OrderController` return Laravel paginate format:
```json
{ "current_page": 1, "data": [...], "total": 45, "per_page": 20 }
```
The frontend extracts `res.data.data` for the array. Other endpoints still return plain arrays via `.get()`.

---

## File Map (Key Files to Know)

```
client/src/
  App.jsx                          — All routes, role-redirect helpers
  services/api.js                  — Axios instance + global interceptors
  components/layout/DashboardLayout.jsx  — Shell wrapping all dashboard pages
  components/layout/Sidebar.jsx    — Nav structure, role-aware visibility
  components/layout/TopBar.jsx     — Notification bell, role chips, profile dropdown
  pages/auth/LoginPage.jsx         — Role tabs, school_id vs email login
  pages/elections/CastVotePage.jsx — Student ballot UI
  pages/elections/ElectionResultsPage.jsx — Live results
  pages/modules/settings/SettingsPage.jsx — Profile + password update

server/
  routes/api.php                   — All REST routes
  routes/console.php               — Scheduled commands (tasks:mark-overdue)
  app/Http/Controllers/            — All 12 controllers
  app/Models/                      — All 16 models
  config/sanctum.php               — Token expiry = 10080 min (7 days)
  config/cors.php                  — Update allowed_origins for production
```
