# Requirement workflow and cache audit

Scope: organization applications, college registrations, compliance and semestral reports, event checklists, publisher samples, semester transitions, private files, and the shared API caches. Related authentication, college isolation, reviews, storage quotas, and frontend consumers were inspected. Deterministic suites also cover the other application modules. This is not a claim that every possible defect has been found.

## Corrections

| Finding | Result | Regression evidence |
| --- | --- | --- |
| Semester creation and the semestral-report command published items without samples. | Newly generated requirements start inactive. SAO supplies a sample and activates each item after activating the semester. Existing requirements are untouched. | `AcademicSemesterTest`, `ComplianceLifecycleTest` |
| A completed semester's unused compliance requirement could be deleted directly. | The locked deletion path returns 409. Event deletion also checks references while holding the requirement lock. | `RequirementSamplePolicyTest`, existing deletion and semester tests |
| Standalone sample endpoints used a separate replacement implementation and accepted an ambiguous file plus link. | File and link endpoints use the same locked transactional service as requirement editing, preserving their routes and required fields. Ambiguous input returns 422. | `RequirementSamplePolicyTest`, existing compliance/event sample tests |
| Removing a sample could commit the database change and then return an error when deleting the file. | Superseded sample paths enter the existing durable cleanup journal in the same transaction. Cleanup runs after commit and failed operations are retried by the existing hourly task. | Removal/storage-failure/retry regression in `RequirementSamplePolicyTest` |
| Deleting an unused semester left its sample files behind and did not report application-document references. | Sample cleanup is journaled after deletion; application documents are an explicit deletion blocker. | Semester cleanup regression and existing semester-reference tests |
| Public registration and event submission could return success when storage returned false. | Storage failure aborts and rolls back the request. Existing documents and review state survive; no verification mail is sent. College registration paths also check storage results explicitly. | `OrganizationApplicationTest`, `EventRequirementSubmissionTest` |
| Application resubmission queried existing documents once per requirement. | One locked collection supplies all existing documents. For ten requirements, checklist reads fall from eleven queries to one. | Query-count regression in `OrganizationApplicationTest`, reproduced before and after the change |
| Late requirement-list responses could overwrite a newly selected category or review filter. | Request versions discard superseded responses. | Category-switch regression in `RequirementsTab.test.jsx` |
| Switching events could retain the previous event's files, selected uploads, or late response. | Event submission state is keyed by event ID. | Event-switch regression in `EventSubmissionPanel.test.jsx` |
| Date and URLSearchParams values collapsed into identical client cache keys. | Keys preserve their serialized values. Custom parameter serializers bypass this cache. | `apiCache.test.js` |
| Explicit refresh left a stale entry or in-flight request available to later navigation. | Refresh evicts that entry and detaches older requests without flushing unrelated entries. Retry actions request fresh data from both cache layers. | `apiCache.test.js`, `api.cache.test.js`, event retry component test |
| Consumers could mutate cached response headers. | Cache snapshots and returned headers are isolated. | `apiCache.test.js` |
| The server cache ignored refresh and no-store directives. | No-cache recomputes and replaces an entry. Request/response no-store bypasses storage. | `CacheApiResponseTest` |
| Cache version lookup failure could reuse an old namespace. Concurrent read/increment/write invalidation could also lose a change. | Lookup failures fall back to the controller; invalidation uses a new UUID token without reading the previous version. | Failure regression, existing cross-organization approval invalidation tests, source review |
| Cached responses lost Vary headers and did not recognize weak or wildcard conditional GETs. | Vary survives hits and 304 responses; weak and wildcard ETags are handled. | `CacheApiResponseTest`, existing CORS/cache tests |

## Cache behavior

Existing bounds remain: 75 client entries, 1 MB per JSON entry, 5 MB total, a 60-second default client lifetime, and a 20-second default server lifetime. Concurrent identical JSON requests share the network request. Downloads and cancellation stay independent. Sessions and organization/role identities remain separated. Successful client writes invalidate its cache, and successful authenticated server writes invalidate the applicable organization and oversight namespaces. A refresh of one entry does not discard other entries.

