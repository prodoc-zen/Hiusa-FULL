# PART 5 implementation

Source: `PART 5.pdf`, supplied with the October 14, 2026 request. Changes apply to the roles identified in the document.

## Where to find the changes

| Role | Page | Behavior |
| --- | --- | --- |
| All roles | Selection fields | Shared searchable dropdown, scrollable options, keyboard controls, selected tags, and removable multiple selections. Single-choice fields keep their original contracts. |
| SAO | Files > Submitted files | Organization folders and file search within each folder. Search matches filenames, requirements, event titles, and report titles before pagination. |
| SAO | Files > Storage and limits | Searchable, paginated usage table with quota and remaining capacity. Row actions open the organization's files. Upload-limit editing has its own form. |
| SAO | Dashboard | Review inbox and organization totals, with links to work pages. Organization indicators and repeated notification/report summaries are removed. |
| SAO | Reviews > Compliance | Organization folders for compliance, event, and financial reviews, each with search. Requirement settings remain separate from review work. |
| SAO | Organization accreditation | Three-dot actions send a reminder for an unmet requirement. |
| Department Head | College compliance | College-scoped requirement progress and the same reminder action. |
| Department Head | College files | Organization folders containing only files from the Head's college. Viewing is read only. |
| Department Head | Clearance signing | Department Head signatures for students from the Head's college. |
| SAO | Clearances > View students | Student roster appears on the page, outside a dialog. Cleared lines can be reopened with a reason. |
| Organization admin/officer | Clearance signing | Organization signatures for the current organization's students. |

## Reminders and access

`POST /compliance/organizations/{organization}/reminders` accepts a requirement ID and message. Only SAO and the organization's college Department Head can use it. Inactive and approved requirements cannot be reminded through this action.

A reminder creates an approved announcement, recipient records, notifications, and an audit entry in one transaction. It reaches active organization members, including alternate account profiles, and active college Department Heads. SAO's university-announcement register also displays these reminders as read-only history. Tests exercise organization/college boundaries and exclude inactive users.

## Clearance data

New periods accept only `organization`, `department_head`, and `sao`. Each role signs its own stage. Reopening a cleared line requires a reason, clears the current signature, notifies the student, and writes `signature_reopened` to the audit log. A period with signature history cannot be deleted after reopening.

The forward migration `2026_10_14_000001_normalize_clearance_signatories.php` maps old signatory names to these stages. Original signatures are retained as retired rows; original role lists are retained on the period. Existing adviser lines require a fresh Department Head signature rather than inheriting a signature made by organization staff. Rollback restores the original role lists and rows. The migration's forward and rollback paths are tested in an isolated database.

## Design and validation

Reading this as: university administration screens for SAO and Department Heads, in the existing HIUSA visual language, ENERGY 1 / RHYTHM 1 / MOTION 1. Poppins, compact tables, restrained borders, and the existing navigation remain the foundation. Folder icons identify organization containers; action icons identify actual operations. Floating dropdowns use a shadow to separate options from the underlying form.

Reference: [Carbon dashboard guidance](https://v10.carbondesignsystem.com/data-visualization/dashboards/) for reducing repetition and directing users to detail screens. Dropdown popovers use the [Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using) where supported to escape modal clipping, with a capability fallback. The selected-tag color `#15803D` has measured white-text contrast of 5.02:1.

Validation covers API role boundaries, search/pagination, profile recipients, reminder delivery, clearance reversal, migration rollback, navigation metadata, dropdown keyboard use, and the page-based roster. Browser automation and specialist agents are disabled by the repository's temporary execution policy. No browser or mobile visual verification is claimed.

Executed locally:

- `npm run test:unit`: 181 files, 1,926 tests passed.
- `php artisan test --stop-on-failure`: 1,000 tests passed, 6 skipped, 10,154 assertions.
- `npm run lint`: passed.
- `npm run build`: passed. Vite reports the existing large ExcelJS export chunk.
- `php vendor/bin/pint --dirty --test`: passed.
- `git diff --check`: passed.

Primary-agent security and release review checked server role enforcement, college and organization isolation, alternate-profile recipients, read-only reminder history, state transitions, migration preservation, and API/client alignment. No specialist agents or browser automation were invoked.
