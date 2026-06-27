# HIUSA Gap Analysis — Capstone Paper vs. Current Implementation
**Date**: 2026-06-27  
**Cross-referenced**: `HIUSA - FINAL PAPER.txt` vs. current codebase

This document lists every gap between what the capstone paper describes and what is currently built. Use it to drive the next development sprint before defense.

---

## 1. Missing Entirely (Not Built at All)

### 1.1 Forgot Password / OTP Reset Flow
**Paper ref**: Screen 2–3 (p. 1729–1805)  
Full 3-screen flow: "Forgot Password?" link on login → email entry → 6-digit OTP with 5-minute countdown + "Resend Code" → password reset form.  
**Gap**: `password_reset_tokens` table exists but no controller, no email/OTP logic, no frontend pages, and no "Forgot Password?" link on `LoginPage.jsx`.

### 1.2 AI Event Planner (Groq API)
**Paper ref**: Screen 19 (p. 3147–3250)  
Officer inputs Event Name, Type, Expected Attendance, Date, Budget Envelope → "Generate AI Plan & Workflow" → Groq API returns timestamped timeline + pre-event checklist with persistent checkboxes. Listed as a distinct sidebar nav item "Events > Event Planner."  
**Gap**: No `EventPlannerPage.jsx`, no backend endpoint, no Groq API integration. This is one of the paper's headline AI features.

### 1.3 AI Announcement Drafting (Groq API)
**Paper ref**: p. 385, 391  
Officers supply a prompt → Groq API returns a generated announcement draft directly in the create form.  
**Gap**: `CreateAnnouncementPage.jsx` and `AnnouncementController` have no prompt field, no Groq call.

### 1.4 Activity Calendar Page
**Paper ref**: Screen 21 (p. 3393–3485)  
Full-month calendar grid, event-dot markers, dark-blue active day highlight, side panel with upcoming events, prev/next month navigation. Listed as "Events > Activity Calendar" in sidebar.  
**Gap**: No calendar component, no route, no sidebar link.

### 1.5 Task Progress Monitor with Subtasks
**Paper ref**: Screen 28 (p. 4017–4108)  
Dedicated "Monitor Progress" route — KPI cards, left master list with per-task completion bars computed from subtask ratio, right drill-down panel with interactive subtask checklist. Subtasks stored in DB.  
**Gap**: No subtask data model, no migration, no dedicated monitor route. `TasksPage.jsx` "progress" tab shows per-officer workload, not per-task subtasks.

### 1.6 Budget Reallocate Modal
**Paper ref**: Screen 23 Budget Allocation (p. 3625)  
"Reallocate" button opens a modal to safely transfer fund balances between budget categories without violating global limits.  
**Gap**: No reallocate endpoint in `BudgetController`, no UI in `FinancePage.jsx`.

### 1.7 Receipt Reference Auto-Generation
**Paper ref**: p. 5136  
`receipt_reference` (unique alphanumeric) auto-generated on every transaction to power a digital receipt system.  
**Gap**: Column exists in migration, `TransactionController.store()` never sets it.

---

## 2. Partially Implemented

### 2.1 AI Task Delegation — Match Score + Rationale Missing
**Paper ref**: Screen 27 (p. 3907–3999)  
Side panel shows per-officer **Match Score** integer + **AI Rationale** string + "Assign to [Name]" button. `ai_recommendation_note` column intended to store the rationale.  
**Gap**: `TasksPage.jsx` AI tab sorts by lowest task count but shows no match score, no rationale text. `ai_recommendation_note` is never written on task creation.

### 2.2 OLS Financial Forecasting — CRUD Only, No Computation
**Paper ref**: p. 292, 347, 381 + Screen 24 (p. 3629)  
"Generate New" triggers an Ordinary Least Squares regression on historical transaction data — AI-generated, not manually entered.  
**Gap**: `FinancialForecastController.store()` is plain CRUD accepting officer-supplied values. No algorithm exists.

### 2.3 Financial Insights — No Chart Library
**Paper ref**: Screen 24 (p. 3629–3742)  
6-Month Balance Forecast line chart (actual vs. predicted), donut chart for Budget Distribution by category, Advisory History feed.  
**Gap**: No charting library installed (`recharts`, `chart.js`, etc.), no chart components. `FinancePage.jsx` forecasting tab shows bar divs, not charts.

### 2.4 Merchandise Size Variants
**Paper ref**: Screens 29–33 (p. 4109–4674)  
Per-size stock counts (S/M/L/XL), size selector required before ordering, Low Stock badge per size.  
**Gap**: `merchandise` table has flat `stock_quantity`. No variant model/table, no size selection in student order UI.

### 2.5 Orders — QR Code on Claim Token
**Paper ref**: Screen 32 (p. 4446–4534)  
Scannable QR code rendered alongside the alphanumeric token. Officer side has "Scan Token" camera viewport.  
**Gap**: `MerchandisePage.jsx` shows token strings only. No QR generation or camera scanning.

### 2.6 Biometric Scanner Frontend Wiring
**Paper ref**: Screen 20 (p. 3251–3392)  
"Scanner device connected" green status indicator, "Scan Fingerprint" hardware init button, "Bio" button per student row.  
**Gap**: API accepts `method: 'biometric'` but no frontend UI triggers it. Hardware-dependent; low priority for capstone demo.

### 2.7 Profile Fields — `phone_number`, `department`, `year_level`, `bio` Missing
**Paper ref**: Screen 4 (p. 1809–1895)  
Profile form collects Phone Number, Department (dropdown), Year Level (dropdown), Bio (textarea).  
**Gap**: `users` migration has none of these columns. `updateProfile()` endpoint only saves first name, last name, email.

