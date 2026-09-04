# AI-Assisted Workflow Architecture

HIUSA uses AI as a reviewable decision-support layer. Laravel remains the only caller of external AI, validates every response, persists versioned history, and applies organization and role authorization before any data is read or changed.

## Adopted patterns

- **Trigger, rules, actions:** Asana AI Studio combines language-model steps with deterministic workflow rules. HIUSA follows this separation: Groq proposes structured event content; Laravel controls validation, persistence, confirmation, notifications, and authorization. Source: [Asana AI Studio](https://help.asana.com/s/article/ai-studio-smart-workflows?language=en_US).
- **Human checkpoint:** generated work stays a draft until an Admin edits and confirms it. This mirrors review checkpoints and avoids autonomous writes.
- **Suggestion before creation:** Jira's Rovo flow presents suggested child work items and creates them after acceptance. HIUSA similarly returns proposed tasks and creates real `tasks` rows only through the confirm endpoint. Source: [Atlassian AI features in Jira](https://support.atlassian.com/organization-administration/docs/atlassian-intelligence-features-in-jira-software/).
- **Planning data does not rewrite accounting:** financial forecasts/advice use real ledger totals, while planning outputs remain separate from transactions and approved budgets. Source: [QuickBooks cash flow planner](https://quickbooks.intuit.com/learn-support/en-us/help-article/budget-forecast-reports/use-cash-flow-planner-quickbooks-online/L2l59mIqe_US_en_US).
- **Schema-constrained model output:** Groq calls use the Responses API JSON-schema format. Laravel then performs domain validation for dates, phases, dependencies, and allowed values before saving. Source: [Groq Responses API](https://console.groq.com/docs/responses-api).
- **Numeric fact guard:** task and financial explanations are accepted only when every numeric claim already exists in the backend-calculated context. Rejected or unavailable explanations are logged as failed; deterministic calculations remain clearly identified and usable.

## Event workflow sequence

1. Admin submits real event details and requirements.
2. Laravel adds linked budget summaries and schedule conflicts, then calls Groq with a strict JSON schema.
3. Laravel validates and stores a versioned `EVENT_WORKFLOW` output. Failed calls are stored as failed and return a retryable error; no placeholder workflow is created.
4. Deterministic weighted scoring ranks currently eligible officers for every proposed task.
5. Admin edits titles, deadlines, phases, priorities, dependencies, preferred roles, and assignees.
6. Confirmation transaction creates tasks, dependency links, ranking snapshots, notifications, the accepted-version marker, and an audit log.
7. Dependent tasks are exposed as `blocked` until their prerequisite is complete, then as `ready`.

## AI responsibility boundary

- Groq: event plan/workflow wording, announcement drafts, and explanations of already-calculated financial/delegation facts.
- Laravel/FastAPI: authorization, organization scoping, validation, task eligibility and weighted scores, OLS forecasting, budget arithmetic, state transitions, audit records, and all database writes.
- React: authenticated input and an explicit review/edit/confirm experience. It never receives an AI provider key.
