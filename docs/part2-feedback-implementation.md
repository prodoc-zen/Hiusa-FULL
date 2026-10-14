# PART 2 feedback implementation

Source: `docs/fixes to add - borgueta/PART 2.pdf` supplied with the October 14, 2026 request.

- Applicants receive a private, signed tracking link in the verification email and in status emails after verification, Department Head review, SAO review, and resubmission. The link expires after 30 days. The public status page shows the current handoff, review dates, and rejection remarks without exposing school ID, email, or submitted files. An applicant who lost the link can request a new one from the home page using their original school ID, email, and organization name; the public response does not reveal whether an application matches.
- SAO approval creates an organization profile for the active Department Head of the applicant's college. The Head's college profile remains their default login and the organization profile appears in the existing profile switcher. The profile is created only for a Head who has an active college-home profile in the same college. Existing memberships are preserved.
- The idempotent `php artisan hiusa:sync-department-head-profiles` command fills in missing Head profiles for previously approved active organizations. Run it once after deployment. Assigning or reactivating a Head later also synchronizes approved organizations in that college.

The tracking API requires a signed URL and is rate limited. Only the application email receives replacement links. Profile creation and backfill use the approved application's organization and college, rather than a client-supplied organization ID.
