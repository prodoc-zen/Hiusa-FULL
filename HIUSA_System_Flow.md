# HIUSA System Flow

## Scope

This document summarizes the overall flow of HIUSA based on `hiusa-functionalities.docx`, the current Laravel API, visible React modules, and the reference SQL file `hiusa_db_original_plus_minimal_patch.sql`.

The system is an AI-integrated student governance and financial management platform for student organizations. It supports organization-scoped users, role-based dashboards, events, approvals, finances, merchandise, elections, announcements, tasks, attendance, and notifications.

## Primary Actors

- ADMIN: President, treasurer, secretary, auditor, adviser-equivalent system administrator, or authorized organization administrator.
- SBO_OFFICER: Student body officers who execute operations, process assigned work, manage some modules, and support students.
- DEPARTMENT_HEAD: Dean, chairperson, or department-level approver.
- STUDENT: Organization member who consumes services, votes, attends events, purchases merchandise, and receives announcements.

## Global Access Flow

1. User selects or belongs to an organization.
2. User logs in using school ID/email credentials.
3. System authenticates through Laravel Sanctum.
4. System reads the user's role and organization.
5. Frontend routes user to the matching role dashboard.
6. Backend filters records by `organization_id`.
7. Middleware restricts each API action by role.

## Organization and User Management Flow

1. ADMIN creates or manages users for the organization.
2. ADMIN assigns one of the four access-control roles: `ADMIN`, `SBO_OFFICER`, `DEPARTMENT_HEAD`, or `STUDENT`.
3. Organizational titles such as President, Treasurer, PIO, VP Internal, or VP External should be stored separately from the access-control role.
4. Users update their own profile and password.
5. Disabled or deleted users lose access to role-protected workflows.

## Approval Flow

1. ADMIN or SBO_OFFICER creates an item that requires sign-off.
2. System creates an approval request.
3. DEPARTMENT_HEAD views pending approval requests.
4. DEPARTMENT_HEAD approves or rejects with optional remarks.
5. If approved, the target record is activated or marked approved.
6. If rejected, the target record remains in its draft/planning/pending state.
7. Editing a rejected item can resubmit the request for approval.

Current implemented approval targets:

- Events
- Budgets
- Elections

Planned or SQL-patch-supported approval targets:

- Announcements
- Payments

## Financial Management Flow

1. ADMIN creates budgets for general operations or specific events.
2. A created budget starts as pending and creates an approval request.
3. DEPARTMENT_HEAD approves or rejects the budget.
4. ADMIN records income and expenses against budgets.
5. System shows transaction history, summaries, and budget totals.
6. Forecast records can be created for predicted income and expenses.
7. Planned AI/OLS features should calculate predicted balance, safe spending limits, budget advice, report summaries, and overspending risk.
8. Planned exports should generate income statements, expense summaries, audit logs, and event-specific reports.

## Event Management Flow

1. ADMIN or SBO_OFFICER creates an event with schedule, location, and description.
2. Event starts in planning status.
3. System creates a Department Head approval request.
4. If approved, event becomes visible to students.
5. Tasks and budgets may be linked to the event.
6. Event attendance can be recorded by SBO_OFFICER.
7. Attendance may use manual check-in now and biometric check-in later.
8. Notifications should alert users when events are created or nearing.
9. Planned AI assistant should generate timelines, resources, checklists, and delay/conflict warnings.

## Task and Workflow Flow

1. ADMIN or SBO_OFFICER creates tasks.
2. Tasks may be linked to events.
3. Tasks are assigned to SBO_OFFICER users.
4. Assigned officers view their tasks and update progress/status.
5. System marks overdue tasks through the scheduled console command.
6. Current UI shows basic workload/delegation suggestions.
7. Planned workflow automation should generate tasks for an event or operation.
8. Planned scoring should combine role fit, workload, and performance:

`FinalScore = (RoleWeight * RoleScore) + (WorkloadWeight * WorkloadScore) + (PerformanceWeight * PerformanceScore)`

## Merchandise Flow

1. ADMIN or SBO_OFFICER views merchandise inventory.
2. Current backend gives SBO_OFFICER catalog CRUD and ADMIN stock adjustment.
3. STUDENT browses merchandise.
4. STUDENT places an order.
5. System checks stock and reserves quantity.
6. System generates a unique claim token.
7. SBO_OFFICER updates order status from pending to paid or cancelled.
8. Student presents token for claim.
9. SBO_OFFICER validates the token.
10. If the order is paid, system marks it claimed.
11. Planned payment flow should support GCash proof, officer review, admin review, claim verification, and linked transactions.

## Election Flow

1. ADMIN or SBO_OFFICER creates an election.
2. System stores the requested target status but sets election status to pending approval.
3. System creates a Department Head approval request.
4. DEPARTMENT_HEAD approves or rejects the election.
5. If approved, election moves to the requested status.
6. ADMIN or SBO_OFFICER manages positions.
7. ADMIN or SBO_OFFICER manages candidates and party lists.
8. STUDENT accesses only active elections.
9. STUDENT submits one ballot per election.
10. System validates candidate, position, election, organization, and duplicate-vote rules.
11. System records vote hashes as receipts.
12. Results are aggregated and visible through the results dashboard.

