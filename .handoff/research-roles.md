# Ask AI rebuild: what each role needs

Route shorthand: **D** = `/dashboard`.

## 1. What the dean asked for

- **The flow is "all over the place"** (UX_FLOW.md intro). Every page says where you are and what is next. The assistant answers with the next step and a link, not a module list.
- **"What needs me comes first"** (UX_FLOW.md principles 5 and 6). Open with today's queue, and link to the exact item, not a list holding it.
- **Lifecycles are visible**: stage, who owns the next move (UX_FLOW.md principle 4, section 4). Say "waiting for the Department Head", never just "pending".
- **Reflect the study objectives** (USE_CASE_INVENTORY section 6, dean point 1; PAPER_SCOPE_ADDENDUM section 1). The six SO2 areas are money, events, tasks, elections, merchandise and communication. Each should be answerable.
- **Give the UI soul, human microcopy** (USE_CASE_INVENTORY section 7, items 1 and 5; PRODUCT.md voice). Greet by name, no system-speak.
- **More self-serve, especially the SAO** (dean point 3). Each role finishes its own job unaided. The SAO matters most.
- **AI explains itself and defers to people** (PRODUCT.md principle 3; ai-workflow-architecture.md). Never approve, assign or publish. Numbers come from the backend. No fabricated counts.

## 2. Jobs, questions, intents, pages (most important first)

**SUPER_ADMIN (SAO)**
1. Know what needs me today: "What should I do today?" | daily_priorities | D/super-admin
2. Approve or return registrations: "Which applications are ready for me to approve?" | none (pending_approvals only half-covers) | D/organization-applications
3. Review compliance files: "Who has submitted files I still need to review?" | submitted_documents | D/super-admin/compliance?tab=review
4. Final budget and report approval: "What budgets and reports are waiting for my decision?" | pending_approvals | D/super-admin/organization-approvals
5. Chase non-submitters: "Which organizations haven't submitted requirements?" | missing_submissions | D/super-admin/compliance
6. Grievances: "Are there urgent student grievances?" | grievances_status (never offered) | D/super-admin/grievances

**DEPARTMENT_HEAD**
1. Today's queue: "What should I do today for my college?" | daily_priorities | D/department-head
2. Endorse applications: "Which applications need my endorsement?" | none | D/organization-applications
3. Approve events, budgets, reports, elections: "What is waiting for my approval?" | pending_approvals | D/department-head/approvals
4. Compliance chase: "Which of our organizations are behind on requirements?" | missing_submissions | D/department-head/compliance
5. Fix leadership gaps: "Which organizations have no head?" | organizations_without_admin | D/department-head/organizations
6. Clearance signing: "Which students need my clearance signature?" | clearances_status | D/clearances

**ADMIN (organization head)**
1. Today: "What should I do today for our organization?" | daily_priorities | D/admin
2. Where do my submissions stand: "Where is my event proposal?" | none (pending_approvals is reviewer-side) | D/approvals
3. Money: "How much budget is left, and who hasn't paid?" | finance_health | D/finance/budget-allocation
4. Missing requirements: "What haven't we submitted?" | missing_submissions | D/compliance
5. Tasks and delegation: "Who has overdue tasks?" | tasks_workload | D/tasks/task-board
6. Run an event: "How do I create an event?" | how_to_guide | D/events/manage-events

**SBO_OFFICER**
1. Today: "What should I do today as an officer?" | daily_priorities | D/officer
2. Verify payments and release orders: "Which orders need payment checking?" | merchandise_orders | D/merchandise/manage-orders
3. My tasks: "What tasks are assigned to me?" | tasks_workload | D/tasks/assigned-tasks
4. Run attendance: "What events need check-in today?" | events_attendance | D/events/check-in
5. Draft an announcement: "Help me write an announcement" | none | D/announcements/create-announcement
6. Look up money, read only: "What is our budget balance?" | finance_health | D/finance/budget-allocation

**STUDENT**
1. What do I do today: "What do I need to do today?" | daily_priorities | D/student
2. My clearance: "Who hasn't signed my clearance?" | clearances_status | D/my-clearance
3. What I owe: "What fees do I still owe?" | finance_health | D/finance/statement-of-account
4. Orders and claim tokens: "Is my order ready to claim?" | merchandise_orders | D/merchandise/my-orders
5. Vote: "Can I vote now?" | elections_status | D/elections/cast-vote
6. Events: "What events can I join?" | events_attendance | D/events/activity-calendar

## 3. Other AI applications (handoff lines)

