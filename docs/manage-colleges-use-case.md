# Manage Colleges

**User:** SAO Super Admin

The SAO Colleges page lists the university's colleges and lets SAO add one with a name, optional code, and description. Creating a college also creates its empty home organization so a Department Head can be assigned. A college with organizations, users, or account profiles can be deleted only after selecting an active replacement college with a home organization and no assigned organizations or users. SAO can create a new college as that replacement. The transfer moves the student organizations, their parent relationship, Department Head accounts and profiles, and user departments in one transaction. Affected sessions are revoked, while accounts remain active. An empty college can be deleted without a replacement. College records are soft deleted to preserve historical applications.

SAO can assign a Department Head with a new account or by School ID of an active student or officer in the same college. Existing members keep their password and organization profile; a separate college profile becomes the default after their sessions are revoked. A newly created Department Head needs no student-organization membership to access the college dashboard. Organization Admins may add a same-college Department Head to their student organization as a separate membership profile without changing the college role.

The catalog is seeded from distinct organization college names when the migration runs. The Organizations form offers active colleges and preserves a legacy assignment when its value has not yet been added to the catalog. Existing organization API payloads remain compatible with the `college` string field.

All college endpoints require Sanctum authentication and the `SUPER_ADMIN` role. `POST /api/system/colleges` validates unique names and codes and returns `201`. `DELETE /api/system/colleges/{college}` accepts `transfer_to_college_id`, requiring it for a populated college and rejecting the source, inactive/deleted destinations, and destinations that are not empty. Successful deletion returns `204`.

## Archive and permanent removal (Part 7)

College record actions use the shared three-dot menu. The existing transfer deletion remains available as **Delete college and transfer users**. **Delete with all data** is a separate, irreversible choice that requires the exact college name. Its DELETE payload is `{ "mode": "permanent", "confirmation_name": "College name" }`; combining permanent removal with a replacement college is rejected.

Permanent removal deletes the college, its home and student organizations, organization-owned operational records, application documents, and uploads. Membership profiles are removed. An identity with another organization profile is retained and, when necessary, that profile becomes its primary profile. Identities without another profile are deleted. SAO accounts, university-wide requirement settings, and other organizations' records are protected. External records that would be removed through a user cascade block the operation with `409`, requiring reassignment or a surviving profile first. A parent organization with surviving suborganizations also returns `409`.

`POST /api/system/colleges/{college}/archive` disables college access without changing individual organization or account statuses. Affected Sanctum sessions are revoked. Password login, authenticated requests, and profile switching enforce the college status, including legacy organization assignments by college name. SAO retains read access to organization submissions and files. `POST /api/system/colleges/{college}/restore` restores access for previously active profiles; separately archived organizations stay archived. Repeating either state transition returns `409`.

Permanent organization deletion is SAO-only: `DELETE /api/system/organizations/{organization}` requires `confirmation_name` and returns `204`. It uses the same identity, ownership, file, and audit protections. SAO college and organization deletion never targets the system administration department.

Database changes are transactional. Physical file removal happens only after commit. Shared files still referenced by surviving records are retained. Failed cleanup remains in `pending_file_deletions` and is retried hourly by the Laravel scheduler. The new migration adds only that cleanup journal and does not alter existing college data.
