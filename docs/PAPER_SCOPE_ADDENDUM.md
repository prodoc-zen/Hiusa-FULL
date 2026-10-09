# HIUSA Paper Scope Addendum

Update (2026-10-06): The in-app Evaluation feature has been removed for all roles. Earlier references below to questionnaire pages, evaluation windows, and in-app survey results describe the retired feature. SO1 and SO4 remain research objectives assessed outside the application; existing survey records are retained without user-facing access.

Update (2026-10-09): After the dean's feedback the system has an agency hierarchy. The SAO is the agency, colleges are a fixed list, a Department Head oversees one college and registers its student organizations for SAO approval, and only an approved organization has members who can sign in. Section 2.4 describes it and the paper changes it needs.

This addendum records where the running system goes beyond the submitted paper (HIUSA - FINAL), and which decisions settle the places where the paper contradicts itself. Use it to update Chapters I and III before the defense, so the panel never meets a feature or a rule the paper does not mention.

Each entry says what the paper says, what the system does, and the change to make in the paper.

## 1. How each objective is visible in the system

The page **Study Objectives in Action** (`/dashboard/objectives`, open to every role) is a live traceability matrix: one row per objective, the mechanism that serves it, and the evidence the system holds for it right now. Every role's home page also opens with a briefing that has one pulse per SO2 area.

| Objective | Where it lives in the system | Evidence shown |
|---|---|---|
| GO, one centralized AI-integrated platform | All modules, one login, role-based access, organization-scoped data | Active member accounts; organizations onboarded (SAO view) |
| SO1, assess current practices and problems | Assessed through the study research process outside the application | Not shown in the system |
| SO2.1, financial management | Digital ledger, budgets, OLS forecasting, budget advisory, financial reports | OLS forecasts generated, budget advisories, AI financial summaries, ledger transactions, digital receipts, approved reports |
| SO2.2, event management | Events, AI event planner, biometric and manual attendance, event registration | AI event plans, completed events, fingerprint and manual check-ins |
| SO2.3, task management | Tasks with Rule-Based Weighted Scoring delegation and plain-language explanations | Officer scores calculated, tasks delegated with a recorded ranking, AI delegation explanations |
| SO2.4, elections | Elections, candidates, partylists, secure voting, results | Elections tallied automatically, votes cast, voters in the latest election |
| SO2.5, merchandise | Inventory, orders, GCash proof, tokenized claiming | Orders placed, claim tokens issued, orders claimed with a token, GCash payments verified |
| SO2.6, organizational communication | Announcements with AI drafting, notifications | Announcements published, AI-drafted announcements, notifications delivered |
| SO3, define and develop the best features | The module set above, traced feature by feature | Modules with activity in the last 90 days |
| SO4, evaluate acceptability | Assessed through the study research process outside the application | Not shown in the system |

The page shows the text "Assessed through the study research process outside the application." on the SO1 and SO4 rows and no in-app counts.

Paper change: add one paragraph to Chapter III saying that the system includes a traceability page, and that SO1 and SO4 are assessed outside the system through the study's own questionnaire and the page states that (section 2.2 below).

## 2. Scope extensions

These were added after the dean's review, which asked for the objectives to be visible, the UI to have more life, and more self-serve use cases, with the Student Affairs Office (SAO) mattering most.

### 2.1 SAO as a fifth actor

The paper has four actors (Admin, SBO Officer, Department Head, Student). The system adds the SAO (role `SUPER_ADMIN`), which is the agency over every college and organization and governs them without touching any organization's ledger.

| SAO capability | What it does |
|---|---|
| Organizations | Review and approve registrations submitted by Department Heads, archive and restore organizations, provision each organization's admin |
| Agency overview | Every college with its organizations, their status, member counts, accreditation status, pending approvals and pending documents |
| Organization overview | A read-only view of what is inside one organization: leadership, members by role, events, approved-budget totals, compliance and documents |
| Administrator handover | Hand an organization's administrator role to a successor in one step at term turnover; the outgoing account is deactivated, not deleted, so its history stays attributed |
| Academic years | Keep the academic calendar with one current year; accreditation, requirement sets and clearance periods follow it |
| University announcements | Publish notices to every organization |
| Financial report approval | Final approval on financial reports after the Department Head, done in the Financial reports tab of Compliance |
| Compliance and accreditation | One Compliance home with tabs: define requirements, review each organization's submissions, track accreditation status, and a track documents view that lists every file each organization has submitted per semester |
| Venues | Manage venues; organizations book them, with conflict checks. A week view calendar shows who occupies each venue and when |
| Grievances | Receive grievances addressed to an organization or to the SAO, classified by AI. An anonymous grievance hides the student from the organization admin; the SAO always sees who filed it, so it can follow up |
| Clearances | Run clearance periods with signatory routing; students see their own status |
| Organization health | One table of every organization's accreditation, budget use, pending reports and open items |
| Audit trail | Every organization's actions, minus ledger modules, with filters and CSV export |

