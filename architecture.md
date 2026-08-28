# HIUSA Project Architecture

This document serves as a guide to the file structure, technology stack, routing, APIs, and data flow of the HIUSA system. It is designed to help you quickly understand the layout of the project and trace where features, files, or new endpoints are defined.

---

## 🛠️ Technology Stack

The project is structured as a decoupled monorepo containing a frontend client, a backend server, and a Python AI microservice.

### Frontend (`/client`)
- **Framework:** React 19.2.6
- **Build Tool:** Vite 8.0.12
- **Styling:** Tailwind CSS 4.3.1 (using `@tailwindcss/vite` plugin)
- **Routing:** React Router Dom 7.18.0
- **HTTP Client:** Axios 1.18.1
- **Icons:** Lucide React 1.21.0

### Backend (`/server`)
- **Framework:** Laravel 12.0
- **PHP Version:** PHP 8.2+
- **Authentication:** Laravel Sanctum 4.0
- **Database:** MySQL/MariaDB (`hiusa_db`; local development runs it on `127.0.0.1:3307`). SQLite is used only for the automated test suite (`phpunit.xml` pins `:memory:`), never as the development or production database.

### AI Microservice (`/ai-service`)
- **Framework:** FastAPI (Python)
- **Purpose:** Authoritative engine for OLS financial forecasting, deterministic budget-advice rules, and rule-based weighted task delegation scoring. Laravel calls it over HTTP and never recomputes these results itself.
- **Auth:** shared API key, checked by the service's `/health` endpoint (`"authentication": "api-key"`) and enforced on its scoring endpoints.
- **Laravel-side integration:** `app/Services/HiusaAiService.php` calls the Python service; `app/Services/GroqResponsesService.php` calls Groq (`openai/gpt-oss-20b` via `POST https://api.groq.com/openai/v1/responses`) to turn verified engine output into readable narration, falling back to a deterministic narrative when Groq is unavailable or `GROQ_API_KEY` is unset. Both AI calls and their inputs/outputs are persisted through the `AiOutput` model (table `ai_outputs`).
- **Configuration:** `server/.env` needs `HIUSA_AI_SERVICE_ENABLED`, `HIUSA_AI_SERVICE_URL`, `HIUSA_AI_SERVICE_KEY` (must match `ai-service/.env`), `HIUSA_AI_SERVICE_CONNECT_TIMEOUT`, `HIUSA_AI_SERVICE_TIMEOUT`, and the `GROQ_*` variables.

---

## 📁 Directory Structure & Organization

Below is a detailed breakdown of the workspace folders.

```
HIUSA - system/
├── client/                     # React Frontend Application
│   ├── public/                 # Static assets directly served (favicons, etc.)
│   ├── src/                    # React source code
│   │   ├── assets/             # Brand logos and images
│   │   ├── components/         # Reusable UI & structure components
│   │   │   ├── elections/      # Sub-navigation and breadcrumb components for voting module
│   │   │   └── layout/         # Core shell layouts (DashboardLayout, Sidebar, TopBar)
│   │   ├── mockData/           # Temporary mock data for testing & prototyping
│   │   ├── pages/              # Page view components mapped to router paths
│   │   │   └── elections/      # Specific page views for the Election/Voting module
│   │   ├── services/           # Axios instance configuration & API resource files
│   │   ├── App.jsx             # React Router configuration and core routing tree
│   │   ├── index.css           # Global styles and Tailwind directives
│   │   ├── main.jsx            # Application mount point
│   │   ├── LoggedInRoute.jsx   # Auth guard for guests (redirects logged-in users to dashboard)
│   │   └── ProtectedRoute.jsx  # Auth guard for authenticated users (redirects guests to login)
│   ├── package.json            # Client npm scripts and dependencies
│   └── vite.config.js          # Vite config with React and Tailwind CSS plugins
│
├── server/                     # Laravel Backend API
│   ├── app/                    # Main backend application code
│   │   ├── Http/
│   │   │   └── Controllers/    # Controllers executing API business logic (e.g., UserController.php)
│   │   ├── Models/             # Eloquent ORM Models mapping to database tables
│   │   └── Services/           # HiusaAiService (Python AI client), GroqResponsesService, OrderFulfillmentService
│   ├── bootstrap/              # Laravel framework bootstrapping
│   ├── config/                 # Server and third-party configuration files
│   ├── database/
│   │   ├── migrations/         # DB schema builders creating/modifying tables (46 files)
│   │   └── seeders/            # Database seeders for testing accounts and options
│   ├── routes/
│   │   ├── api.php             # Main REST API route configurations
│   │   ├── web.php             # Web-facing routes (not used for this headless setup)
│   │   └── console.php         # Artisan commands configurations
│   └── composer.json           # PHP dependencies and setup commands
│
├── ai-service/                 # Python FastAPI AI microservice
│   ├── app/                    # Forecasting, budget-advice, and task-delegation engines
│   ├── tests/                  # pytest suite
│   └── run.py                  # Service entrypoint
│
├── design.md                   # Brand foundation and style specifications
└── architecture.md             # This file (Root project documentation)
```