### 2.8 `is_member` Field — Never Used
**Paper ref**: Data dictionary (p. 4731)  
`is_member boolean` distinguishes PSITS members from general CCS students; gates certain features.  
**Gap**: Column exists in migration and model but is never read, written, or enforced anywhere.

### 2.9 Voter Eligibility — Ineligible Status + Validate Action
**Paper ref**: Screen 14 (p. 2606–2713)  
Filter tabs "All / Voted / Not Yet / Ineligible," Eligibility Status column, "Validate" button with eligibility override overlay.  
**Gap**: `ManageVotersPage.jsx` shows `has_voted` boolean only. No eligibility concept.

### 2.10 Announcement View Counter
**Paper ref**: Screen 10 (p. 2294–2339)  
"Views" column in management table; student feed click increments view count.  
**Gap**: No `views` column in migration, no increment in controller, no display in UI.

---

## 3. Implementation Differs from Paper Description

### 3.1 Login — School ID for All Roles (Paper) vs. Role-Tab + email/ID (Built)
**Paper**: Single "School ID" field for all roles; role inferred server-side.  
**Built**: 4 role tabs with conditional identifier field (`email` for Admin/Officer/Adviser, `school_id` for Student).

### 3.2 Announcement Category Tags — Column Missing
**Paper ref**: Screen 11 filter pills: "All / General / Elections / Events / Finance / Merchandise / Training"  
**Gap**: `announcements` table has `target_role` but no `category` column. Category filtering cannot be implemented without a migration.

### 3.3 Order Status Terminology
**Paper**: Pending → Paid → **Completed**  
**Built**: Pending → Paid → **claimed**  
Minor mismatch; affects student-facing badge labels.

### 3.4 Adviser Blocked from Creating Announcements
**Paper ref**: Use Case p. 915–951 — "Triggering Actor: Admin, Adviser, Officer"  
**Built**: `api.php` announcement routes use `role:admin,officer` — Adviser cannot create/manage announcements. Middleware needs to add `adviser`.

### 3.5 Event Capacity Field Not In Schema
**Paper**: Event cards show "Capacity: 200"  
**Gap**: `events` migration has no `capacity` column.

### 3.6 Task Priority + Tags Not In Schema
**Paper ref**: Screen 27 — Priority dropdown (High/Medium/Low), Tags (Design/Events/Elections/Finance/Operations/Admin)  
**Gap**: `tasks` migration has no `priority` or `tags` columns. No priority badge in task board.

### 3.7 Event School Year Filter + Per-Event Budget Bars
**Paper ref**: Screen 18 — School year filter dropdown at top, per-event budget progress bar (₱3,500 / ₱12,000 = 29%)  
**Gap**: `EventsPage.jsx` has no school year filter. No per-event budget utilization display.

### 3.8 Financial Insights "Generate" = AI, Not Manual Entry
Already covered in §2.2 above.

---

## 4. UI/Flow Requirements Mandated by Paper

| Item | Paper Spec | Current State |
|---|---|---|
| Student dashboard elections CTA | Conditional: hide if student already voted | Needs verification — likely not checking `has_voted` |
| Adviser can manage announcements | Middleware must include `adviser` role | Blocked — `role:admin,officer` only |
| Announcement category filter | `category` column + filter pills on feed | No column, no filter |
| Quick Search in TopBar | System-wide search shortcut visible on all screens | Not built |
| Task priority badges on board | Priority column, red/yellow/grey badges | No column |
| Admin dashboard line + bar charts | Member registration trend, budget by module | No chart library |
| Adviser dashboard income/expense bar chart | Side-by-side bar Jan–Jun | No chart library |
| Officer dashboard budget utilization bars | Per-category bars with live API data | Likely static or missing |
| Event capacity field on cards | `capacity` column | Not in schema |

---

## Recommended Priority Order for Defense Sprint

### Must-Fix (defends the AI claims in the paper)
1. **Groq API integration** — Event Planner + Announcement Drafting. Without this, the paper's central AI claims are demonstrably absent.
2. **OLS forecast generation** — "Generate New" must call a computation, not accept manual input.
3. **Chart library** — Install `recharts` or `chart.js`, implement the 3 dashboard charts and Financial Insights charts. Paper shows them on every screenshot.

### Should-Fix (schema gaps that break displayed features)
4. Add `category` to `announcements` migration + AnnouncementController + feed filter UI
5. Add `priority` + `tags` to `tasks` migration + TaskController + TasksPage badge
6. Add `phone_number`, `department`, `year_level`, `bio` to `users` migration + profile form
7. Add `capacity` to `events` migration + event form + display
8. Fix `Adviser` role in announcement middleware
9. Auto-generate `receipt_reference` in `TransactionController.store()`

### Nice-to-Have (elevates presentation quality)
10. Activity Calendar page (just a monthly grid, manageable scope)
11. Announcement view counter (`views` column + increment on feed view)
12. Order status label "claimed" → "Completed" in UI badges only (no DB change)
13. QR code on claim token (frontend only — `qrcode` npm package, 30 min)
14. Forgot Password / OTP flow

### Out of Scope for Capstone Defense
- Merchandise size variants (schema change + full UI rewrite)
- Biometric scanner frontend wiring (requires hardware)
- Subtasks data model (significant schema + logic change)
- MySQL production migration (deployment concern, not capstone demo)
