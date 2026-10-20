# Borgueta Part 7 implementation

Source: `docs/fixes to add - borgueta/PART 7.docx`, read as product requirements with its four screenshots. This is distinct from the earlier Part 7 PDF and Part 9 changes. Repository safeguards and the user's temporary ban on subagents and browser automation apply.

## Requirements and implementation

| Document request | Result |
| --- | --- |
| Do not create applicant Admin accounts until Department Head and SAO approval | The existing application service already enforces this. Regression assertions verify that neither the user nor Admin profile exists before final approval, including after endorsement. Existing verified identities retain their credentials and receive a new profile only after approval. |
| School-photo login backdrop | AuthLayout reuses the existing campus asset behind its opaque HIUSA card. The same layout serves recovery screens; no new image or external image request is introduced. |
| Explain registration progress and â€œprovisionâ€ | User-facing labels say Registration submitted, SAO approval, Admin account, and Initial setup. The callout says Add the first Admin account and explains the action. Unified organizations explicitly skip college endorsement. |
| Paginate college files | Ten files per page, explicit page-size choices, and always-visible pagination controls. Filters reset the page, and effects discard outdated responses. |
| Delete or replace existing college files safely | A Department Head may change compliance/registration uploads in active organizations in their college. Server scope, lifecycle, semester, file-format, quota, and stale-version rules apply. Replacement resets SAO review. Audit/notifications are transactional and old-file cleanup is journaled after commit. A same-second version regression is covered. Other document families retain their existing workflows. |
| Department Head announcements to a chosen organization | College announcements supports selection from paginated active organization choices, drafts, publishing, editing, unpublishing, deletion confirmation, and error recovery. Heads manage their own posts; the normal feed remains audience-filtered. Active secondary profiles receive notifications. |
| SAO organization open to every college | Add unified organization creates an approved, university-wide student organization and opens the first-Admin form. Membership may cross colleges, while ordinary organization rules and private record scopes remain intact. SAO receives its operational approvals. |

## Contracts and data

The new `organizations.is_university_wide` boolean defaults to false. Migration `2026_10_20_000001_add_university_wide_organizations.php` is forward-only in production and has an isolated rollback check. No seed or data reset is needed. SAO alone may POST `/system/unified-organizations`. It accepts unique name/acronym and an optional description, rejects college/parent/system-role/lifecycle overrides, and returns 201. It creates no users. Existing account creation, profile invitation, and switching use the scope flag without replacing identities.

Announcement writes permit Department Heads with college ownership and creator checks; ordinary callers cannot choose an arbitrary organization. `managed=1` exposes only a Head's own posts. File POST replacement and DELETE retain the `submitted_at` version contract and Laravel 422 validation format. The version advances for same-second replacements. Events with required uploads wait for complete evidence before SAO review; budgets, elections, and financial reports use SAO directly for unified organizations. Ordinary college approval tests retain their existing chain. Election metadata carries `approval_required_role` so React names the correct reviewer.

The existing API cache separates authenticated identities and invalidates successful writes, including college and SAO writes across affected scopes. New dialogs load organization options on demand, fixed-organization Admin dialogs reuse their supplied target, lists remain paginated, and event approval metadata keeps a bounded query count. University users no longer triggers a redundant initial search refresh that could close an open action menu; a fake-timer regression checks both the single request and the preserved action. No dependency or FastAPI contract changes are required.

## Anti Slop and review

Mode: during implementation, from the user's session choice. Design source: `design.md`; ENERGY 1 / RHYTHM 1 / MOTION 1. Existing Poppins, navy/blue palette, compact administration layouts, labeled controls, shared modals, and reduced-motion rules are retained. The backdrop is the user's requested school context; opaque panels preserve text contrast. There are no generated assets, decorative loops, or new marketing sections.

- Hard gate: deterministic component/API checks and direct source review cover real actions, validation, loading/error/busy states, role boundaries, and preserved identities. Browser validation is excluded by the user's policy.
- Purpose gate: photo backdrop supplies school context; clear status/action copy, file controls, and organization targeting address the document's workflows.
- Liveliness: existing HIUSA branding and restrained campus photography provide the identity; no unrelated redesign.
- Craftsmanship: targeted and full suites, migration integrity, stale-file/rollback coverage, and deployment probes provide executable evidence. Visual animation/mobile rendering are not browser-verified.

Contrast checker executed: blue `#0878B7` on white 4.79:1; dark text `#0F172A` on white 17.85:1. Both pass normal-text AA. New text stays on opaque surfaces.

## Release validation

The primary agent performs testing, security review, and release review directly. Laravel tests use SQLite memory, fake storage, array/fake mail, and disabled external AI. No production records, users, emails, votes, orders, or uploads are created as probes. The original dirty checkout is preserved; implementation lives in its isolated worktree. The PEM and live environment files stay out of Git.

Checks actually executed in the isolated checkout:

- `php artisan test`: 1,072 passed, six skipped, 11,010 assertions. The skipped cases require external services.
- `npm.cmd run test:unit`: 188 files, 2,010 tests passed, including the initial-search/menu regression. Earlier failing copy expectations were corrected and the full suite rerun.
- `npm.cmd run lint` and `npm.cmd run build`: passed. The build retains the existing large ExcelJS chunk warning.
- `php server/vendor/bin/pint --dirty --test` and `git diff --check`: passed.
- FastAPI environment Python `-m pytest -q`: 31 passed.
- Direct primary-agent security and release review: route middleware, creator/college/organization boundaries, validation contracts, active-college membership, preserved credentials, upload version/rollback behavior, and ordinary approval chains checked.

Lightsail preflight verified all seven application services, Nginx configuration, and HTTPS `/up` with certificate verification enabled. The verified pre-migration backup is `/var/backups/hiusa/hiusa_db-pre-part7-20261020T101505Z.sql.gz`: 69 tables, root owner, mode 600, gzip integrity checked. Production deployment applies only the additive migration, builds the client, refreshes Laravel caches through the native wrapper, reloads services, and compares the served revision/assets. Endpoint probes remain unauthenticated and create no records. Final deployment results are reported with the release commit.

Release `e6d73ae` was deployed successfully: the migration was recorded, organization/user counts remained 21/35, all seven services were active, strict HTTPS and the health endpoint passed, the public organization payload included boolean scope flags, and unauthenticated writes returned 401. Served HTML, JavaScript, CSS, and campus-image hashes matched the build. These probes also exposed a missing explicit HTML cache policy. The follow-up Nginx change revalidates `/index.html` while retaining the existing one-year hashed-asset cache; its procedure is in the native deployment guide.