Paper change: add the SAO to the actor list in Chapter III, to the use-case diagram, and to the scope in Chapter I. Describe it as oversight that never edits an organization's finances.

### 2.2 Evaluation module (retired)

The in-app Evaluation module was removed on 2026-10-06 for all roles. SO1 (assess current practices) and SO4 (evaluate acceptability) are assessed through the study's own research process outside the application, using the paper's questionnaire. Existing survey records are retained without user-facing access.

Paper change: none to the questionnaire. The ethics paragraph stays with the paper's data gathering procedure, which describes the questionnaire as administered outside the system.

### 2.3 Other additions

| Addition | Why |
|---|---|
| Role briefing on every home page: what needs you now, one pulse per SO2 area, AI insights with a "Why?" disclosure | Makes the objectives and the AI visible at a glance |
| Event registration: students reserve a spot; organizers see capacity and the roster; no-shows are marked after the event | The paper describes registration, but there was no record of it |
| Collections and remittances screens | The backend existed with no screen |
| Command palette (Ctrl K) and breadcrumbs | Self-serve navigation across many modules |
| Bulk member import from CSV: every row is checked first, nothing is written unless all rows pass, and no password travels in the file | Enrolling a whole roster at term start, one of the dean's self-serve asks |
| Personal activity history on every profile | Each person can see what they did, from the same audit trail |
| Getting-started checklist on every home page, per role | New users see the few steps that make the system useful, each checked off from real records |
| Notification preferences | People can hide informational kinds (announcements, events, elections, merchandise); approvals, tasks, account and payment notices always show |
| Cash advances on screen: request, approval by a different admin, release to the ledger, repayments | The server endpoints existed with no screen |
| Audit log export for the SAO and each Admin | The screen a panel or an incoming auditor most wants to take away |
| Delete actions where a record can be safely removed: the SAO can delete a compliance requirement type with no submissions, an academic semester nothing references, a draft SAO announcement and a clearance period with no signed entries; a student can delete their own unreviewed grievance; events, budgets (blocked when the budget has transactions), manual transactions and tasks have delete buttons on their screens | Users could create these records but not undo a mistake. Collections, remittances, cash advances, invoices and venue bookings are ledger style records and keep cancel, waive or withdraw instead of delete |

### 2.4 Agency hierarchy

After the dean's feedback the system is organized as an agency, its colleges, and the student organizations in each college.

| Part | What the system does |
|---|---|
| SAO as the agency | The SAO (role `SUPER_ADMIN`) sits above every college. It no longer creates colleges or organizations; it reviews registrations, archives and restores organizations, provisions each organization's admin, and sees the agency overview and the read-only organization overview (section 2.1) |
| Colleges | A fixed list held in the system: College of Computer Studies, Business Education, Teacher Education, Health Sciences and Engineering. Nobody creates, renames or deletes a college through the application. The SAO only views colleges and uploads a college logo. Each college has a home record (organization type COLLEGE) |
| Department Head scope | A Department Head belongs to a college, not to a student organization, and oversees every student organization in that college. Approvals (budget, event, election, financial report), events, budgets, elections, financial reports, finance read access and announcements are college wide |
| Registration flow | A Department Head creates a student organization in their own college and submits it to the SAO with the registration requirements: the ten renewal documents of the current semester, one PDF each. The SAO approves it or returns it with remarks. A returned registration is edited and resubmitted by the Department Head |
| Lifecycle states | An organization is pending (awaiting SAO review), returned, active or archived. Only an approved (active) organization has members who can sign in |
| Archive and restore | The SAO can archive an active organization that is no longer in use. It stays visible to the SAO and is read only: its members cannot sign in and nothing in it can be edited. Only the SAO can restore it |
| Roles inside an organization | Admin, SBO Officer and Student. The SAO provisions the organization's Admin |
| Department Head and voting | Department Heads do not vote and do not buy merchandise, because they are not members of an organization. They still approve elections and read results |
| One Compliance home | Every file-submission report is in one place with tabs: Accreditation, Requirements, Review queue, Event requirements, Financial reports and Track documents. Financial reports is the SAO's final approval of financial reports. Track documents lists, per organization and semester, the renewal and semestral requirement files, event requirement files, financial reports and financial report supporting documents, each openable from the list |

