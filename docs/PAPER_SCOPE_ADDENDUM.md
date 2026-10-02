# HIUSA Paper Scope Addendum

This addendum records where the running system goes beyond the submitted paper (HIUSA - FINAL), and which decisions settle the places where the paper contradicts itself. Use it to update Chapters I and III before the defense, so the panel never meets a feature or a rule the paper does not mention.

Each entry says what the paper says, what the system does, and the change to make in the paper.

## 1. How each objective is visible in the system

The page **Study Objectives in Action** (`/dashboard/objectives`, open to every role) is a live traceability matrix: one row per objective, the mechanism that serves it, and the evidence the system holds for it right now. Every role's home page also opens with a briefing that has one pulse per SO2 area.

| Objective | Where it lives in the system | Evidence shown |
|---|---|---|
| GO, one centralized AI-integrated platform | All modules, one login, role-based access, organization-scoped data | Active member accounts; organizations onboarded (SAO view) |
| SO1, assess current practices and problems | Evaluation module, questionnaire Section B | Responses describing current practices |
| SO2.1, financial management | Digital ledger, budgets, OLS forecasting, budget advisory, financial reports | OLS forecasts generated, budget advisories, AI financial summaries, ledger transactions, digital receipts, approved reports |
| SO2.2, event management | Events, AI event planner, biometric and manual attendance, event registration | AI event plans, completed events, fingerprint and manual check-ins |
| SO2.3, task management | Tasks with Rule-Based Weighted Scoring delegation and plain-language explanations | Officer scores calculated, tasks delegated with a recorded ranking, AI delegation explanations |
| SO2.4, elections | Elections, candidates, partylists, secure voting, results | Elections tallied automatically, votes cast, voters in the latest election |
| SO2.5, merchandise | Inventory, orders, GCash proof, tokenized claiming | Orders placed, claim tokens issued, orders claimed with a token, GCash payments verified |
| SO2.6, organizational communication | Announcements with AI drafting, notifications | Announcements published, AI-drafted announcements, notifications delivered |
| SO3, define and develop the best features | The module set above, traced feature by feature | Modules with activity in the last 90 days |
| SO4, evaluate acceptability | Evaluation module, Section E, weighted mean with the Table 3 bands | Acceptability responses and weighted means, closed windows only |

Paper change: add one paragraph to Chapter III saying that the system includes a traceability page, and that SO1 and SO4 are collected in the system itself through the Evaluation module (section 2.2 below).

## 2. Scope extensions

These were added after the dean's review, which asked for the objectives to be visible, the UI to have more life, and more self-serve use cases, with the Student Affairs Office (SAO) mattering most.

### 2.1 SAO as a fifth actor

The paper has four actors (Admin, SBO Officer, Department Head, Student). The system adds the SAO (role `SUPER_ADMIN`), which governs every organization without touching any organization's ledger.

| SAO capability | What it does |
|---|---|
| Organizations and admins | Create organizations and provision their admins |
| Administrator handover | Hand an organization's administrator role to a successor in one step at term turnover; the outgoing account is deactivated, not deleted, so its history stays attributed |
| Academic years | Keep the academic calendar with one current year; accreditation, requirement sets and clearance periods follow it |
| University announcements | Publish notices to every organization |
| Financial report approval | Final approval on financial reports after the Department Head |
| Compliance and accreditation | Define requirements, review each organization's submissions, track accreditation status |
| Venues | Manage venues; organizations book them, with conflict checks |
| Grievances | Receive grievances addressed to an organization or to the SAO, classified by AI. An anonymous grievance hides the student from the organization admin; the SAO always sees who filed it, so it can follow up |
| Clearances | Run clearance periods with signatory routing; students see their own status |
| Evaluation windows | Open and close questionnaire windows and read results university-wide |
| Organization health | One table of every organization's accreditation, budget use, pending reports and open items |
| Audit trail | Every organization's actions, minus ledger modules, with filters and CSV export |

Paper change: add the SAO to the actor list in Chapter III, to the use-case diagram, and to the scope in Chapter I. Describe it as oversight that never edits an organization's finances.

### 2.2 Evaluation module (makes SO1 and SO4 collectable in the system)

Role-specific questionnaires on the paper's 5-point scale, with the weighted mean interpreted using the Table 3 bands.

- Respondents give informed consent before any question appears.
- Results show only for closed windows. An open window shows counts only.
- A group smaller than three respondents shows a count, never a mean. Complementary groups are suppressed too, so no one can subtract their way to a single person's answer.
- Results export for the defense.

Paper change: in the data gathering procedure, state that the questionnaire is administered in the system, and restate the ethics paragraph in these terms.

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

## 3. Decisions that reconcile the paper

| | Paper says | System does | Paper change |
|---|---|---|---|
| (a) Finance access | Fig. 35, Fig. 36 and Table 24 (M6.2, M6.8, M6.9) give SBO Officers and Department Heads finance views | Both roles review the ledger, budgets, forecasts and reports read-only; only the Admin records or changes anything | None; state "read-only" explicitly in M6.2, M6.8, M6.9 |
| (b) Who votes | Fig. 27 narrates a student voting; Table 24 marks all four roles | All four operating roles vote, once per position | Note in Fig. 27 that the walkthrough is one example of an eligible voter |
| (c) Role names | Chapter I: Admin, Adviser, Officer, Student. Chapter III: Admin, SBO Officer, Department Head, Student | Chapter III names; the Department Head is the adviser and oversight role | Align Chapter I's definition of terms to Chapter III |
| (d) Evaluation | The questionnaire is described as an instrument outside the system | Administered in the system with consent and anonymized results (section 2.2) | Data gathering procedure and ethics paragraph |
| (e) SAO scope | No SAO actor | SAO as a fifth actor (section 2.1) | Actor list, scope, use-case diagram |
| (f) Audit logs | The administrator cheat sheet calls audit logs SAO-exclusive | The SAO sees every organization (minus ledger modules); each Admin sees its own organization | Correct the cheat sheet |
| (h) Task delegation formula | Chapter II: role, workload, performance. Chapter III: workload, role relevance, assignment recency. Chapter I: role, workload, availability | Availability is an eligibility gate. Four scored factors: role 0.35, workload 0.30, past performance 0.20, assignment recency 0.15 | Use one formula in Chapters II and III (below) |
| (i) Budget approval | M6.6 and Fig. 43: the Department Head approves; the system flow document says the SAO | Department Head approval, single stage. An SAO second stage exists as a configuration switch, off by default | None for M6.6; correct the system flow document |

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

One deliberate limit: notification preferences decide what shows in HIUSA's own notification list. The system sends no email or text notifications, so there is no other channel to configure.
