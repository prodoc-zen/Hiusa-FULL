# Part 10 registration corrections and campus branding

Current appearance: the blue palette has been restored at the user's request. Yellow primary actions and navigation have been removed; the supplied campus photo and all Part 10 workflow corrections remain. `design.md` is the current visual source of truth. The notes below record the original Part 10 release.

The product requirements come from `D:/Downloads/PART 10.docx` and its seven screenshots. The user's additional direction supplies the campus photo and a blue/yellow University of Cebu theme. Document content is treated as product requirements; repository safeguards remain in force. The user clarified that existing approved files should be reconciled, without generated demo documents.

## Changes

- SAO application approval records its copied registration documents as approved, including reviewer and time. Accreditation includes the ten organization registration/renewal requirements. Semestral reports remain separate.
- An audited reconciliation command repairs existing approved application files after matching their bytes and timestamps. It retires redundant definitions and relinks legacy aliases only when the canonical submission does not already exist. It preserves real uploads, samples, IDs, reviews, and historical records. Later replacements remain subject to review. The operation is idempotent and reports without writing by default.
- The first-Admin organization action opens the existing Add administrator form with its organization fixed. The existing-login option preserves identity and passwords.
- The review queue offers Approve and Reject for submitted documents of active organizations, including registration files needing a fresh decision. Pending registrations retain their organization review; backend role/state/version controls remain enforced.
- Active precedes Pending review. Organization lists, college organization groups, accreditation, and file folders use alphabetical ordering. The Past deadline column is removed; requirement-level deadlines remain available.
- `AuthLayout` uses the exact supplied `docs/uc-background.jpeg`, copied to `client/src/assets/uc-campus.jpeg`. Shared primary actions and selected navigation use yellow with navy text. White form panels remain opaque over the photo. `design.md` records the new palette and direction.

## Anti Slop and accessibility

Anti Slop is applied during implementation, following the user's session choice. Direction: University of Cebu blue/yellow, Poppins, compact existing layouts, ENERGY 1 / RHYTHM 1 / MOTION 1. Yellow identifies primary actions and selected navigation. Status meanings and blue focus indicators remain distinct. No new animation, decorative layout, generated image, or dependency is introduced.

Executed contrast calculations: navy `#0B1831` on yellow `#F6C445` is 10.85:1, and on hover yellow `#E9B526` is 9.34:1; the control border `#765400` against white is 6.91:1. Browser automation and subagents remain disabled by user policy; no visual browser verification is claimed.

## Checks actually executed

- `php artisan test`: 1,078 passed, six external-service cases skipped, 11,058 assertions.
- `npm.cmd run test:unit -- sao SystemOrganizationsPage SaoAgencyPage RoleBriefing SetupChecklist Sidebar Button LoginPage`: 26 files, 292 tests passed.
- A full frontend run completed with 2,008 passing tests and three old blue-button assertions failing. Those assertions were updated for yellow and their component file passed in the focused checks above; a second full run was not needed after those test corrections.
- `npm.cmd run lint`, `npm.cmd run build`, `php server/vendor/bin/pint --dirty --test`, and `git diff --check`: passed. The production build retains the existing large lazy-loaded chunk warning.
- The supplied source photo and bundled asset have identical SHA-256 `b043f0d45953e1c38bc12535ad2b210546f9a10d5ebe1b4e09ad78e5877f91f5`.
- Direct primary-agent security and release review covered role/organization boundaries, approval and stale-version controls, unchanged-file matching, idempotence, duplicate prevention, preserved samples and credentials, and separate report/accreditation contracts.

## Release procedure

Run isolated component and Laravel tests, lint, the client build, PHP formatting, and a diff/credential check. Preserve the original dirty checkout; this work is isolated in `.worktrees/part7` on the Part 10 task branch. Do not commit the project PEM, environment files, or original Word document.

Before production reconciliation, create and verify a restricted database backup. Pull the reviewed commit with `--ff-only`, run the reconciliation without `--apply`, inspect its counts, then apply it and verify the second run has no further changes. No schema migration, reseeding, password change, or uploaded-file deletion is needed. Build the client, refresh Laravel caches using the native wrapper, reload services, and verify HTTPS, health, authentication, HTML revalidation, asset hashes, and the final revision. Live probes create no users, emails, or submissions.
