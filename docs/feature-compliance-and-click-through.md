# HIUSA Feature Compliance and Click-Through Verification

Audit date: August 28, 2026 (supersedes the August 23, 2026 pass; re-verified against commit `2e67be8` behaviour)

## Architecture rule for AI outputs

- The Python FastAPI service is authoritative for OLS forecasting, deterministic budget rules, and rule-based weighted task delegation.
- Groq does not calculate votes, forecasts, budgets, or delegation rankings. It translates verified inputs and engine outputs into readable explanations and content.
- All language generation uses `POST https://api.groq.com/openai/v1/responses` with `openai/gpt-oss-20b`.
- If Groq is unavailable, HIUSA keeps the operation available with a deterministic fallback narrative.

## Feature compliance matrix

| Area | Feature | Status | System behavior |
| --- | --- | --- | --- |
| AI | Financial Forecasting | Implemented | Python OLS forecasts income and expense separately from monthly ledger history. HIUSA derives balance and safe spending guidance; Groq explains the verified output. |
| AI | Budget Advisory | Implemented | Python rules calculate available funds, safe ceiling, recommended event/project allocation, reserve, deficit, and risk. Groq translates the result without recalculating it. |
| AI | Task Delegation | Implemented | Eligibility rules run before weighted scoring. Weights are Role 40%, Workload 35%, Performance 25%; Groq explains the winning score. |
| AI | Workflow Automation | Implemented | Event planning can create workflow tasks; tasks track assignee, progress, status, and deadline; overdue tasks are marked daily. |
| AI | Event Planning Assistant | Implemented | Groq produces timeline, resources, checklist, delays, and conflicts from saved event details. Regeneration preserves budget/vendor/logistics fields. |
| Finance | Automated Digital Ledger | Implemented | Transactions update the linked approved budget and create immutable financial audit entries. |
| Finance | Financial Reports | Implemented | Monthly, semester, custom, and event reports combine income statement, categories, ledger rows, latest OLS output, budget advice, and financial audit-log summary. Export is available as Excel-compatible `.xls` and browser Print/Save as PDF. |
| Finance | Digital Receipts | Implemented | Every new transaction automatically receives a unique receipt reference and scoped receipt number. Existing transactions were backfilled. Personal receipts remain available in the UI. |
| Finance | Budget Allocation Manager | Implemented | Budgets can be linked to an event, approved, monitored dynamically, and evaluated for recommended allocation and overspending risk. |
| Finance | Transaction History | Implemented | Complete tenant-scoped ledger with type, event, budget, date filters, search, pagination, and exports. |
| Events | Event Planner | Implemented | Create/edit events with schedules, budget notes, vendor deadlines, logistics checklist, linked budget, workflow tasks, and status monitoring. |
| Events | Activity Calendar | Implemented | Approved/current events are shared across authorized role views and refreshed by the frontend. |
| Events | Event Budget Monitoring | Implemented | Event details and event list expose allocated, spent/remaining, warning, risk, and approval status per linked budget. |
| Events | Event Notification | Implemented | Approval sends an immediate update. The hourly scheduler sends a single reminder per active member for approved events starting within 24 hours. |
| Events | Attendance | Partially implemented | Manual/self check-in, statuses, duplicate prevention, summaries, and event-window enforcement work. Biometric mode intentionally returns 501 until scanner hardware and its vendor SDK are connected. |
| Merchandise | Tokenized Queue | Implemented | A digital token is generated for an order and released for claim after payment approval. |
| Merchandise | Hybrid Payment | Implemented | Cash and e-wallet/other payment flows are supported; e-wallet proof follows officer/admin approval. |
| Merchandise | Inventory | Implemented | Stock is shown, adjusted, deducted at order creation, restored on payment rejection, and protected from invalid release. |
| Merchandise | Order Tracking | Implemented | Students see pending, paid, claimed, and cancelled order states. |
| Merchandise | Fulfillment Verification | Implemented | Officers validate claim tokens; repeated/invalid claims are blocked. |
| Voting | Secure Online Voting | Implemented | Voting is restricted to the approved time window, with database uniqueness and transactional duplicate-vote protection. |
| Voting | Candidate Management | Implemented | Authorized roles manage candidates, positions, and party lists with tenant scoping. |
| Voting | Real-Time Vote Counting | Implemented | Active elections show anonymous live standings and participation values without revealing official winners. |
| Voting | Tamper Protection | Implemented | One ballot per voter/position, official ballot validation, receipt hashes, setup locking after votes, organization scoping, and election audit logs are enforced. |
| Voting | Results Dashboard | Implemented | Official results require a closed election. Admins can inspect them; other roles see them when results are released. New elections default to results released after closure. |

## Exact manual click-through verification

### 0. Prerequisite: configure the GCash QR code

