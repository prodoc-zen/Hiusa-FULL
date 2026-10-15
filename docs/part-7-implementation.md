# Part 7 implementation

## Roles and behavior

| Request | Role | Result |
| --- | --- | --- |
| Red inventory alerts | Organization ADMIN | Out-of-stock guidance uses the blocked/danger callout, an alert icon, and an accessible alert role. Add stock remains actionable. |
| Outcome notification colors | All signed-in roles, including SAO | Negative outcomes use red; approved, endorsed, verified, completed, paid, claimed, and restored outcomes use green. Neutral updates keep the existing blue treatment. The top bar and SAO inbox share the classification. |
| College archive | SAO SUPER_ADMIN | Revoke affected sessions and block password login, profile switching, and authenticated access. SAO can still open uploaded files. Restore preserves each organization's prior status. |
| College deletion with data | SAO SUPER_ADMIN | Separate from transfer deletion. Requires the exact name, removes organization-owned records and files, and deletes identities without another profile. Shared identities retain their other profiles. |
| Organization deletion and layout | SAO SUPER_ADMIN | Responsive table showing organization/college, status, registration progress, membership, and the shared three-dot action menu. Typed confirmation protects permanent deletion. |
| Application progress | Public applicant with private tracking link | Each stage shows a completed check, current clock, returned cross, or waiting state, plus an explanation and available timestamp in Philippine time. Positive updates are green; returned/expired states are red. |

## Integrity and contracts

See `manage-colleges-use-case.md` for endpoints and deletion semantics. All new management endpoints require Sanctum and SUPER_ADMIN. Frontend services match their request fields and Laravel validation responses. Organization/profile lists add `college_is_active` without removing existing fields. The public organization picker excludes archived colleges.

The delete service locks the selected records, protects SAO and outside organizations, preserves shared identities and shared files, records a deletion audit under the SAO organization, and journals file cleanup inside the database transaction. A conflict rolls back all changes and leaves the files intact. No application data is removed by deployment; deletion requires an explicit action in the SAO UI.

FastAPI is unchanged. The original IDE checkout and its unrelated ledger edits are preserved; implementation uses the isolated Part 7 worktree based on GitHub main.

## Design read and decisions

Anti Slop mode: during implementation, using the user's standing preference. ENERGY 1 / RHYTHM 2 / MOTION 1. The existing `design.md` determines Poppins, the blue/navy palette, subtle borders, and compact administration controls.

- The organization table exposes the fields SAO compares; college headings no longer force one card per row.
- All college and organization record actions use the existing three-dot component to keep repeated controls compact and consistent.
- Green/red communicate a real outcome. Text, stage labels, and check/clock/cross icons carry the same meaning without depending on color.
- Progress has the actual four workflow stages, with explanatory text instead of decorative steps.
- Tables scroll inside their container at narrow widths; dialogs use the existing responsive, keyboard-accessible modal and field primitives.
- No new artwork, decorative gradients, font substitutions, or animation loops were added.

## Anti Slop delivery gate

The user's temporary repository policy prohibits all browser automation and subagents. The primary agent runs deterministic component/API validation and source review directly. No visual browser or live keyboard QA is claimed.