These are bounded application caches, not real-time subscriptions. Changes by another session may remain visible until the configured lifetime expires or a fresh request is made. No production cache TTL, credentials, environment file, or stored obligation was changed. Performance evidence is the measured query reduction and deterministic cache request counts; no browser latency or load-test claim is made.

## UI and Anti Slop

Mode: during implementation, from the user's session choice. Design read: existing HIUSA requirement publishing and submission workflows; ENERGY 1 / RHYTHM 1 / MOTION 1. The only added visible guidance explains inactive semester defaults and tells SAO where to attach samples. Existing Poppins, compact layouts, labeled fields, blue actions, semantic errors, and responsive components are retained.

- Hard gate PASS under the user's validation policy: component checks cover changed behavior; no new navigation, assets, layout patterns, fabricated documents, statistics, or claims. Browser automation and visual click-through are excluded by that policy.
- Purpose gate PASS: the semester note explains a real publishing prerequisite; retries retrieve fresh data. No decoration, icons, fonts, motion, or theme changes were added.
- Liveliness PASS by source review: the existing tables/forms remain the focal points and preserve the HIUSA palette and spacing; declared dials are unchanged.
- Craftsmanship PASS by source/component review: real service calls, busy/error states, isolated event state, and stale-response protection. Visual/mobile/keyboard behavior has not been browser-tested.

## Review boundaries

The primary agent performs implementation, deterministic validation, security review, and release review directly. No subagents, Playwright, browser E2E, or live browser automation are used. Test databases are isolated SQLite memory databases, storage is fake, and mail/external AI calls are disabled or faked. No production test creates an application, document, approval, notification, or financial record.

Official sample documents must come from SAO. Existing missing samples are a content gap, and are not replaced with invented formats. Newly generated inactive defaults do not open public registration until SAO publishes registration requirements. Existing event approval behavior still depends on the applicable active checklist. Before running a new term, SAO must publish its intended event requirements as well.

## Executed validation

- `npm.cmd run test:unit`: PASS, 184 files and 1,981 tests. After the final request-cleanup and registration-notice edits, the eight affected frontend suites were rerun: PASS, 105 tests.
- `php artisan test --compact --stop-on-failure`: PASS, 1,049 passed, 6 skipped, 10,787 assertions. The initial full run identified four lifecycle fixtures that relied on automatically active defaults; those fixtures now publish samples through the API before asserting registration behavior.
- `npm.cmd run lint`: PASS, zero warnings/errors. `npm.cmd run build`: PASS. `php vendor/bin/pint --dirty --test`: PASS.
- From the worktree's `ai-service` directory, `& 'C:/Users/John Carlo/WEBSITE PROJECTS/Hiusa-FULL/ai-service/.venv/Scripts/python.exe' -m pytest -q`: PASS, 31 tests. Python source is unchanged.
- `git diff --check`: PASS. Git ignore and tracked-file/history checks found no PEM/key files in Git. The original dirty IDE checkout is preserved.
- Non-failing existing notices: jsdom document navigation, the lazily loaded ExcelJS export chunk, and Starlette's test-client deprecation. No dependency upgrade is included.
- Primary-agent security/release review: performed directly, covering SAO-only publishing, organization/college isolation, private file access, validation, rollback, deletion references, cleanup retries, and cache identity/invalidation. Browser QA is excluded by user policy.

Read-only Lightsail preflight found all seven services active, the cache enabled with a 20-second server TTL, and no pending file cleanups. All 15 active compliance requirements and 18 active event requirements still lack actual samples. SAO must supply those official formats; this release does not invent them or silently remove those obligations.

Deployment follows `docs/native-lightsail-deployment.md`: fast-forward the existing clean tracked checkout at `/var/www/hiusa`, build the frontend, refresh Laravel caches through the native wrapper, reload PHP-FPM, and restart the queue/scheduler. No schema migration or seeding is needed.
