# Part 9 governance and administrator access

Source: `D:\Downloads\part 9.docx`, including its three screenshots. The implementation addresses its product requests. Repository safeguards, the no-subagent/no-browser policy, credentials, and production data remain protected.

## Requested behavior

| Request | Implementation |
| --- | --- |
| Simple transitions for buttons and modal openings, remembered in `design.md` | Native buttons and links have short state transitions; shared buttons use the same 150 ms timing. Enabled button presses move 1 px. Shared and legacy modal panels fade and move 4 px over 180 ms. Reduced-motion settings remove movement and entrances. The persistent design guide records these rules. |
| Green active status | Current academic years and active semesters use the existing green success badge and retain readable status labels. |
| Organizations sidebar group becomes Governance | SAO navigation and related breadcrumbs use Governance. Existing page URLs and the names of the organization records remain unchanged. |
| Explain the compliance Overdue column | The column is now Past deadline, with visible text explaining that it counts requirements past their deadlines which have not been approved, including files awaiting SAO review. The existing calculation is preserved; requirement details expose the deadlines and review states. |
| SAO can add Admins from University users and Organizations | Both screens offer Add administrator. SAO can create a new account or choose an eligible existing login for a separate Admin profile. University users also offers Add Admin profile on eligible user rows. Existing administrators are retained. |

## API and security

`POST /api/system/admins` remains protected by Sanctum, the SAO role middleware, write throttling, and the organization write guard. It now accepts `organization_id`, unique `school_id` and `email`, names, a confirmed initial `password`, and optional `position_title`/`contact_number`. The destination must be an active student organization in an active college. School IDs are positive integers of at most eight digits; passwords are 8 to 72 characters. Client-provided role, account status, and password hashes are prohibited. Creation returns 201 with a primary Admin profile and `must_change_password=true`; password hashes remain hidden. The user/profile/position/audit writes share one transaction. No creation email is sent.

`POST /api/account-profiles/invite` now permits the Admin role for SAO as well as organization Admin callers. College eligibility, active account checks, organization ownership for non-SAO callers, duplicate protection, and audit logging remain enforced. Existing passwords, primary roles, and memberships are preserved. This action adds a profile to a different eligible organization; it does not overwrite an existing membership or appoint Department Heads. Department Head appointments retain their separate workflow.

The University users response adds `profile_roles`. Its role filter matches primary or secondary roles, so a new Admin profile can be found without changing the user's primary identity. Related profiles are eager loaded once per page. The React consumer renders the distinct roles and retains the existing user/detail contracts.

Registration approval, handover restrictions, existing-account password recovery, and last-administrator deletion protection are unchanged. No schema or FastAPI change is required. Successful writes use the existing client/server cache invalidation paths. Organization choices are fetched only when the new dialog needs them; opening it for a specific organization does not fetch another organization list.

## Design read and Anti Slop

Mode: during implementation, from the user's session choice. ENERGY 1 / RHYTHM 1 / MOTION 1. The existing HIUSA identity supplies Poppins, navy headings, blue actions, compact forms, restrained borders, and semantic status colors. Motion acknowledges a press or dialog opening and never delays a business action. The form uses the existing modal/field/button components, collapses its two columns on mobile, and retains loading, busy, error, cancellation, and validation states. No new visual assets or decorative patterns were introduced.

| Gate | Evidence |
| --- | --- |
| Hard gate | PASS within the user's validation policy: real API actions, labeled controls, explicit states, retained keyboard/focus handling, no fabricated claims/assets, and no new navigation destinations. Browser automation is prohibited and no visual browser result is claimed. |
| Purpose gate | PASS: short feedback transitions, green current/active states, a clearer deadline explanation, and direct administrator actions serve the requested workflows. No decorative loops or layout animations. |
| Liveliness | PASS by source review: existing HIUSA tables/forms remain the focal points, with deliberate blue actions and semantic green status. Dials and design source are explicit. |
| Craftsmanship | PASS by component/API checks and source review: working create/invite actions, duplicate-submit protection, role/college boundaries, preserved shared identities, error recovery, and reduced-motion rules. Visual/mobile animation smoothness is not browser-verified. |

Contrast checker: green status text `#15803D` on `#EBF7EF` is 4.56:1; blue actions `#0878B7` on white are 4.79:1. Both pass normal-text AA.

## Validation and deployment

The primary agent performs implementation, security review, and release review directly. Tests use SQLite memory databases, fake storage, and fake/array mail. No browser E2E, live browser automation, or subagent is used. Production verification checks health, assets, route authentication, and deployed revision without creating real users, sending mail, or changing records.

Deployment uses the existing native Lightsail instructions in `native-lightsail-deployment.md`. There are no dependency or schema changes, and production environment files and the local PEM stay outside Git.

Executed checks:

- `client`: `npm.cmd run test:unit` — PASS, 186 files and 1,994 tests. Old expectations for the Organizations group were updated to Governance before this final run. JSDOM reports its existing unsupported document-navigation warning; no tests fail.
- `client`: `npm.cmd run lint` — PASS; `npm.cmd run build` — PASS. The existing lazy ExcelJS chunk warning remains.
- Built CSS parsed with PostCSS — PASS for native control transitions, enabled-button feedback, 180 ms modal timing, legacy modal entry, and reduced-motion press reset. The production compiler converts individual translations to equivalent transforms.
- `server`: `php artisan test --filter='OrganizationLifecycleTest|SuperAdminFingerprintTest|MustChangePasswordFlaggingTest'` — PASS, 45 tests and 671 assertions. Old creation-ban expectations now enforce the new SAO creation policy and retain pending-organization, role-injection, and existing-account boundaries.
- `server`: `php artisan test` — PASS, 1,055 tests, 10,854 assertions, and six existing skips. This includes API cache, authorization, membership, lifecycle, and password-change coverage.
- `php server/vendor/bin/pint --dirty --test` and `git diff --check` — PASS.
- `ai-service`: existing development virtual environment Python, `-m pytest -q` — PASS, 31 tests. Its existing Starlette/httpx deprecation warning remains.

Lightsail revision, service health, protected-route authentication, and published asset checks are verified after the GitHub push and recorded in the release report. Production business writes are not used as deployment probes.