---

## 📡 API Architecture & Communication

The client communicates with the server via HTTP requests using Axios. 

### 1. Client-Side API Configuration
All API requests flow through an Axios instance configured in:
🔗 **[api.js](client/src/services/api.js)**

- **Base URL:** Fetched dynamically from environmental variable `VITE_API_URL` (configured in `client/.env`).
- **Authorization:** An interceptor automatically appends the `Authorization: Bearer <token>` header to outgoing requests if `auth_token` is present in the browser's `localStorage`.

### 2. Client-Side Services
API calls are organized into domain-specific service files under `/client/src/services/`.
- 🔗 **[authService.js](client/src/services/authService.js)**: Handles login, registration, logout, and retrieving current user profiles.

### 3. Server-Side Endpoints
API routes are registered in:
🔗 **[api.php](server/routes/api.php)**

- **Guest Routes:** Paths such as `/login` and `/register` are publicly accessible.
- **Protected Routes:** Grouped under the `auth:sanctum` middleware block. These check for a valid Sanctum bearer token before executing controller methods.

---

## 🚦 Navigation, Routing, & Auth Guards

The application's route structure is controlled inside:
🔗 **[App.jsx](client/src/App.jsx)**

### Routing Logic
1. **Guest Guards (`LoggedInRoute.jsx`):** Wraps routes like `/select-organization` and `/login`. If the user is already authenticated, they are automatically redirected to `/dashboard`.
2. **Organization Selection (`/select-organization`):** Guest users choose an active student body organization before reaching `/login`. The selected organization is stored in `localStorage` and submitted with the login request.
3. **Auth Guards (`ProtectedRoute.jsx`):** Protects the main application routes. If no session/token is found in `localStorage`, the user is immediately kicked back to the `/login` page. Each route also declares `allowedRoles`; a role not on the list is redirected rather than shown a 403 page.
4. **Dashboard Layout (`DashboardLayout.jsx`):** Renders the dashboard shell (containing the `Sidebar` and `TopBar`) and serves nested routes via React Router's `<Outlet />`.

### Roles

The active role model is **ADMIN, SBO_OFFICER, DEPARTMENT_HEAD, STUDENT** (stored on `users.role`). The earlier Officer/Adviser naming was retired — see 🔗 **[Role_Model_Correction_2026-07-11.md](docs/devlog/Role_Model_Correction_2026-07-11.md)** for the history.

---

## 🗳️ Database & Data Models

Database schemas are defined in migration scripts under `server/database/migrations/` and map to models in `server/app/Models/`.

Model list below is enumerated from `server/app/Models/` (30 models).

