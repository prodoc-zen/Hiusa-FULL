# Required sample formats

Every requirement published through the organization, semestral-report, and event requirement editors needs a sample format supplied by its publisher. These editors remain SAO-only. Applicants and organization members do not supply the official sample.

## Publisher behavior and API

The existing create/update routes accept one of `template` (an uploaded file) or `template_url` (an HTTP(S) link) with the requirement details. Providing both is rejected. Compliance samples accept the supported document/image formats up to 10 MB; event samples remain PDF-only, up to 10 MB.

- `POST /api/compliance/requirement-types`: organization and semestral-report requirements.
- `PUT /api/compliance/requirement-types/{id}`: update details, retain a valid sample, or replace it.
- `POST /api/event-requirements` and `PUT /api/event-requirements/{id}`: event requirements.
- File updates use multipart POST with `_method=PUT`, so PHP parses the attachment. Link-only requests retain JSON.

Missing or invalid samples return Laravel `422` field errors. A failed upload rolls back the requirement and prevents its creation notification. Existing private file paths remain hidden. Replacing a sample removes the superseded file after commit. Existing standalone sample replacement endpoints remain compatible. Removing a sample from an active requirement returns `409`; deactivate it first, and provide a sample before reactivation. The save and removal paths lock the requirement before checking its current sample/status.

New semester defaults and the semestral-report seed command create inactive requirements. After activating the semester, SAO attaches the official samples and activates the intended requirements in Requirement settings. Existing records retain their status. Sample replacement, removal, and requirement/semester deletion use the existing durable file-cleanup journal, so a temporary disk failure can be retried after the database commit. See [the follow-up audit](requirement-audit-2026-10-18.md) for cache and lifecycle corrections.

The public registration form, Department Head registration/resubmission form, organization compliance uploads, and event uploads show sample availability beside the requirement. Available samples have an explicit view action; existing sampleless records show that SAO must supply the format. Publishing warnings identify these rows in the SAO editors. Requirement and sample saves now use one mutation instead of two sequential requests, preserving the shared API cache's existing invalidation behavior.

## Existing records

No schema migration, production seeding, or document fabrication is involved. Existing obligations and submitted files remain intact. On October 18, 2026, a read-only Lightsail audit found 15 active compliance requirements and 18 active event requirements with no sample attached. The publisher must add the actual formats through **SAO > Requirement settings**. The application cannot display official documents that have never been provided.

## Design and validation

Anti Slop mode: during, using the session choice. Design read: requirement publishing and submission forms for SAO, Department Heads, and applicants in the existing HIUSA administration style, ENERGY 1 / RHYTHM 1 / MOTION 1. Poppins, blue sample actions, subtle borders, compact fields, and semantic error text follow `design.md`.

| Gate | Evidence |
| --- | --- |
| Content and assets, R-17/18/23/36/38 | PASS: only publisher-provided samples, real filenames, and an explicit missing-sample state; no formats or official claims invented. |
| Function and states, R-24/26/27/35, C-2 | PASS under the repository policy: deterministic tests cover mandatory fields, same-request saves, file/link opening, server errors, and failed-upload rollback. Browser click-through is excluded by the user's policy. |
| Accessibility and layout, R-03/25/32/34, C-4 | PASS by source and component checks: existing labeled controls, 44px sample action, focus indicators, wrapping filenames, and shared responsive form/table components. No new theme. Visual browser QA remains unperformed. |
| Purpose and identity, R-01/04/06/19/20/29/31/37, C-1/3 | PASS: the sample sits beside the matching upload to guide document preparation; missing-sample text identifies the publisher's next action. Existing brand and interaction styles retained. |
| Source, R-02/33 | PASS: changes made in the source; plain product copy without em dashes or rewrite scripts. |

Tests use isolated SQLite databases, fake private storage, and fake/array mail. Primary-agent security review checks SAO middleware, safe file formats and links, hidden storage paths, rollback, replacement, and publication/removal state checks. FastAPI and the database schema are unchanged. No subagents or browser automation are used.

Executed validation:

- `npm.cmd run test:unit`: PASS, 184 files and 1,974 tests.
- `php artisan test --compact --stop-on-failure`: PASS, 1,034 passed, 6 skipped, 10,500 assertions.
- `npm.cmd run lint`, `npm.cmd run build`, `php vendor/bin/pint --dirty --test`, and `git diff --cached --check`: PASS.
- Contrast formula checks: sample actions `#0878B7` on white, 4.79:1; missing-sample text `#B91C1C` on white, 6.47:1; error text on `#FEE2E2`, 5.30:1.
- Existing jsdom download navigation notices and the large ExcelJS chunk warning remain non-failing. Visual/browser QA was not performed, per the repository policy.
