# PART 1 feedback implementation

Source: `docs/fixes to add - borgueta/PART 1.pdf` supplied with the October 14, 2026 request.

- Authenticated bearer tokens expire four hours after issuance. The client schedules signout at the same deadline, rechecks on tab visibility, and sends the user to the landing page with a session-expired notice.
- Department Head setup and empty dashboard states point to the college's application review queue. New organizations register from the public home page, verify the applicant's email, then await the Department Head's endorsement before SAO review. The Department Head can inspect the submitted requirement files.
- Rejection emails include a signed private edit link valid for 14 days. The applicant sees the review remarks, can view each existing file, replace selected files, and revise application details without changing the verified school ID or email. Resubmission checks current SAO requirements, keeps unchanged files, clears the rejection, and returns the application to the Department Head queue. The link stops working after resubmission.
- Applicants with older rejection emails or expired links can request a new edit link using their school ID, verified email, and organization name. The public response does not disclose whether an application matches; the link is sent only to the verified address.

The edit link grants access only to its rejected application. Department Head review and file access require an active Department Head in the college's home organization and the matching college. Existing organization profile boundaries remain in place.