## Announcements and Notifications Flow

1. ADMIN or SBO_OFFICER creates an announcement.
2. Announcement can target all users or a specific role.
3. Published announcements trigger notifications to matching users.
4. STUDENT and DEPARTMENT_HEAD see only published announcements intended for them.
5. Users can mark notifications read or mark all read.
6. Planned approval flow should require ADMIN approval before SBO_OFFICER announcements are published.
7. Planned notification preferences should let users manage module-level notification settings.

## Attendance Flow

1. Event exists within the user's organization.
2. SBO_OFFICER opens attendance for the event.
3. SBO_OFFICER selects attendee and method.
4. System validates the attendee belongs to the same organization.
5. System prevents duplicate check-in for the same event/user pair.
6. System records check-in time and method.
7. Planned enhancement should add check-out time, recorder, remarks, and biometric template registration/verification.

## AI and Reporting Flow

1. User triggers an AI-supported feature from finance, events, tasks, or reports.
2. System gathers module data and constructs a prompt or statistical input.
3. OLS or rule-based scoring produces numeric guidance where applicable.
4. Groq LLM explains or summarizes the result.
5. System stores the AI output for traceability.
6. Reports may reference generated AI output.
7. Exported files may be stored and linked from the report record.

## End-to-End Example Flow

1. ADMIN creates a proposed Sports Fest event.
2. ADMIN creates a proposed event budget.
3. System creates approval requests for both records.
4. DEPARTMENT_HEAD approves the event and budget.
5. ADMIN uses workflow automation to create event tasks.
6. System suggests officers based on role, workload, and performance.
7. SBO_OFFICER receives task notifications and updates progress.
8. ADMIN creates announcements and reminders.
9. STUDENTS see the event in the calendar and receive notifications.
10. SBO_OFFICER records event attendance.
11. ADMIN records event income/expenses and uploads receipts.
12. System generates financial summaries, forecasts, and reports.

## Migration Alignment Check

The current Laravel migrations are executable: the full Laravel test suite passed against the in-memory SQLite test database.

The migrations partially match `hiusa_db_original_plus_minimal_patch.sql`, but they do not fully follow the SQL patch yet.

Matches or acceptable Laravel-style differences:

- Core original tables exist through migrations.
- Organization scoping was added to major system tables.
- Role model was changed to four application roles.
- Election creation uses `pending_approval`.
- Approval request workflow exists for events, budgets, and elections.
- Laravel migrations intentionally use portable strings in some places instead of MySQL-only enum alteration.

Important mismatches:

- SQL maps old `adviser` users to `DEPARTMENT_HEAD`; current migration maps `adviser` users to `ADMIN`.
- SQL adds `users.notification_preferences`; migration does not.
- SQL adds announcement approval fields: `approval_status`, `reviewed_by`, `review_remarks`, and `published_at`; migrations do not.
- SQL adds event fields: `requires_budget`, `planning_details`, and `approved_at`; migrations do not.
- SQL adds budget fields: `remaining_amount`, `advisory_note`, and `overspending_risk`; migrations do not.
- Current migrations add `budgets.status`, but the SQL patch shown does not.
- SQL adds transaction fields: `event_id`, `payer_id`, `receipt_number`, and `receipt_file_url`; migrations do not.
- SQL adds forecast fields: `predicted_balance`, `safe_spending_limit`, `model_details`, and `generated_by`; migrations do not.
- SQL adds order/payment review fields: `payment_method`, `payment_reference`, `payment_proof_url`, `officer_review_status`, `admin_review_status`, `review_remarks`, `claim_verified_by`, `claim_verified_at`, and `transaction_id`; migrations do not.
- SQL adds task workflow/scoring fields: `task_type`, `is_ai_generated`, `role_score`, `workload_score`, `performance_score`, `final_score`, `progress_percent`, and `completed_at`; migrations do not.
- SQL adds election fields: `results_visible` and `approved_at`; migrations do not.
- SQL adds notification scheduling/reference fields; migrations do not.
- SQL adds attendance fields: `check_out_time`, `recorded_by`, and `remarks`; migrations do not.
- SQL creates `ai_outputs`, `financial_reports`, and `audit_logs`; migrations do not.
- SQL `approval_requests` table supports `announcement` and `payment`, includes `required_role`, and uses non-unique entity indexes. Current migration supports only `event`, `budget`, and `election`, includes `title` and `summary`, and enforces a unique entity pair.

Recommended next migration direction, when system changes are allowed:

1. Add the missing patch columns and tables as normal Laravel migrations.
2. Decide whether `budgets.status` should remain as a Laravel/application addition or be reflected back into the SQL reference.
3. Align `approval_requests` with the SQL patch or update the SQL reference to match the implemented Laravel workflow.
4. Correct the old adviser role mapping if `adviser` is meant to become `DEPARTMENT_HEAD`.
5. Keep portable Laravel column definitions where needed for SQLite tests, but preserve the same business fields and allowed values.
