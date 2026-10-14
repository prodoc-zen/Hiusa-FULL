# Part 6 implementation

Source: `docs/fixes to add - borgueta/PART 6.pdf`, pages 1–2. Applies to all roles for filters and record actions; SAO configures requirements and organization Admins submit semestral reports.

## Requirements and submissions

- SAO: **Reviews → Requirement settings → Semestral report requirements**. Configure names, descriptions, deadlines, accepted file types and either an uploaded sample or a sample link. Organization registration/accreditation and event requirements retain their separate settings tabs.
- Organization Admin: **Compliance → Semestral report**. The table includes missing, submitted, returned and approved requirements. Its three-dot menu opens samples and submitted files, uploads a missing document or replaces a returned document. SAO decisions and remarks use the existing compliance review queue.
- Requirement category is stored independently of the name. Renaming a semestral requirement keeps its category. The forward migration classifies the existing Semestral Accomplishment Report and preserves its submissions, samples and review records. Newly seeded semesters assign the same category automatically.
- Public registration and Department Head registration checklists exclude semestral requirements, including custom names. Sample access follows the same boundary.
- The accreditation tab is named **Organization accreditation**.

## Filters and actions

- Shared dropdown selection uses navy text on the HIUSA light-blue surface. Green remains a workflow status color.
- Filtering dropdowns accept several options, allow individual removal, stay open while choosing and retain search, keyboard navigation, Escape and focus restoration. Single record fields, sorting, pagination size and one-record workspaces retain their single-value meaning.
- Multiple values within a filter use OR; different filters use AND. The API preserves scalar parameters and also accepts a JSON-encoded array in a filter parameter, for example `status=["submitted","under_review"]`. Every element is validated with the original field rules; duplicate selections and more than 100 values are rejected. Filtering runs before pagination and totals. Organization and college scopes remain mandatory.
- Filter consumers cover user directories, organization applications, approvals, grievances, announcements, events and attendance, tasks, elections, ledger entries, financial accounts, collections, advances, reports, merchandise/orders, clearances, venue bookings and submitted-file repositories. Program/year/section option dependencies and active-filter labels understand multiple selections.
- Semester filters support several periods. A ledger query selects each semester's date interval separately, excluding gaps between non-adjacent semesters. Mixed historical event, task and election views remain read only.
- Record actions use the shared three-dot menu, including grievance details, academic years and semesters, venue reviews, cash advances, election/candidate/partylist records, inventory, budget/forecast/report cards and supporting files. Form confirmations and page-level navigation or creation controls remain visible.
- Action popups remain inside dialog focus boundaries, use the browser top layer when supported, and restore focus when closed. Escape closes the menu without closing its parent dialog.

## Design and verification

Anti Slop applied during implementation. Direction: HIUSA compact administration for students, organization staff, Department Heads and SAO; Poppins, existing blue/navy palette and subtle borders. ENERGY 1 / RHYTHM 2 / MOTION 1. Tables and requirement names are the focal content; contextual actions share one position and control.

- Hard gate: no new decorative assets, fabricated claims or navigation; selection/search/removal and dialog menus have deterministic interaction coverage. Controls wrap on narrow layouts and retain existing table overflow containers. New selection text contrast is 11.98:1; the check indicator is 4.79:1.
- Purpose gate: blue identifies selection; status colors retain their existing meaning. Popup elevation separates controls from the table. Existing product typography and spacing are preserved.
- Liveliness: compact tables, grouped settings and consistent row actions retain HIUSA's administration layout and hierarchy.
- Craftsmanship: explicit loading, errors, empty states, private file access, file validation and returned-submission feedback use existing components. Regression tests cover delayed category responses as well as file replacement and role boundaries.
- Browser automation and live browser QA were not performed, as required by the repository's temporary execution policy. Responsive appearance is checked through source/layout review; no browser screenshot validation is claimed.

The primary agent performs deterministic validation, authorization review and release review directly. FastAPI engines are unchanged.

## Checks executed

- `npm run test:unit`: 181 files, 1,931 tests passed. After the final shared-control spacing adjustment, both shared-control suites passed again (15 tests).
- `php artisan test --stop-on-failure`: 1,008 passed, 6 skipped, 10,238 assertions. Includes migration rollback/backfill, samples, returned-file previews and replacement, invalid categories, role denial, mixed organization scope, multi-filter totals and disjoint semester intervals.
- `npm run lint`, `npm run build`, `php vendor/bin/pint --dirty --test` and `git diff --check`: passed. The existing large ExcelJS export chunk warning remains.
- Authorization review: read filters remain inside existing organization/college predicates; write and private-file role/ownership checks remain in force. No credentials or environment files changed.
- Release review: migration is forward-only, old requirement IDs and submissions are preserved, scalar API filters remain compatible, and frontend consumers use the corresponding multi-value server contract. Primary-agent review found no remaining blocker.

Anti Slop delivery checks: hard gate PASS for the changed controls under deterministic validation; purpose gate PASS (brand selection colors, popup elevation and fixed typography); liveliness PASS (declared dials and existing table hierarchy); craftsmanship PASS (states, keyboard interactions, focus boundaries and real API behavior tested). The browser click-through portion is overridden by the user's explicit temporary policy, as recorded above; it is not reported as performed.