| Item | Status and evidence |
| --- | --- |
| R-02 copy | PASS: new product copy uses plain sentences and no em dash. |
| R-03 mobile | PASS by source review: table overflow is contained, labels wrap, and modals use the existing narrow-screen layout. Visual browser verification is excluded by user policy. |
| R-17 numbers | PASS: membership totals and progress timestamps come from API records. |
| R-18 testimonials | PASS: none added. |
| R-23 assets | PASS: existing logos and icon library retained; no assets fabricated. |
| R-24 navigation | PASS: organization links use the existing overview route; tracking recovery links retain existing destinations. |
| R-25 contrast | PASS: green #166534 on #DCFCE7 is 6.49:1; red #B91C1C on #FEE2E2 is 5.30:1, checked with the skill's contrast checker. |
| R-26 controls | PASS: component tests exercise deletion, archive/restore confirmation, errors, transfer selection, and existing management actions. API tests exercise the real transitions. |
| R-27 states | PASS: loading, empty/filter, error, validation, busy, and success states retained and tested. |
| R-28 FAQ | PASS: none added. |
| R-32 keyboard | PASS under deterministic validation: shared menu/modal/field controls retain keyboard and focus behavior. Browser keyboard inspection is excluded by policy. |
| R-33 source | PASS: production changes applied through source patches; no rewrite scripts added. |
| R-34 themes | PASS: no theme toggle or new theme introduced. |
| R-35 verification | PASS under user policy: production build and deterministic tests executed; browser click-through explicitly excluded. |
| R-36 claims | PASS: no invented compliance, performance, or security claims. |
| R-37 direction | PASS: existing design guide and dials declared before UI edits. |
| R-38 content | PASS: API records, real workflow labels, and honest empty states only. |
| R-01 colors | PASS: brand blue/navy with semantic green/red; no decorative gradients. |
| R-04 icons | PASS: existing Lucide set preserved; check, clock, cross, archive, restore, and delete icons describe actual actions/states. |
| R-06 typography | PASS: existing Poppins identifies the product and keeps tables readable. |
| R-07 backgrounds | PASS: existing white and pale page surfaces; no patterns. |
| R-08 arrows | PASS: none added as decoration. |
| R-09 badges | PASS: existing organization lifecycle badges report real status. |
| R-10 glass | PASS: none added. |
| R-12 shadows | PASS: existing menu/dialog elevation only. |
| R-13 glow | PASS: none added. |
| R-14 cards | PASS: college cards group each college's head; organizations use comparison rows. |
| R-19 motion | PASS: existing interaction transitions only; no new loops. |
| R-22 illustrations | PASS: none added. |
| Dials | PASS: ENERGY 1 / RHYTHM 2 / MOTION 1 declared and followed. |
| Focal point | PASS: comparison table for SAO; current status and stage for applicants. |
| Whitespace | PASS: row dividers and stage spacing separate related records. |
| Accent | PASS: blue for actions, semantic green/red for outcomes. |
| Identity | PASS: Poppins, navy headings, compact controls, and existing HIUSA components. |
| Design Read | PASS: stated before UI implementation. |
| C-1 intentionality | PASS: visual choices and their purposes are recorded above. |
| C-2 completeness | PASS: new controls call real API services with validation and errors. |
| C-3 composition | PASS: table and timeline follow the management and application workflows. |
| C-4 resilience | PASS under user policy: deterministic state coverage plus responsive source review; no browser claim. |
| C-5 evidence | PASS: real API values, executed checks, and stated QA limits. |
| R-05 layout | PASS: comparison table and four actual application stages replace repeated card/number layouts. |
| R-11 radius | PASS: existing control/card radii; round stage icons mark state. |
| R-15 actions | PASS: explicit Delete, Archive, Restore, and recovery labels. |
| R-16 prose | PASS: direct product wording without marketing claims. |
| R-20 identity | PASS: existing HIUSA visual system retained. |
| R-21 mode | PASS: existing light administration theme retained. |
| R-29 palette | PASS: existing palette with semantic status colors. |
| R-30 originality | PASS: repository components and workflow shape retained. |
| R-31 reasons | PASS: each material design choice has a recorded purpose. |

## Executed validation

- `npm run test:unit`: PASS, 182 files and 1,951 tests. Existing jsdom download tests print an unsupported document-navigation notice without failing.
- `php artisan test --stop-on-failure`: PASS, 1,019 passed, 6 skipped, 10,355 assertions. The existing Colleges index query-count check passes. After the final guard/validation changes and the added legacy-assignment regression case, the focused suites below passed again.
- `php artisan test --filter='CollegeOrganizationLifecycleTest|CollegeManagementTest|SaoDepartmentHeadAssignmentTest|AuthRoutesTest|AccountProfileTest|OrganizationLifecycleTest|ArchivedOrganizationReadOnlyTest|OrganizationLeadershipLoginTest'`: PASS, 88 tests and 802 assertions, including all 12 new lifecycle tests.
- `npm run lint`, `npm run build`, `php vendor/bin/pint --dirty --test`, and `git diff --check`: PASS. The existing large ExcelJS chunk warning remains.
- Primary-agent security review: completed directly. Checked SAO-only routes, account/college access enforcement, shared-profile retention, outside-record conflicts, safe file paths, shared-file references, transactional rollback, session revocation, and SAO protection.
- Primary-agent release review: completed directly. Forward migration adds the cleanup journal only; existing transfer API stays compatible; React services and API fields match; production credentials and original checkout edits are preserved.
- Browser QA and subagents: not run, as prohibited by the user's temporary repository policy.
