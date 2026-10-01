# GET /api/objectives/overview

Live evidence that each objective of the study is being met, for the "Study objectives in action" page. Auth: Sanctum; roles SUPER_ADMIN, ADMIN, SBO_OFFICER, DEPARTMENT_HEAD, STUDENT; throttle `api-read`.

Scope: the viewer's organization for every role except SUPER_ADMIN, which sees the whole university. Every value is an aggregate count from real records; zero is reported as zero. The query count does not grow with organization size (`ObjectivesOverviewTest`).

Response shape: as in `docs/design/WAVE_B_CONTRACT.md`. `unit` is `count`, or `mean` for an acceptability weighted mean (1.00 to 5.00). `href` follows `config/client_routes.php` for the viewer's role and is null when the role cannot open the page. `status` is `live` (evidence and activity in the last 90 days), `partial` (evidence, but older), or `no_data`.

| Code | Evidence | Source |
|---|---|---|
| GO | Organizations onboarded (SAO only), active member accounts | organizations, users |
| SO1 | Responses describing current practices | evaluation_responses |
| SO2.1 | Forecasts (OLS), budget advisories, AI financial summaries; ledger transactions and receipts for org roles; approved financial reports for the SAO (no ledger rows) | financial_forecasts, budgets.overspending_risk, ai_outputs FINANCIAL_SUMMARY, transactions, financial_reports |
| SO2.2 | AI event plans, completed events, check-ins by fingerprint and manually | ai_outputs EVENT_WORKFLOW, events, attendance.method |
| SO2.3 | Officer scores calculated, tasks delegated with a recorded ranking, AI explanations | task_recommendations, tasks.delegation_snapshot, ai_outputs TASK_EXPLANATION |
| SO2.4 | Completed elections, votes cast, voters in the latest completed election | elections, votes |
| SO2.5 | Orders, claim tokens issued, orders claimed, GCash payments verified | orders |
| SO2.6 | Announcements published, AI-drafted announcements, notifications delivered | announcements, ai_outputs ANNOUNCEMENT_DRAFT, notifications |
| SO3 | Modules with activity in the last 90 days | audit_logs.module |
| SO4 | Acceptability responses; overall acceptability per respondent group, only for the latest closed window and only when the group clears the anonymity rules | evaluation_responses via EvaluationController::results |

Not reported because no backing data exists: task delegation overrides (the system does not record which recommendation was declined).
