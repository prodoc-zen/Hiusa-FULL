# Manage Colleges

**User:** SAO Super Admin

The SAO Colleges page lists the university's colleges and lets SAO add one with a name, optional code, and description. Creating a college also creates its empty home organization so a Department Head can be assigned. A college with organizations, users, or account profiles can be deleted only after selecting an active replacement college with a home organization and no assigned organizations or users. SAO can create a new college as that replacement. The transfer moves the student organizations, their parent relationship, Department Head accounts and profiles, and user departments in one transaction. Affected sessions are revoked, while accounts remain active. An empty college can be deleted without a replacement. College records are soft deleted to preserve historical applications.

SAO can assign a Department Head with a new account or by School ID of an active student or officer in the same college. Existing members keep their password and organization profile; a separate college profile becomes the default after their sessions are revoked. A newly created Department Head needs no student-organization membership to access the college dashboard. Organization Admins may add a same-college Department Head to their student organization as a separate membership profile without changing the college role.

The catalog is seeded from distinct organization college names when the migration runs. The Organizations form offers active colleges and preserves a legacy assignment when its value has not yet been added to the catalog. Existing organization API payloads remain compatible with the `college` string field.

## Registration and renewal corrections in Part 10

SAO application approval marks its copied registration documents approved in the same transaction, with the SAO reviewer and approval time. These documents count toward accreditation immediately. Replacement uploads still return to review. Active organizations' submitted documents have Approve and Reject actions; rejection requires remarks and allows correction/resubmission. Pending registrations continue through the organization review.

Registration and renewal use the ten names in `RegistrationRequirementCatalog::NAMES`. Accreditation defaults to organization requirements; semestral accomplishment reports retain their separate status and submission workflow. Active duplicate names, including known legacy aliases, cannot be created or reactivated in the same period. Publishing still requires an SAO-supplied sample format.

Organization lists use alphabetical order, and Active appears before Pending review. The accreditation table omits the Past deadline column while keeping deadlines in each organization's requirement details.

The audited `hiusa:reconcile-registration-requirements` command is read-only unless `--apply` is supplied. It retires redundant current requirement definitions, links existing alias submissions to their canonical requirement when no submission already exists, and preserves file paths, submission IDs, reviews, samples, and historical definitions. Original application approvals are restored only for unchanged files whose bytes and submission time match the recorded approved application. Missing files and subsequent replacements require review; the command never creates uploads or manufactures approvals. Back up production before applying it.

## Unified organizations and college oversight

SAO may create a student organization open to all colleges through `POST /system/unified-organizations` using `name`, `acronym`, and an optional description. The server fixes `is_university_wide=true`, an active lifecycle, and null college/parent fields, and audits creation. A new forward migration adds the flag with `false` as the default for every existing organization. Rolling it back removes only the flag and preserves organization records. Ordinary organization parent assignments must retain the same college and university-wide scope.

University-wide organizations remain outside Department Head college scopes. SAO receives their budget, event, election, and financial-report approvals; college organizations retain their current approval chain. Event requirements must be complete before a university-wide event enters SAO review. Organization approvals are available under SAO Reviews, with the same ownership, required-role, state, self-review, and historical-semester protections as existing requests.

Department Heads can replace or delete compliance/registration uploads belonging to active organizations in their own active college from College files. Replacements honor the requirement's file types, active semester, and storage quota, clear prior review decisions, and return the upload to SAO review. Pending registrations and archived organizations remain protected. Stale versions are rejected, including repeated requests within one second. Database changes, notifications, audit entries, and cleanup journal entries share a transaction; superseded files are removed after commit, with failed cleanup retried by the existing journal. Event proposal files and financial records retain their own approval workflows. College files defaults to ten rows and always exposes page-size controls, including on a single page.

All college endpoints require Sanctum authentication and the `SUPER_ADMIN` role. `POST /api/system/colleges` validates unique names and codes and returns `201`. `DELETE /api/system/colleges/{college}` accepts `transfer_to_college_id`, requiring it for a populated college and rejecting the source, inactive/deleted destinations, and destinations that are not empty. Successful deletion returns `204`.

## Archive and permanent removal (Part 7)

College record actions use the shared three-dot menu. The existing transfer deletion remains available as **Delete college and transfer users**. **Delete with all data** is a separate, irreversible choice that requires the exact college name. Its DELETE payload is `{ "mode": "permanent", "confirmation_name": "College name" }`; combining permanent removal with a replacement college is rejected.

Permanent removal deletes the college, its home and student organizations, organization-owned operational records, application documents, and uploads. Membership profiles are removed. An identity with another organization profile is retained and, when necessary, that profile becomes its primary profile. Identities without another profile are deleted. SAO accounts, university-wide requirement settings, and other organizations' records are protected. External records that would be removed through a user cascade block the operation with `409`, requiring reassignment or a surviving profile first. A parent organization with surviving suborganizations also returns `409`.

`POST /api/system/colleges/{college}/archive` disables college access without changing individual organization or account statuses. Affected Sanctum sessions are revoked. Password login, authenticated requests, and profile switching enforce the college status, including legacy organization assignments by college name. SAO retains read access to organization submissions and files. `POST /api/system/colleges/{college}/restore` restores access for previously active profiles; separately archived organizations stay archived. Repeating either state transition returns `409`.

Permanent organization deletion is SAO-only: `DELETE /api/system/organizations/{organization}` requires `confirmation_name` and returns `204`. It uses the same identity, ownership, file, and audit protections. SAO college and organization deletion never targets the system administration department.

Database changes are transactional. Physical file removal happens only after commit. Shared files still referenced by surviving records are retained. Failed cleanup remains in `pending_file_deletions` and is retried hourly by the Laravel scheduler. The new migration adds only that cleanup journal and does not alter existing college data.
