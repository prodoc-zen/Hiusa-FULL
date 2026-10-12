# SOP gap analysis: what the school and CHED require, and what HIUSA still needs

Researched 2026-10-12 from public sources. This document ranks what to build. Nothing here is built yet. Where a rule differs between the University of Cebu manual and CHED, the system should take the numbers from an SAO-editable settings screen, not from code.

## 1. Sources and how much to trust them

| Source | What it is | Trust |
|---|---|---|
| University of Cebu Student Manual, June 2019 edition, 140 pages. `https://enrollment.uc.edu.ph/college/PROS/sm2024.pdf` | The school's own rules. Read in full. Part J (organizations) pp.39 to 46, K (activity permits) pp.46 to 49, L (off-campus) pp.49 to 53, discipline pp.77 to 87 | High for what it says. Dated 2019, so ask the SAO whether a newer edition exists. No UCLM-specific edition was reachable |
| CHED Memorandum Order (CMO) 18 s.2026, signed 22 Jul 2026 | Replaces CMO 9 s.2013 on student affairs and services | High (read the text). Publication and effectivity date not found |
| CHED CMO 6 s.2026, 6 Apr 2026 | Recognition and operation of school-based organizations, anti-hazing | High (read the text). Effectivity date not found; treat as binding within a year |
| CHED CMO 63 s.2017 | Local off-campus activities. Still the operative rule | High |
| CHED CMO 3 s.2012 | School fees and consultation with the student council | High, but not confirmed still current |
| RA 10173 (Data Privacy Act), NPC Circulars 2022-04 and 16-03 | Obligations for a system that holds student records | High |
| RA 11313 (Safe Spaces), RA 11053 (Anti-Hazing), RA 7079 (Campus Journalism) | Complaint handling, hazing filing, publication funds | High |
| UP Cebu, Cebu Normal University, University of Luzon, Xavier University and others | Comparison manuals, used to see what is common | Medium. Different schools |

Not found anywhere: election rules for student organizations (the school's own rules govern; for UC they are probably in each organization's constitution), cash advance and liquidation policy at UC, organization performance ratings at UC, UCLM-specific procedures, the names of the SAO's current forms.

## 2. What the system already covers

Strong: yearly document submission with SAO review, the event approval chain (Admin, Department Head, SAO) with on-campus and off-campus checklists, venue booking with conflict checks, budgets, ledger, collections, cash advances with a two-person rule, financial reports with a three-stage approval, merchandise orders, elections, grievances, clearance, audit logs, and AI forecasts and task delegation.

Not covered: see section 3.

## 3. What to implement, ranked

Each item shows the evidence, the size (S small, M medium, L large) and the cheapest place in the code to add it.

1. **Accreditation with a validity period (M).** UC pp.41 to 42: renew by 30 June, certificate valid to 15 July, probationary accreditation exists, revocation for failure to renew. CMO 6 sections 11 to 13: file within the first 30 working days of the academic year, SAS reviews within 30 calendar days, certificate valid one academic year, no activity before the certificate. Build statuses accredited, probationary, expired, revoked; expiry date; reminders at 30, 14 and 3 days; a certificate PDF; and block event proposals unless accredited. Code: `AccreditationStatusService`, `Organization.lifecycle_status`, `routes/console.php`. The existing document deadline field is stored but never enforced.
2. **Event timing rules (S to M).** UC pp.46 to 48: permit 1 week before, no activity in the school week before exams. UC and CMO 63: 1 month for off-campus, 15-day compliance certificate, parent notice 1 to 2 months ahead, one personnel in charge per 35 to 50 students. Code: the validation block in `EventController::store/update`, plus exam dates on the Academic years screen.
3. **Post-activity report within 3 days (M).** UC pp.47 to 48: report with a financial statement signed by President, Treasurer and one more officer; without it the next permit may be refused. Code: `FinancialReportController` (event report exists), `EventController`, a scheduled check.
4. **Adviser rules and endorsement (M).** UC p.46: Dean and Adviser endorse before the SAO reviews. CMO 6 section 23: adviser is not a member and advises at most 2 organizations. Today "Adviser" is only a title on an Admin account. Code: `config/approvals.php`, `EventApprovalChain`, `SboPositionController`.
5. **Officer eligibility (M).** UC pp.42 to 43: at least 18 units, 3.0 GPA, no discipline record. CMO 6 section 24: bona fide student, one year residency, good standing. The system holds no grades, so record eligibility per officer, verified by the adviser or SAO, and flag exceptions. Grades are sensitive data (see item 8).
6. **Fee and fund-raising authority (M).** UC pp.43 to 45: written approval before collecting fees or running fund-raising. CMO 3 s.2012: consult the student council and post notice 15 days before new fees. Code: a new request type in the approvals config, and a check in `FinancialAccountabilityController` collection recording.
7. **Clearance holds (S to M).** UC: missing reports can hold clearance. Wire clearance to unsettled accounts and overdue reports. The balance is already computed in `StudentAccountBalances`.
8. **Data privacy (M).** RA 10173 treats education information as sensitive. Fingerprints are biometric data. Needed: a privacy notice and recorded consent at first sign-in, a consent record for fingerprint enrollment, a retention schedule, a breach register with a 72-hour clock, and a data protection officer field. None of this exists today. Strong for a panel.
9. **SAO reports (S to M).** CMO 6 section 14 and CMO 18 section 18: the school keeps a registry of organizations, denials and sanctions and reports yearly. Add an exportable registry and an overdue list.
10. **Discipline and Safe Spaces cases (L, later).** UC pp.77 to 87: written complaint, 5-day answer, hearing, committee, decision within 30 working days, 5-school-day appeal. RA 11313: decide within 10 days. Today a grievance is a ticket only.
11. **Elections (L, design choice).** No national or UC rule found. A model such as UP Cebu's electoral board (filing window, eligibility, bond, canvass) is possible, but confirm with the SAO first.
12. **Initiation rite filing (low).** CMO 6 section 10 and RA 11053 apply only if organizations hold initiations. Build only if the SAO says they do.

Also fix: the financial-report deadline table has no screen that writes it, so it does nothing. Either wire it up or remove it.

## 4. Design recommendation

Put every number on an SAO-editable policy settings screen: lead times, due dates, exam weeks, renewal window, grace days, reminder days. The 2019 manual and the 2026 CHED orders differ on dates, and UCLM may differ from both.

## 5. Conflicts to resolve with the SAO

- UC says renew by 30 June and valid to 15 July. CMO 6 says file in the first 30 working days of the academic year and valid one academic year. Take the stricter reading until told otherwise.
- UC calls the permit an "Activity Permit" with a "Waiver/Quitclaim". The system seeds "Document Tracking Slip" and "Student Activity Clearance/Permit Form", which UC's manual never names. Confirm the current forms.
- The manual uses Chancellor and Executive Vice Chancellor. Confirm the titles at UCLM.
- The Evaluation module was removed on purpose and stays removed unless the owner says otherwise.

## 6. Questions for the SAO

1. Is the June 2019 student manual the current edition, and is there a UCLM edition?
2. Where are the election rules (the UCCP constitution)?
3. Is there a cash advance and liquidation policy?
4. Should the Civil Security Unit and Campus Director steps appear in the system?
5. What are the current form names?
6. Does UCLM file the CHED Report of Compliance, or is it exempt as an autonomous or deregulated school?