| Model Name | Table Name | Purpose |
| :--- | :--- | :--- |
| **`Organization`** | `organizations` | Student body organizations/workspaces selected before login. Also holds `gcash_qr_url`, the admin-uploaded GCash QR code required before any GCash order/payment. |
| **`User`** | `users` | User credentials, roles, and profiles. Uses integer `school_id` as the primary key. Role is one of `ADMIN`, `SBO_OFFICER`, `DEPARTMENT_HEAD`, `STUDENT`. |
| **`Announcement`** | `announcements` | System bulletins, organization news, or notices. |
| **`AnnouncementView`** | `announcement_views` | Per-user read/view records against an announcement, backing its view count. |
| **`ApprovalRequest`** | `approval_requests` | Pending/approved/rejected approval gates for events, budgets, elections, and merchandise payments; ties an entity to the role required to decide it. |
| **`Event`** | `events` | Calendared system activities. |
| **`Attendance`** | `attendance` | Member attendance records tracking check-ins for events. Biometric check-in intentionally returns `501 Not Implemented` until scanner hardware is connected. |
| **`Task`** | `tasks` | Action items, assignees, deadlines, and completion statuses. |
| **`TaskProgressUpdate`** | `task_progress_updates` | Timestamped progress/status history entries recorded against a task. |
| **`Budget`** | `budgets` | Main budget records tracking categories and totals. |
| **`Transaction`** | `transactions` | Financial logs mapping to budget lines (deposits, expenses). |
| **`FinancialForecast`**| `financial_forecasts`| Future budget planning estimates, generated by the Python OLS engine. |
| **`FinancialReport`** | `financial_reports` | Persisted monthly/semester/custom/event financial reports with computed totals and AI summaries. |
| **`Merchandise`** | `merchandise` | Store listing items, stocks, and unit prices. |
| **`Order`** | `orders` | Purchases of merchandise items by users, including payment method/reference/proof and claim token. |
| **`Election`** | `elections` | Election instances (e.g., General Elections 2026). |
| **`ElectionPosition`** | `election_positions` | Positions associated with an election (e.g., President, Treasurer). |
| **`Candidate`** | `candidates` | Registered candidates in an election, tied to a position and partylist. |
| **`Partylist`** | `partylists` | Election partylists that group candidates. |
| **`Vote`** | `votes` | Cast ballots validating voter choice and preventing double voting. |
| **`Notification`** | `notifications` | System alerts or warnings triggered for specific users. |
| **`AiOutput`** | `ai_outputs` | Persisted input/output of every AI call (Python engine result plus Groq/fallback narration). |
| **`AuditLog`** | `audit_logs` | Admin-facing audit trail of sensitive actions across modules. |
| **`SboPosition`** | `sbo_positions` | Officer positions/titles within an SBO organization. |
| **`CashAdvance`** | `cash_advances` | Cash advance requests against organization funds. |
| **`CashAdvanceRepayment`** | `cash_advance_repayments` | Repayments recorded against a cash advance. |
| **`Collection`** | `collections` | Collection/remittance batches tied to financial accountability tracking. |
| **`Remittance`** | `remittances` | Individual remittance records within a collection. |
| **`Invoice`** | `invoices` | Per-student financial invoices/dues. |
| **`InvoicePayment`** | `invoice_payments` | Payments recorded against an invoice. |

---

## 💡 How to Add New Features

### 1. Adding a New Page & Route
1. **Create the Page File:** Place a new JSX file in `/client/src/pages/` (or a subdirectory like `/client/src/pages/elections/` if it belongs to a module).
2. **Define Routes:** Open 🔗 **[App.jsx](client/src/App.jsx)**, import your page, and insert it under the appropriate Route block (e.g., inside the `/dashboard` nested list).
3. **Add Navigation:** Update 🔗 **[Sidebar.jsx](client/src/components/layout/Sidebar.jsx)** or relevant menu links to route users to your new path.

### 2. Creating New UI Components
1. **Determine Scope:** If a component is globally reusable (e.g., a generic Modal, Button, Input), create it in `/client/src/components/` or a subfolder like `/client/src/components/ui/`.
2. **Aesthetics:** Adhere to colors, spacing, typography, and borders specified in 🔗 **[design.md](design.md)**. Use Tailwind CSS for class names.

### 3. Exposing a New Backend API & Linking It to the Client
1. **Generate Backend Assets:** Run artisan helper commands inside the `/server` directory:
   ```bash
   php artisan make:model ModelName -mcr
   ```
   *(Creates the Model, Migration, and Resourceful Controller in one command)*
2. **Build Database Schema:** Customize the schema in the generated migration file inside `server/database/migrations/`, then run migrations:
   ```bash
   php artisan migrate
   ```
3. **Write Controller Action:** In the new Controller, define your endpoint's business logic, queries, and responses.
4. **Register Routes:** Add routes inside `server/routes/api.php` under the Sanctum group to secure them.
5. **Create Service Endpoint on Frontend:**
   - Create a service wrapper file (e.g., `client/src/services/exampleService.js`).
   - Import `api` from `./api` and configure custom methods:
     ```javascript
     import api from './api';
     export const fetchExamples = () => api.get('/examples');
     ```
6. **Fetch and Display:** Import your service inside your page component, invoke it inside a React `useEffect` or action handler, update the state, and render the view.