1. Sign in as Admin and open **Merchandise → GCash Payment** (`/dashboard/merchandise/gcash-payment`).
2. Upload the organization's official QR code image and save.
3. Until this is done, `POST /api/orders` with an e-wallet payment method and `POST /api/orders/{id}/payment` (submitting GCash proof) both return 422 with "GCash payment is unavailable until an administrator uploads the official QR code." Do this before Section 6, or the e-wallet order step will fail on stage.

### 1. Open and sign in

1. Keep the Python, Laravel, and Vite terminals running.
2. Open `http://localhost:5173` on the server PC, or `http://192.168.1.19:5173` on another PC on the same network.
3. Select the organization.
4. Sign in as an Admin.

### 2. Verify Groq announcement drafting

1. In the sidebar, click **Announcements**.
2. Click **Create**.
3. Enter a title, audience, category, and details.
4. Click the AI draft button.
5. Confirm a polished announcement body appears.
6. Save it and confirm the approval/publishing rules still apply.

### 3. Verify event planning and workflow automation

1. Click **Events → Manage Events**.
2. Click **Create Event**.
3. Enter title, start/end time, location, budget requirements, vendor deadlines, and logistics checklist.
4. Save the event.
5. Submit/approve it through the approval workflow using the appropriate Department Head/Admin account.
6. Return as Admin and click **Events → Event Planner**.
7. Select the saved event.
8. Enter planning requirements.
9. Leave **Create workflow tasks** checked.
10. Generate the plan.
11. Confirm the result includes a timeline, resources/checklist, and possible delays/conflicts.
12. Reopen event details and confirm the original budget notes, vendor deadlines, and logistics checklist are still present.
13. Open **Task Management → Task Board** and confirm generated workflow tasks exist with deadlines.

### 4. Verify ledger, receipts, OLS, budget advice, and reports

1. Click **Financial → Digital Ledger**.
2. Record at least one income and one expense in two different calendar months. Link the expense to an approved budget when available.
3. Save each transaction and confirm a receipt identity appears under **Financial → My Receipts**.
4. Click **Financial → Financial Insights**.
5. Click **Generate Forecast**.
6. Confirm predicted income, predicted expense, balance, safe spending, risk, and a readable explanation appear.
7. Click **Financial → Budget Allocation**.
8. On an event/project budget, click **AI Advice**.
9. Confirm it shows recommended allocation, safe spending ceiling, risk, and an explanation.
10. Click **Financial → Transaction History** and open the report generator.
11. Choose Monthly, Semester, Custom, or Event and click **Generate**.
12. Confirm the report summary mentions ledger figures and, when available, OLS/budget advice/audit information.
13. Click **Excel** and open the downloaded `.xls` file.
14. Click **PDF**, then choose **Save as PDF** in the print dialog.

### 5. Verify weighted task delegation

1. Click **Task Management → Create Task**.
2. Enter a task title, type, deadline, and any event link.
3. Create the task using AI assignment.
4. Click **Task Management → AI Delegation**.
5. Confirm only eligible active SBO officers are ranked.
6. Confirm the displayed breakdown includes Role, Workload, Performance, and Final Score.
7. Confirm the recommended officer has the highest final score and an explanation.

### 6. Verify merchandise

1. Sign in as Admin and open **Merchandise → Inventory**; create an in-stock item.
2. Sign in as Student and open **Order Merchandise**; place a cash order, then an e-wallet order with proof.
3. Open **My Orders** and confirm status tracking.
4. Sign in as Officer/Admin and approve payment through the required stages.
5. Confirm a claim token becomes visible.
6. Open **Validate Tokens**, validate it once, and confirm the order becomes claimed (stock was already decremented at order creation in step 2, not at claim).
7. Try the same token again and confirm the system blocks reuse.

### 7. Verify voting

1. Sign in as Admin and open **Elections → Manage Election**.
2. Create an election with positions, candidates, start/end time, then obtain approval.
3. During the voting window, confirm its status becomes active and **Cast Vote** is accessible.
4. Sign in as a voter, submit one complete ballot, and confirm a receipt/success message.
5. Press Cast Vote again and confirm the already-voted modal appears and returns the user to the previous page.
6. During the election, confirm anonymous live standings update without official winners being shown.
7. Close the election or wait for its end time.
8. Open **Election Results** and confirm official counts are available according to the results-release setting.
9. Attempt a second vote and confirm it is rejected.

### 8. Verify attendance and notifications

1. Open **Events → Event Operations** as Admin/Officer.
2. Select an approved or ongoing event and record manual attendance.
3. Confirm counts and statuses update and duplicate check-in is blocked.
4. Open the notification bell and confirm event approval updates appear.
5. Ensure the Laravel scheduler is running; for an approved event within 24 hours, run `php artisan events:send-reminders` once for an immediate verification.
6. Confirm each active organization member receives one reminder and rerunning the command creates no duplicate.

Biometric verification cannot be completed without the physical scanner, driver, vendor SDK, and a template-enrollment/matching integration.
