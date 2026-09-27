# Product

<!-- impeccable:product-schema 1 -->

> Provenance: written 2026-09-27 from repository evidence (the capstone paper `docs/(4) HIUSA - FINAL.md`, `HIUSA_System_Flow.md`, `docs/*-use-case.md`, `design.md`, and the code) under the owner's explicit delegation of all product decisions while unavailable. Items marked (inferred) are reasoned from that evidence rather than stated by the owner; correct any of them freely.

## Platform

web

## Users

- **Student Affairs Office director (SUPER_ADMIN, "SAO").** University-wide oversight across every student body organization: onboards organizations and their admins, is the final approver of budgets and financial reports, publishes official announcements, and watches governance health across organizations. Uses a laptop at an office desk during working hours. (Role documented in `HIUSA_System_Flow.md`; not in the paper.)
- **Organization Admin (ADMIN).** The SBO leadership: president, adviser, secretary, treasurer, auditor. Runs the organization's finances, events, tasks, elections, merchandise and announcements. Laptop and phone, often between classes.
- **SBO Officer (SBO_OFFICER).** Operational officers: process orders and payments, run attendance, update assigned tasks, draft announcements, monitor (not write) finances. Mostly phone, often on the event floor.
- **Department Head (DEPARTMENT_HEAD).** Faculty oversight of a department's organizations: reviews and decides approval requests for events, budgets and elections, reads reports. Laptop, office.
- **Student (STUDENT).** Members: read announcements, vote, order merchandise and claim it with a token, register and check in to events (including fingerprint), see their own receipts and tasks. Phone first.

## Product Purpose

HIUSA is a centralized, AI-assisted management platform for the student body organizations of the University of Cebu Lapu-Lapu and Mandaue (UCLM). It exists to improve financial management, event and task coordination, elections, merchandise management, and organizational communication (the paper's general objective), replacing scattered spreadsheets, group chats and paper forms with one accountable system.

Success means every study objective is visibly provable in the running system: the AI mechanisms for each of the six areas work and explain themselves (SO2), the features are the best version of each workflow (SO3), and the system can assess current practice and its own acceptability (SO1, SO4) through an in-app evaluation module (inferred, decided 2026-09-27 under delegation).

## Positioning

Built for one real institution's governance hierarchy (SAO over organizations, Department Heads over departments, Admins and Officers over members), with accountability designed in: every peso is ledgered and receipted, every approval has an approver and a remark, every vote is counted once, every AI suggestion shows its inputs and reasoning and stays a suggestion.

## Operating Context

- Academic-year rhythm: elections, org week, fairs, general assemblies, semester-end financial reporting and SAO review.
- Money is small-denomination and cash-heavy; GCash is common. GCash payments are manual proof-of-payment verification by an officer, not a gateway.
- Events use a DigitalPersona 4500 fingerprint reader where hardware exists, with manual attendance as the fallback.
- Merchandise is claimed in person with a claim token.
- Philippine context: peso currency (PHP, ₱), Asia/Manila timezone, English UI.
- The system is defended before a dean and evaluation panel against the paper's objectives.

## Capabilities and Constraints

- Stack: React 19 + Vite + Tailwind 4 client, Laravel 12 + Sanctum API, FastAPI deterministic AI service (OLS forecasting, budget advisory, weighted task scoring), Groq LLM for drafting, summaries and the event planning assistant, a .NET SourceAFIS fingerprint matcher. Local dev DB is MariaDB on port 3307; production is Docker Compose on EC2.
- Roles are fixed strings: SUPER_ADMIN, ADMIN, SBO_OFFICER, DEPARTMENT_HEAD, STUDENT. `organization_id` is a hard tenant boundary.
- AI output is decision support only: never auto-assigns, auto-approves or auto-publishes.
- Payments: GCash and Cash on Claim only.
- Elections are organization-level and do not verify identity beyond platform authentication.
- Finance: recording transactions and allocating budgets is ADMIN; reading transaction history, insights and budget monitoring is also open to SBO_OFFICER and DEPARTMENT_HEAD per the paper (Fig. 35, 36); final budget and report approval is SUPER_ADMIN (decided 2026-09-27 under delegation).
- Voting is open to ADMIN, SBO_OFFICER, DEPARTMENT_HEAD and STUDENT (Table 24; the team's 2026-09-20 commit).
- Extended scope beyond the paper (inferred, decided under delegation): SAO organization compliance and accreditation, venue booking, confidential grievances with AI classification, digital clearances with signature routing, the evaluation module, per-role onboarding, a command palette.

## Brand Commitments

- Name: HIUSA, always uppercase. Logo: the faceted blue triangle mark (`client/public/hiusalogo.svg`, `client/src/assets/Hiusa Logo.png`), never recreated, recolored or stretched.
- Palette and typography are pinned by `design.md` and the project CLAUDE.md: Deep Navy #0B1831, Dashboard Navy #0F2F62, Primary Blue #0B8ED0 (hover #0878B7), Electric Cyan #16C7F3 (focus and accents only), page #EEF6FB, border #DDE7EF, text #0F172A / #64748B / #94A3B8, success #16A34A, warning #F59E0B, danger #DC2626. Poppins only. lucide-react icons only.
- Voice (inferred from the dean's feedback and the product's audience): warm, plain, human, never system-speak; speaks to students and officers as people doing real work for their organization.

## Evidence on Hand

- The paper and its figures: `docs/(4) HIUSA - FINAL.md`; 28 documented use cases in `docs/*-use-case.md`; role workflows in `HIUSA_System_Flow.md` and `docs/diagrams/`.
- Seeded demo data for 5 organizations and every role (`server/database/seeders`; demo accounts in `README.md`).
- No real survey responses exist yet (the paper reports zero respondents). Never fabricate testimonials, respondent counts, acceptability scores or usage statistics.

## Product Principles

1. Every screen answers to a study objective; if a feature cannot say which objective it serves, it does not ship.
2. Accountability is visible: who did what, when, approved by whom, with what evidence.
3. AI explains itself and defers to people.
4. Self-serve over asking the admin: each role can finish its own job without a workaround.
5. Warmth is part of correctness: people should feel the system is on their side.

## Accessibility & Inclusion

Mobile first for students and officers (390px), keyboard operable, visible focus, labels on every input, status never by color alone, reduced motion respected, WCAG 2.2 AA contrast on the pinned palette.
