# Manage Colleges

**User:** SAO Super Admin

The Colleges page lists the university's colleges. Add College opens a reusable form modal; the same form edits a college's name, optional code, description, and active status. A college can be deleted only when no student organization uses its name. Renaming a college updates assigned organizations and matching user departments in one transaction.

The catalog is seeded from distinct organization college names when the migration runs. The Organizations form offers active colleges and preserves a legacy assignment when its value has not yet been added to the catalog. Existing organization API payloads remain compatible with the `college` string field.

All college endpoints require Sanctum authentication and the `SUPER_ADMIN` role. Server validation enforces unique names and codes. Deletion returns `409` for an assigned college.
