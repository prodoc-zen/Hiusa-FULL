# Manage Colleges

**User:** SAO Super Admin

The SAO Colleges page lists the university's colleges and lets SAO add one with a name, optional code, and description. Creating a college also creates its empty home organization so a Department Head can be assigned. A college with organizations, users, or account profiles can be deleted only after selecting an active replacement college with a home organization and no assigned organizations or users. SAO can create a new college as that replacement. The transfer moves the student organizations, their parent relationship, Department Head accounts and profiles, and user departments in one transaction. Affected sessions are revoked, while accounts remain active. An empty college can be deleted without a replacement. College records are soft deleted to preserve historical applications.

SAO can assign a Department Head with a new account or by School ID of an active student or officer in the same college. Existing members keep their password and organization profile; a separate college profile becomes the default after their sessions are revoked. A newly created Department Head needs no student-organization membership to access the college dashboard. Organization Admins may add a same-college Department Head to their student organization as a separate membership profile without changing the college role.

The catalog is seeded from distinct organization college names when the migration runs. The Organizations form offers active colleges and preserves a legacy assignment when its value has not yet been added to the catalog. Existing organization API payloads remain compatible with the `college` string field.

All college endpoints require Sanctum authentication and the `SUPER_ADMIN` role. `POST /api/system/colleges` validates unique names and codes and returns `201`. `DELETE /api/system/colleges/{college}` accepts `transfer_to_college_id`, requiring it for a populated college and rejecting the source, inactive/deleted destinations, and destinations that are not empty. Successful deletion returns `204`.