| Application | Role | Route | Assistant says |
|---|---|---|---|
| Financial forecast (OLS) | ADMIN generates; SBO_OFFICER, DEPARTMENT_HEAD read | D/finance/financial-insights | "Forecasts are made on the Forecast page, so I will take you there." |
| Budget advice | ADMIN | D/finance/budget-allocation | "Open the budget and choose advice for a safe-spending limit." |
| Task delegation | ADMIN only (officers cannot open it) | D/tasks/ai-delegation | "AI delegation ranks officers, and you make the final choice." |
| Event planning | ADMIN | D/events/event-planner | "Event planning drafts a timeline and tasks that you review first." |
| Announcement drafting | ADMIN, SBO_OFFICER | D/announcements/create-announcement | "The announcement page can write a first draft for you to edit." |
| Grievance classification | Automatic on filing; SAO and ADMIN read | D/super-admin/grievances, D/grievances (student files at D/my-grievances) | "Your concern is sorted by urgency, and a person reads it." |
| Financial report summary | ADMIN builds; DH then SAO review | D/finance/transaction-history; D/department-head/approvals; D/super-admin/compliance | "Build the report on Financial reports, and the summary comes with it." |

## 4. Gaps

**Questions classifyIntent cannot route**
- `'how much is'` sits in the semantic_rag list ahead of finance, so "How much is left in our budget?" never reaches finance_health. `'transaction'`, `'expense'`, `'income'` and `'announcement'` also hit RAG first.
- `'missing'` is tested before `'missing admin'`, so "Which orgs are missing an administrator?" returns missing_submissions. Only the chip works.
- No keywords for: application, endorse, compliance, requirement, venue, forecast, draft, assign, delegate, deadline, balance, receipt. "Who should I assign?" and "Draft an announcement" land in RAG.
- No intent for endorsement, "where is my event" (Admin submission tracking) or drafting. Daily priorities match only two or three exact phrases.
- Grievance wording goes to semantic_rag for every role but the SAO, including the ADMIN. `grievances_status` is never offered as a chip.

**Offered but refused (`intentAllowed`)**
- STUDENT_INTENTS excludes pending_approvals, tasks_workload, missing_submissions, submitted_documents, organizations_without_admin and grievances_status. A student asking "What tasks do I have?" gets "Ask your organization head to add it to your access", which is wrong for students.
- An officer lacking a module is offered off-tasks (tasks), off-orders (merchandise), off-missing and off-clearances (compliance) and off-events (events), then refused. `starterPrompts` filters them, `suggestedQuestions` does not.
- Officer navigation has Clearance signing but no Compliance page, yet clearances_status needs the compliance module. missing_submissions has no officer page to link to.
- `starterPrompts` keeps six, so the seventh chip is dropped: SAO finance, DH events, ADMIN and officer clearances, student elections.

## 5. Starter prompts

**SAO**
- What's on my desk today | What should I do today across student organizations? | daily_priorities
- Applications to approve | Which organization applications are waiting for my approval? | pending_approvals
- Who is behind on requirements | Which organizations haven't submitted their requirements? | missing_submissions
- Files waiting for review | Who has sent files that I still need to review? | submitted_documents
- Urgent student concerns | Are there any urgent student grievances I should read first? | grievances_status
- Invite a dean | How do I invite a Department Head? | how_to_guide

**Department Head**
- What's on my desk today | What should I do today for my college? | daily_priorities
- Waiting for my approval | What is waiting for my approval right now? | pending_approvals
- Which organizations need a head | Which organizations in my college have no head yet? | organizations_without_admin
- Who is behind on requirements | Which of our organizations are behind on requirements? | missing_submissions
- Events in my college | What events are coming up in my college? | events_attendance
- Endorse an application | How do I endorse an application? | how_to_guide

**Admin**
- What's on my desk today | What should I do today for our organization? | daily_priorities
- What we still owe SAO | What haven't we submitted yet? | missing_submissions
- Our budget and unpaid fees | How much budget is left, and who hasn't paid? | finance_health
- Overdue tasks | Who has overdue or unfinished tasks? | tasks_workload
- Orders needing action | Which merchandise orders need my attention? | merchandise_orders
- Plan an event | How do I create an event? | how_to_guide

**SBO Officer**
- What's on my desk today | What should I do today as an officer? | daily_priorities
- My tasks | Which tasks are mine, and which are overdue? | tasks_workload
- Orders to check | Which orders need payment checking or claiming? | merchandise_orders
- Events to run | What events need check-in today? | events_attendance
- Our budget, read only | How much budget does our organization have left? | finance_health
- Verify an order | How do I verify an order? | how_to_guide

**Student**
- What's on my plate | What do I need to do today? | daily_priorities
- Who hasn't signed | Who hasn't signed my clearance yet, and why? | clearances_status
- What I owe | What fees do I still need to pay? | finance_health
- My orders | Is my merchandise order ready to claim? | merchandise_orders
- Can I vote | Is there an election I can vote in right now? | elections_status
- Events I can join | What events can I join this month? | events_attendance
