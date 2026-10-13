# Overall feedback implementation

Source: the six-page `OVERALL (1).pdf` supplied with the October 13, 2026 request.

## Public onboarding

`/` introduces HIUSA and offers **Register an organization** and **Log in**. `/register-organization` collects organization name, code, college, description, and the applicant's name, school ID, email, and position. Registration belongs to the organization; department heads review applications rather than submitting them.

`POST /api/organization-applications` sends a signed verification link that expires after 48 hours. Verification changes the application from `pending_verification` to `pending_endorsement`. Expired unverified applications can be submitted again. Department heads see only their college's verified applications at `GET /api/organization-applications` and may endorse or reject through `PATCH /api/organization-applications/{application}/review`. Rejection requires remarks. Endorsement notifies SAO and changes the status to `endorsed`.

SAO can approve or reject only endorsed applications. Approval atomically creates the organization, its admin position, and the applicant's first administrator account or an additional admin profile for an existing verified account. Existing credentials and profiles are preserved. New accounts receive a secure password setup email; passwords are never included in API responses. The applicant receives decision emails. A mail delivery failure after a saved decision is disclosed to the reviewer; account recovery can issue a fresh setup link. SAO's standalone admin creation and handover APIs return `403`. Only organization administrators can appoint additional administrators through the organization user or membership APIs.

## SAO and records

- The Study Objectives page and SAO Administrators unit are removed from accessible navigation. Old URLs redirect to the appropriate dashboard or organization register.
- The redundant SAO attention headline and organization filter are removed. University operation counts appear horizontally below the greeting, with bordered, padded organization health rows and ten organizations per page. The detached member-count block is absent from this checkout, as is the redundant Agency Review unit.
- Compliance organization names open a complete requirement checklist, including **Not submitted**, approved, returned, and awaiting-review documents. Review actions continue to scope the queue to the selected organization. Organization compliance progress uses the available header width.
- College deletion has a confirmation and optional transfer destination. Deletion without transfer deactivates the college's organizations and account profiles and revokes affected sessions. Transfer retains account and organization statuses and changes college assignments. College records are soft deleted so application history remains intact.
- Official SAO notices accept JPEG, PNG, and WebP photos up to 5 MB, display previews, and retain existing nested audience fields during multipart create/update requests.
- SAO booking requests offer a venue schedule preview for the requested dates, also visible during approval. Failed calendar requests show a retryable error. Server conflict enforcement remains authoritative.
- Order approval replaces the details overlay. Inventory deletion removes the product from the catalog while retaining completed order history; pending or paid orders still block deletion. The claim desk's **All claim tokens** option applies a combined paid/claimed filter before server pagination.
- Clearance checkboxes precede student names. Status and remarks have dedicated columns. Clear and Hold are vertically arranged with different icons and colors; reasons appear once in the queue.
- Grievance reviewers have visible detail controls and existing review/resolve/dismiss decisions. Closed grievances may be deleted from the review register after confirmation. Open cases must first receive a decision with remarks. Deletion is scoped and preserves evidence and the student's access to their own record.

## Design and validation

Design follows `design.md`: HIUSA's existing logo, Poppins, navy structure, blue actions, subtle borders, compact tables, visible labels, and responsive stacks. The landing page uses navy to anchor the introduction; icons identify actual member, calendar, and record capabilities. Design dials: energy 2, rhythm 2, motion 1. No new image assets or fabricated metrics were introduced.

Laravel tests use SQLite in memory, fake storage, fake mail or the array mailer, and disabled external AI integrations. React validation uses Vitest and Testing Library. No live browser automation, Playwright, or subagents are used, per the repository's temporary policy. Browser visual validation remains unperformed. FastAPI contracts are unchanged.

Deployment requires the four new forward migrations and the existing production mail configuration. Do not use fresh migrations or reset real data.
