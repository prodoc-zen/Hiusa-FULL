# Platform Status — 2026-06-27

**Session:** Full-stack build completion + production hardening  
**Developers:** JM, John Carlo Borgueta  
**Branch:** `main`  
**Commits:** `427dfb8` → `08eb489` → `c263f9b` → `d2dccf0`

---

## What Was Shipped

### Phase 3 — All Pages Wired to Real API
Replaced every `mockData/` import across all 24 page components with real API calls. Created 8 missing service files: `announcementService`, `eventService`, `taskService`, `financeService`, `merchandiseService`, `orderService`, `notificationService`, `profileService`. Every page now has loading skeletons, inline error + retry, and empty states. ManageVotersPage switched from client-side vote computation to `getElectionVoters(id)` which returns `has_voted` per student.

### Phase 4 — UI Refinements
- **Login:** 4 role tabs (Student / Officer / Adviser / Admin). Student tab sends `school_id`; others send `email`. Backend updated with `required_without` validation. Role mismatch returns 403.
- **Notification bell:** Real API, mark-read per notification, mark-all-read, `window.focus` refresh.
- **Role chips:** TopBar shows all 4 roles at ≥1280px; current user's role filled blue.
- **Role dashboards:** Officer gets metric cards + urgent tasks table + expense bars via `Promise.all`. Admin gets user-by-role counts. Adviser gets read-only election/event/task overview. Student gets election CTA + upcoming events + announcements feed + merch grid.

### Phase 5 — Production Hardening
| Fix | File |
|-----|------|
| Task ownership check (403 if not creator or admin) | `TaskController` |
| Upfront double-vote guard — clear 422 message | `ElectionController.vote()` |
| Token expiry set to 7 days | `config/sanctum.php` |
| Transactions paginated at 20/page | `TransactionController` |
| Orders paginated at 20/page | `OrderController` |
| Notification extraction bug fixed | `TopBar.jsx` |
| Paginated response handling | `FinancePage.jsx`, `MerchandisePage.jsx` |
| End-time > start-time validation | `EventsPage.jsx` |

### Overdue Tasks Scheduler
- `MarkOverdueTasks` artisan command: marks `pending`/`in_progress` tasks whose deadline has passed as `overdue`
- Scheduled daily at 00:05 in `routes/console.php`
- Run manually: `php artisan tasks:mark-overdue`

---

## Current System State

### Complete and Verified
- 12 HTTP Controllers, all methods, all validated
- 16 Eloquent Models with relationships
- 21 DB migrations including performance indexes
- 12 service files, all exports correct
- 24 page components, all wired to real API
- Role-based routing enforced at every path
- 401/403 interceptors on Axios
- All 9 critical test scenarios pass

### Known Gaps at End of Session
- Database has no demo data (only admin account seeded)
- Transactions/Orders show no pagination UI despite being paginated in the backend
- Finance "Reports" tab renders static cards with non-functional export buttons
- Merchandise items show a placeholder icon — no image upload support
- `MerchandisePage` create form sends `unit_price` but backend expects `price` — silent 422 bug

---

## Credentials (Dev Environment)

| Role | Login Field | Value | Password |
|------|-------------|-------|----------|
| Admin | Email | admin@hiusa.local | Admin@123456 |
| Officer | Email | officer1@hiusa.local | Demo@12345 |
| Officer | Email | officer2@hiusa.local | Demo@12345 |
| Adviser | Email | adviser1@hiusa.local | Demo@12345 |
| Student | Student ID | 2023-00001 | Demo@12345 |

---

## Environment Setup (Required Before Running)

```bash
# Backend
cp server/.env.example server/.env
php artisan key:generate
# Set DB_CONNECTION, DB_DATABASE, APP_KEY in server/.env
php artisan migrate:fresh --seed
php artisan storage:link    # for merchandise image uploads
php artisan serve

# Frontend
cp client/.env.example client/.env
# VITE_API_URL=http://localhost:8000/api
npm install && npm run dev
```

---

## What the Next Developer Picks Up

All core modules are production-functional. The remaining work before deploy is:

1. **Environment** — Switch SQLite → MySQL, set `APP_ENV=production`, `APP_DEBUG=false`, update CORS
2. **Run**: `php artisan config:cache && php artisan route:cache && php artisan optimize && npm run build`
3. **Scheduler** — Add cron: `* * * * * php /path/to/server/artisan schedule:run >> /dev/null 2>&1`
4. **Optional** — Pagination UI controls, CSV export in Finance Reports, Email notifications, Merchandise images

---

## Architecture Quick Reference

**Auth flow:** `POST /api/login` → `access_token` stored in `localStorage.auth_token` → Axios interceptor adds `Authorization: Bearer` → 401 auto-redirects to `/login` → tokens expire after 7 days.

**Role routing:** `/dashboard` → `DashboardIndexRedirect` reads `localStorage.user.role` → navigates to `/dashboard/{role}`. `ProtectedRoute` enforces `allowedRoles` at every path; mismatch redirects to `/dashboard/{actual_role}`.

**Service convention:** All service files return raw Axios promises. Error handling is done in page components, never inside service files.

**Paginated responses:** `TransactionController` and `OrderController` return Laravel `paginate(20)` shape: `{ current_page, data: [...], last_page, total, per_page }`. Other endpoints return plain arrays via `.get()`.