The semestral report requirement is "Semestral Accomplishment Report", one per semester next to the ten renewal items; semester financial reports are also listed under Financial reports. Financial report supporting documents are stored privately and served only to authorized users.

Paper change: in Chapter I (scope and definition of terms), state that the Department Head oversees a college, not one organization, and that the SAO approves organization registrations. In Chapter III, update the actor descriptions and the use-case diagram so the Department Head is shown at the college level with the registration use case, and the SAO is shown with registration review, archive and restore.

## 3. Decisions that reconcile the paper

| | Paper says | System does | Paper change |
|---|---|---|---|
| (a) Finance access | Fig. 35, Fig. 36 and Table 24 (M6.2, M6.8, M6.9) give SBO Officers and Department Heads finance views | Both roles review the ledger, budgets, forecasts and reports read-only; only the Admin records or changes anything | None; state "read-only" explicitly in M6.2, M6.8, M6.9 |
| (b) Who votes | Fig. 27 narrates a student voting; Table 24 marks all four roles | Admin, SBO Officer and Student vote, once per position; Department Heads oversee elections and do not vote because they belong to a college, not an organization | Note in Fig. 27 that the walkthrough is one example of an eligible voter, and in Table 24 that the Department Head approves elections and reads results without voting |
| (c) Role names | Chapter I: Admin, Adviser, Officer, Student. Chapter III: Admin, SBO Officer, Department Head, Student | Chapter III names; the Department Head is the adviser and oversight role, and is the college oversight role (section 2.4) | Align Chapter I's definition of terms to Chapter III |
| (d) Evaluation | The questionnaire is described as an instrument outside the system | Withdrawn: the in-app evaluation was removed; the questionnaire is administered outside the system (section 2.2), as the paper describes | None |
| (e) SAO scope | No SAO actor | SAO as a fifth actor and the agency over colleges and organizations (sections 2.1 and 2.4) | Actor list, scope, use-case diagram |
| (f) Audit logs | The administrator cheat sheet calls audit logs SAO-exclusive | The SAO sees every organization (minus ledger modules); each Admin sees its own organization | Correct the cheat sheet |
| (h) Task delegation formula | Chapter II: role, workload, performance. Chapter III: workload, role relevance, assignment recency. Chapter I: role, workload, availability | Availability is an eligibility gate. Four scored factors: role 0.35, workload 0.30, past performance 0.20, assignment recency 0.15 | Use one formula in Chapters II and III (below) |
| (i) Budget approval | M6.6 and Fig. 43: the Department Head approves; the system flow document says the SAO | Department Head approval, single stage. An SAO second stage exists as a configuration switch, off by default | None for M6.6; correct the system flow document |
| (j) Event approval chain | M5.3 and M5.4: the Department Head approves the event proposal | The Department Head approves every event proposal, whether or not the SAO has active requirements for it. When requirements apply (by venue type and semester), the Admin also uploads the SAO files and the SAO clears the event after the Department Head; the event stays `planning` until the last approver in the chain decides. Events filed before this rule with only an SAO request are still decided by the SAO | None for M5.3 and M5.4; describe the SAO clearance as an added step for events that need SAO files |

Decision (g), a two-stage budget chain, was planned and then superseded by (i).

### The task delegation formula to print in Chapters II and III

FinalScore = 0.35 × RoleScore + 0.30 × WorkloadScore + 0.20 × PerformanceScore + 0.15 × RecencyScore

- RoleScore: 100 when the officer's position is a primary match for the task's area, 70 for a related position, 40 for an unrelated one.
- WorkloadScore: 100 × (1 − active tasks ÷ the 5-task limit).
- PerformanceScore: completed ÷ (completed + overdue) × 100, or a neutral 70 for an officer with no history yet.
- RecencyScore: 100 × the smaller of 1 and (days since the officer's last assignment ÷ 14). An officer never assigned scores 100.

Eligibility comes first: active SBO Officer account, an active position, and fewer than 5 open tasks. The weights are configurable and are normalized to sum to 1. The same formula runs in the AI service and in the server's fallback, and an automated test checks that both produce identical scores and explanations for the same officer.

## 4. Built since the first draft of this addendum

Every item the use-case inventory listed as missing is now in the system: administrator handover (SAOX-02), academic years (SAOX-03), bulk member import (SAOX-12), the getting-started checklist (ONBOARD-01), personal activity history (ONBOARD-05), notification preferences (ONBOARD-07), audit log export (ONBOARD-08) and the cash advance screen (EXT-03).

One deliberate limit: notification preferences decide what shows in HIUSA's own notification list. The only email HIUSA sends is the password reset link, so there is no other channel to configure.
