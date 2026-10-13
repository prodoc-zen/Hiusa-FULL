# Manage Colleges

**User:** SAO Super Admin

The Colleges page lists the university's colleges. Add College opens a reusable form modal; the same form edits a college's name, optional code, description, and active status. Deletion offers an optional transfer to another active college. Without a transfer, assigned organizations and accounts become inactive and affected sessions are revoked. College records are soft deleted to preserve historical applications. Renaming a college updates assigned organizations and matching user departments in one transaction.

The catalog is seeded from distinct organization college names when the migration runs. The Organizations form offers active colleges and preserves a legacy assignment when its value has not yet been added to the catalog. Existing organization API payloads remain compatible with the `college` string field.

All college endpoints require Sanctum authentication and the `SUPER_ADMIN` role. Server validation enforces unique names and codes. `DELETE /api/system/colleges/{college}` accepts optional `transfer_to_college_id`, rejecting the deleted college itself or an inactive/deleted destination. Successful deletion returns `204`.
