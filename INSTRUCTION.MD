# Starting the HIUSA Codex Agent Team

This repository is already configured for agent-assisted coding. The agents are not separate programs or servers that stay running. Start one normal Codex session in this repository; the primary Codex agent will spawn the configured specialists when the task requires them.

## Agents available

| Agent | Purpose | When it runs |
|---|---|---|
| Primary Codex | Implements production changes | Every coding request |
| `tester` | Runs focused deterministic tests | Meaningful behavior changes |
| `browser_qa` | Tests user-facing workflows | Forms, navigation, modals, dashboards, authentication, and other UI flows |
| `security_reviewer` | Performs read-only security review | Authentication, permissions, financial data, elections, uploads, and sensitive workflows |
| `reviewer` | Performs read-only final code review | Large, risky, cross-module, database, or release-critical changes |

The project limits Codex to two concurrent subagents and uses cost-conscious models for specialist work.

## One-time activation

Do these steps once after cloning or after the `.codex/` configuration changes.

1. Open the `Hiusa-FULL` repository in Codex.
2. Start a new Codex chat/session from the repository root.
3. Enter `/hooks` in the Codex prompt.
4. Select the project Stop hook that runs `.codex/hooks/qa-gate.mjs`.
5. Review the command and choose **Trust**.

Codex intentionally requires a human to trust a new or changed project hook. The repository cannot safely approve its own hook.

After trusting it, start another new chat if Codex asks you to reload the project configuration.

## Start coding normally

You do not have to start each specialist yourself. Open a new Codex chat in this repository and describe the feature or fix:

```text
Add an admin feature for approving merchandise orders.
```

The primary agent reads `AGENTS.md` automatically and should:

1. Inspect the relevant code and use case.
2. Implement the complete change.
3. Add or update tests.
4. Run targeted deterministic checks.
5. Spawn `tester` for meaningful behavior changes.
6. Spawn Browser QA, security review, or final review only when applicable.
7. Fix relevant failures and retest.
8. Report exact validation evidence.

Other example requests:

```text
Fix the student election validation error.
```

```text
Add a responsive event creation workflow that follows design.md.
```

```text
Implement the next incomplete requirement from docs/manage-attendance-use-case.md.
```

## Explicitly request the complete workflow

For an important feature, paste this prompt:

```text
Implement this feature completely using the workflow in AGENTS.md. Run targeted tests, use the tester agent after implementation, use browser_qa if the UI workflow changes, use security_reviewer if permissions or sensitive data are affected, and use reviewer if the change is large or risky. Fix relevant findings and report exact test evidence. Do not commit.

Feature: <describe the feature here>
```

## Manually invoke one specialist

Use these prompts when you specifically want one agent.

### Tester

```text
Use the tester agent to validate the current changes. Run the smallest sufficient deterministic tests, do not modify production code, and report PASS or FAIL with exact commands.
```

### Browser QA

Start the required application services first if the workflow needs a real backend, then ask:

```text
Use browser_qa to test the changed user workflow. Check rendering, navigation, forms, loading, validation, success and failure states, console errors, and failed network requests. Do not modify production code.
```

### Security reviewer

```text
Use security_reviewer for a focused read-only security review of the current changes. Check authentication, authorization, organization isolation, ownership, validation, sensitive data, and any applicable financial or election risks.
```

### Final reviewer

```text
Use reviewer for a final read-only review of the current diff. Report only material correctness, regression, contract, database, authorization, concurrency, complexity, or missing-test issues.
```

## Request several agents without wasting credits

Do not ask for all agents on a tiny change. For a large feature, use:

```text
Implement the requested feature as the primary agent. After deterministic tests pass, run the tester. Then run browser_qa and security_reviewer only if their trigger conditions apply. Run reviewer last because this is release-critical. Use no more than two subagents concurrently, wait for their results, fix relevant findings, and retest.
```

## View running agents

- In the Codex app or IDE, open the background-agent/Subagents panel to view active and completed agents.
- In the Codex CLI, enter `/agent` to inspect or switch between agent threads.
- You can tell the primary agent to stop or redirect a running specialist in plain language.

Examples:

```text
Show me the current tester status.
```

```text
Stop browser_qa and continue with backend tests only.
```

## Confirm the setup is loaded

In a new project chat, send:

```text
List the project instructions and custom agents currently available. Do not change files.
```

The response should mention:

- root `AGENTS.md`
- `tester`
- `browser_qa`
- `security_reviewer`
- `reviewer`
- the project Stop QA hook

Then run a cheap validation:

```text
Use the tester agent to inspect the frontend test setup and run only the PaginationControls unit test. Do not modify files.
```

Expected command:

```powershell
Set-Location client
npm run test:unit -- src/components/PaginationControls.test.jsx
```

## What happens when Codex finishes

The trusted Stop hook checks changed files and selects lightweight validation:

- React changes: Vitest, ESLint, and build as applicable.
- Laravel changes: targeted or full PHPUnit tests using isolated in-memory SQLite.
- FastAPI changes: pytest.
- Playwright configuration changes: E2E test discovery.
- Documentation or Codex-only changes: no application suite.

If a check fails, Codex gets one automatic continuation to fix and retry. If the check still fails, the hook stops the repair loop and reports the failure instead of continuing forever.

## If custom agents do not appear

1. Confirm Codex opened the repository root containing `AGENTS.md` and `.codex/`.
2. Close the old chat and start a new project chat so configuration is rediscovered.
3. Check `.codex/config.toml` contains `agents.enabled = true`.
4. Check the four TOML files exist under `.codex/agents/`.
5. Use `/hooks` to confirm the Stop hook is trusted.
6. Send the setup-confirmation prompt above again.

For instructions on starting the HIUSA web application itself, use `README.md`.
