<?php

namespace App\Services\Ai;

use Illuminate\Support\Str;

/**
 * Procedural knowledge base for Ask AI "how do I ..." questions.
 *
 * Each guide is a role-tagged, step-by-step procedure. Steps carry the client
 * path of the page where the step happens; AskAiService resolves every path
 * through ClientRouteAccess so a role is never handed a link it cannot open.
 *
 * Retrieval is lexical + fuzzy (BM25-style IDF weighting over title, keywords
 * and step text, keyword-phrase boosts, and character-trigram similarity), so
 * free-form wording such as "how do we open a new school year" still lands on
 * the academic-year guide without a fixed list of prepared questions.
 */
class HowToGuideLibrary
{
    private const STOPWORDS = [
        'how', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'to', 'the', 'a', 'an',
        'i', 'we', 'you', 'me', 'my', 'our', 'us', 'is', 'are', 'be', 'it', 'its', 'of', 'for', 'in',
        'on', 'at', 'and', 'or', 'with', 'what', 'where', 'which', 'when', 'who', 'why', 'steps', 'step',
        'guide', 'process', 'procedure', 'walk', 'through', 'show', 'teach', 'tell', 'please', 'need',
        'want', 'way', 'there', 'this', 'that', 'by', 'from', 'into', 'as', 'about', 'tutorial',
        'instruction', 'instructions', 'hiusa', 'system', 'page', 'here', 'go', 'get', 'some', 'any',
        'wanna', 'gonna', 'like', 'let', 'lets', 'help', 'pls', 'kindly', 'hey', 'hello', 'hi', 'ok', 'okay', 'bro', 'sir', 'up',
        'gusto', 'nais', 'ko', 'kong', 'mag', 'ng', 'na', 'po', 'ba', 'pwede', 'puwede', 'paano', 'namin', 'naming',
        'ako', 'akong', 'kami', 'kaming', 'mo', 'para', 'sa', 'ang', 'mga', 'paki', 'kailangan', 'naman', 'lang',
    ];

    public const ROLE_NAMES = [
        'SUPER_ADMIN' => 'SAO (Super Admin)',
        'DEPARTMENT_HEAD' => 'Department Head / Dean',
        'ADMIN' => 'Organization Admin',
        'SBO_OFFICER' => 'SBO Officer',
        'STUDENT' => 'Student',
    ];

    private const ALL_ROLES = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'];

    /**
     * @return array<int, array<string, mixed>>
     */
    public function all(): array
    {
        return [
            // ---------------------------------------------------------------
            // SAO / SUPER_ADMIN
            // ---------------------------------------------------------------
            [
                'id' => 'create-academic-year',
                'category' => 'Academic setup',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Create an academic year and activate a semester',
                'question' => 'How do I create an academic year and activate a semester?',
                'summary' => 'The SAO opens the school year first. Activating a semester unlocks registrations, requirements, events, budgets, and elections for that term.',
                'keywords' => ['academic year', 'school year', 'semester', 'term', 'activate semester', 'open semester', 'new year', 'sy', 'ay', 'first semester', 'second semester', 'close semester'],
                'checks' => [],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open Academic years', 'detail' => 'In the sidebar, open Setup and records → Academic years.', 'path' => '/dashboard/super-admin/academic-years', 'where' => 'Setup and records → Academic years'],
                    ['title' => 'Click "Add academic year"', 'detail' => 'Enter the start and end dates. The label (for example 2026-2027) is suggested from the dates. Save it.', 'path' => '/dashboard/super-admin/academic-years', 'where' => 'Academic years'],
                    ['title' => 'Click "Add semester" on the new year', 'detail' => 'Choose 1st Semester, set its start and end dates, then save.', 'path' => '/dashboard/super-admin/academic-years', 'where' => 'Academic years'],
                    ['title' => 'Activate the semester', 'detail' => 'Click Activate next to the semester. It becomes the current term shown in the top bar, and the default requirement checklist for the term is created.', 'path' => '/dashboard/super-admin/academic-years', 'where' => 'Academic years'],
                ],
                'tips' => ['Only one semester can be active at a time.', 'Close a semester when the term ends. Its records become read-only history.'],
            ],
            [
                'id' => 'publish-requirements',
                'category' => 'Accreditation & compliance',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Publish accreditation requirements with sample formats',
                'question' => 'How do I publish requirements and upload sample formats?',
                'summary' => 'Requirements are the documents every organization must submit for the active semester. Attaching a sample format shows applicants exactly what file to prepare.',
                'keywords' => ['requirement', 'requirements', 'sample format', 'template', 'accreditation', 'checklist', 'compliance settings', 'letter of intent', 'constitution', 'by-laws', 'deadline'],
                'checks' => ['active_semester'],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open Compliance', 'detail' => 'In the sidebar, open Reviews → Compliance.', 'path' => '/dashboard/super-admin/compliance', 'where' => 'Reviews → Compliance'],
                    ['title' => 'Go to the requirement settings tab', 'detail' => 'This lists every requirement for the active semester.', 'path' => '/dashboard/super-admin/compliance', 'where' => 'Compliance → Requirement settings'],
                    ['title' => 'Edit a requirement', 'detail' => 'Set its deadline, upload the sample format (PDF) or paste a template link, and turn it Active.', 'path' => '/dashboard/super-admin/compliance', 'where' => 'Compliance → Requirement settings'],
                    ['title' => 'Save', 'detail' => 'Active requirements now appear on the organization application form and on each organization\'s Compliance page.', 'path' => '/dashboard/super-admin/compliance', 'where' => 'Compliance'],
                ],
                'tips' => ['Requirements belong to a semester. Activate a semester first.'],
            ],
            [
                'id' => 'sao-invite-dean',
                'category' => 'Academic setup',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Invite a Department Head (Dean) with a link',
                'question' => 'How do I invite a dean?',
                'summary' => 'Each college has one Department Head (Dean), who gets an invitation link and fills in their own name, email and password.',
                'keywords' => ['college', 'dean', 'department head', 'assign dean', 'invite dean', 'invitation', 'invite department head', 'magic link', 'onboarding link'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Colleges', 'detail' => 'In the sidebar, open Governance → Colleges.', 'path' => '/dashboard/super-admin/colleges', 'where' => 'Governance → Colleges'],
                    ['title' => 'Click "Invite Department Head"', 'detail' => 'Use the button at the top, or the one on the college card. Choose the college.', 'path' => '/dashboard/super-admin/colleges', 'where' => 'Colleges'],
                    ['title' => 'Create the link', 'detail' => 'You can type an email to send the link to. It is optional. You do not type the dean\'s name, school ID or password.', 'path' => '/dashboard/super-admin/colleges', 'where' => 'Invite Department Head'],
                    ['title' => 'Copy and send it', 'detail' => 'Copy the link and send it to the dean by chat or SMS. The dean opens it and makes their own account.', 'path' => '/dashboard/super-admin/colleges', 'where' => 'Link ready'],
                ],
                'tips' => ['The link works once and expires in 48 hours. Make a new link if it expires.', 'Colleges start from a seeded list. You can add a college, delete one that has no organizations or people, or archive one that does.'],
            ],
            [
                'id' => 'sao-manage-colleges',
                'category' => 'Academic setup',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Add, archive or delete a college',
                'question' => 'How do I add or delete a college?',
                'summary' => 'Colleges start from a seeded list. The SAO can add a college, delete one that is empty, or archive one that has organizations or people.',
                'keywords' => ['add college', 'new college', 'create college', 'delete college', 'remove college', 'archive college', 'restore college', 'college list', 'colleges'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Colleges', 'detail' => 'In the sidebar, open Governance → Colleges.', 'path' => '/dashboard/super-admin/colleges', 'where' => 'Governance → Colleges'],
                    ['title' => 'Add a college', 'detail' => 'Click "Add college", enter its name and code, and save. The college gets its own home organization.', 'path' => '/dashboard/super-admin/colleges', 'where' => 'Colleges → Add college'],
                    ['title' => 'Delete an empty college', 'detail' => 'Open the menu on a college that has no organizations or people and choose Delete college. This cannot be undone.', 'path' => '/dashboard/super-admin/colleges', 'where' => 'Colleges → college menu'],
                    ['title' => 'Archive or restore a college', 'detail' => 'For a college that has organizations or people, choose Archive college instead. Its profiles cannot sign in until you restore it.', 'path' => '/dashboard/super-admin/colleges', 'where' => 'Colleges → college menu'],
                ],
                'tips' => ['A college with organizations or people cannot be deleted. Archive it.', 'Invite its Department Head with the invitation link once the college exists.'],
            ],
            [
                'id' => 'advance-planning-periods',
                'category' => 'Academic setup',
                'roles' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'],
                'title' => 'Switch academic periods for advance planning',
                'question' => 'How do I switch academic periods for advance planning?',
                'summary' => 'Deans, Admins, and SAO can preview upcoming semesters to prepare budgets, proposals, and schedules before the term starts.',
                'keywords' => ['academic period', 'advance planning', 'upcoming semester', 'planning mode', 'switch period', 'school year', 'upcoming term', 'prepare in advance'],
                'checks' => [],
                'minutes' => 1,
                'steps' => [
                    ['title' => 'Click the Academic Period pill in the TopBar', 'detail' => 'In the top bar, click the current academic year/semester dropdown pill.', 'path' => null, 'where' => 'Top navigation bar'],
                    ['title' => 'Select an upcoming semester', 'detail' => 'Choose any upcoming period marked "Advance Planning".', 'path' => null, 'where' => 'Academic Period Dropdown'],
                    ['title' => 'Prepare proposals and budgets', 'detail' => 'An amber planning banner appears. Prepare event proposals, draft budgets, or review term guidelines in advance.', 'path' => null, 'where' => 'Planning mode'],
                    ['title' => 'Return to Live Semester', 'detail' => 'Click "Return to Live Semester" in the banner anytime to resume active university operations.', 'path' => null, 'where' => 'Advance Planning Banner'],
                ],
                'tips' => ['Upcoming semesters are only visible to authorized leaders and staff, protecting students from unreleased terms.'],
            ],

            [
                'id' => 'sao-create-organization',
                'category' => 'Organizations',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Create an organization directly as SAO',
                'question' => 'How do I create an organization as SAO?',
                'action' => 'create an organization directly',
                'summary' => 'The SAO can create university-wide (unified) organizations directly, without going through an application.',
                'keywords' => ['create organization', 'add organization', 'new organization', 'unified organization', 'university-wide', 'student government', 'make an org', 'new org', 'create org'],
                'checks' => ['active_semester'],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Registrations and organizations', 'detail' => 'In the sidebar, open Governance → Registrations and organizations.', 'path' => '/dashboard/super-admin/organizations', 'where' => 'Governance → Registrations and organizations'],
                    ['title' => 'Click "Add unified organization"', 'detail' => 'Enter the organization name, acronym, and description.', 'path' => '/dashboard/super-admin/organizations', 'where' => 'Registrations and organizations'],
                    ['title' => 'Create it', 'detail' => 'The organization is listed as Active and shows "Awaiting administrator" until you name its Admin. A university-wide organization has no dean, so you name it.', 'path' => '/dashboard/super-admin/organizations', 'where' => 'Registrations and organizations → Active'],
                    ['title' => 'Name its Admin', 'detail' => 'Follow the "create an admin for a university-wide organization" guide to give the organization its President account.', 'path' => '/dashboard/super-admin/organizations', 'where' => 'Registrations and organizations'],
                ],
                'tips' => ['College organizations start when the Dean allows a student to apply.'],
            ],
            [
                'id' => 'sao-review-registration',
                'category' => 'Organizations',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Review and approve an organization registration',
                'question' => 'How do I approve an organization registration?',
                'summary' => 'Applications the Dean endorsed wait for final SAO approval.',
                'keywords' => ['approve organization', 'approve registration', 'pending registration', 'review registration', 'organization application', 'endorsed application', 'return registration', 'reject organization', 'accredit'],
                'checks' => ['applications_waiting'],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Registrations and organizations', 'detail' => 'In the sidebar, open Governance → Registrations and organizations. The Pending review tab opens first.', 'path' => '/dashboard/super-admin/organizations?status=pending', 'where' => 'Governance → Registrations and organizations'],
                    ['title' => 'Open the registration', 'detail' => 'Check the details and open each uploaded requirement file.', 'path' => '/dashboard/super-admin/organizations?status=pending', 'where' => 'Pending review'],
                    ['title' => 'Approve or Return', 'detail' => 'Approve activates the organization. Return sends it back with your remarks so the applicant can fix it.', 'path' => '/dashboard/super-admin/organizations?status=pending', 'where' => 'Pending review'],
                    ['title' => 'Review endorsed applications', 'detail' => 'Endorsed applications are under Governance → Applications. Mark each requirement OK, missing or needs changes, attach files if you need to, then approve or return it. Approving creates the organization and gives the applicant an Admin profile.', 'path' => '/dashboard/organization-applications', 'where' => 'Governance → Organization applications'],
                ],
                'tips' => ['Approve stays unavailable until the required files are complete.'],
            ],
            [
                'id' => 'sao-create-admin',
                'category' => 'Organizations',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Name the administrator of a university-wide organization',
                'question' => 'How do I create an admin for a university-wide organization?',
                'summary' => 'A university-wide organization has no dean, so the SAO names its Admin (usually the President). For a college organization the Department Head does this with Give access.',
                'keywords' => ['create admin', 'add admin', 'administrator', 'president account', 'awaiting administrator', 'org admin', 'handover', 'assign president'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Registrations and organizations', 'detail' => 'Switch to the Active tab.', 'path' => '/dashboard/super-admin/organizations', 'where' => 'Governance → Registrations and organizations → Active'],
                    ['title' => 'Find the university-wide organization marked "Awaiting administrator"', 'detail' => 'Open its actions menu and choose "Add administrator".', 'path' => '/dashboard/super-admin/organizations', 'where' => 'Active organizations'],
                    ['title' => 'Pick the President', 'detail' => 'Type the student\'s name or email and pick them from the list. You never type a school ID. A student without an account signs up first from the sign-up page.', 'path' => '/dashboard/super-admin/organizations', 'where' => 'Add administrator'],
                    ['title' => 'Save', 'detail' => 'They keep their own password and sign in with their email. No temporary password is created.', 'path' => null, 'where' => 'Login page'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'sao-review-compliance',
                'category' => 'Accreditation & compliance',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Review submitted compliance files',
                'question' => 'How do I review compliance submissions?',
                'summary' => 'Organizations upload their requirement files. SAO approves each one or returns it with remarks.',
                'keywords' => ['review compliance', 'compliance submission', 'approve document', 'return document', 'submitted files', 'accreditation review', 'audit files'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Compliance', 'detail' => 'In the sidebar, open Reviews → Compliance, then open the review tab.', 'path' => '/dashboard/super-admin/compliance?tab=review', 'where' => 'Reviews → Compliance'],
                    ['title' => 'Open a submission', 'detail' => 'Preview the uploaded file and compare it with the sample format.', 'path' => '/dashboard/super-admin/compliance?tab=review', 'where' => 'Compliance → Review'],
                    ['title' => 'Approve or return it', 'detail' => 'Returning needs remarks. The organization is notified and can upload a corrected file.', 'path' => '/dashboard/super-admin/compliance?tab=review', 'where' => 'Compliance → Review'],
                ],
                'tips' => ['Ask AI: "Which organizations haven\'t submitted requirements?" lists who is still missing files.'],
            ],
            [
                'id' => 'sao-final-approvals',
                'category' => 'Approvals',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Give final approval to budgets, events, and financial reports',
                'question' => 'How do I give final approval to requests?',
                'action' => 'give final approval to budgets, events and financial reports',
                'summary' => 'Requests that the Department Head has signed come to SAO for the final decision.',
                'keywords' => ['final approval', 'approve budget', 'approve event', 'approve financial report', 'organization approvals', 'sign-off', 'approval queue'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Organization approvals', 'detail' => 'In the sidebar, open Reviews → Organization approvals.', 'path' => '/dashboard/super-admin/organization-approvals', 'where' => 'Reviews → Organization approvals'],
                    ['title' => 'Open a request', 'detail' => 'Check the amounts, attached files, and the Dean\'s remarks.', 'path' => '/dashboard/super-admin/organization-approvals', 'where' => 'Organization approvals'],
                    ['title' => 'Approve or reject with remarks', 'detail' => 'The organization is notified right away and the request status updates across the system.', 'path' => '/dashboard/super-admin/organization-approvals', 'where' => 'Organization approvals'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'sao-venues',
                'category' => 'Venues',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Add campus venues and approve venue bookings',
                'question' => 'How do I manage venues and approve bookings?',
                'summary' => 'SAO keeps the list of campus venues and approves booking requests. Overlapping approved bookings are blocked.',
                'keywords' => ['venue', 'venues', 'room', 'auditorium', 'gym', 'hall', 'booking', 'reserve', 'approve booking', 'new venue'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Venues', 'detail' => 'In the sidebar, open Reviews → Venues.', 'path' => '/dashboard/super-admin/venues', 'where' => 'Reviews → Venues'],
                    ['title' => 'Click "New venue"', 'detail' => 'Enter the name, location, capacity, and description.', 'path' => '/dashboard/super-admin/venues', 'where' => 'Venues'],
                    ['title' => 'Review booking requests', 'detail' => 'Open a pending booking, check the schedule, then Approve or reject it.', 'path' => '/dashboard/super-admin/venues', 'where' => 'Venues → Bookings'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'sao-clearance-period',
                'category' => 'Clearances',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Open a clearance period',
                'question' => 'How do I open a clearance period?',
                'summary' => 'A clearance period sets which signatories every student needs. Organizations then sign or hold each student\'s line.',
                'keywords' => ['clearance period', 'open clearance', 'clearance', 'signatory', 'signatories', 'new clearance'],
                'checks' => ['active_semester'],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Clearances', 'detail' => 'In the sidebar, open Reviews → Clearances.', 'path' => '/dashboard/super-admin/clearances', 'where' => 'Reviews → Clearances'],
                    ['title' => 'Click "New clearance period"', 'detail' => 'Name the period and pick the required signatory roles.', 'path' => '/dashboard/super-admin/clearances', 'where' => 'Clearances'],
                    ['title' => 'Sign the SAO lines', 'detail' => 'Open the period to sign or hold the SAO line for each student.', 'path' => '/dashboard/super-admin/clearances', 'where' => 'Clearances → period'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'handle-grievances',
                'category' => 'Grievances',
                'roles' => ['SUPER_ADMIN', 'ADMIN'],
                'title' => 'Handle student grievances',
                'question' => 'How do I handle student grievances?',
                'summary' => 'Student grievances are confidential. Anonymous reports never show the student\'s identity.',
                'keywords' => ['grievance', 'grievances', 'complaint', 'concern', 'resolve grievance', 'dismiss', 'urgent'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Grievances', 'detail' => 'SAO: Reviews → Grievances. Organization Admin: Records → Grievances.', 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/grievances', 'ADMIN' => '/dashboard/grievances'], 'where' => 'Grievances'],
                    ['title' => 'Open a grievance', 'detail' => 'Read the details and urgency. Handle high and critical ones first.', 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/grievances', 'ADMIN' => '/dashboard/grievances'], 'where' => 'Grievances'],
                    ['title' => 'Update the status', 'detail' => 'Move it to In review, then Resolved or Dismissed, with a response the student can read.', 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/grievances', 'ADMIN' => '/dashboard/grievances'], 'where' => 'Grievances'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'sao-add-staff',
                'category' => 'Governance',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Add SAO staff with a link',
                'action' => 'add SAO staff',
                'question' => 'How do I add SAO staff?',
                'summary' => 'The people who help run the SAO get an invitation link. They type their own name, school ID, email and password, so you never set up their account for them.',
                'keywords' => ['sao staff', 'add staff', 'invite staff', 'staff invitation', 'new staff', 'sao assistant', 'invite sao', 'staff account'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open University users', 'detail' => 'In the sidebar, click University users.', 'path' => '/dashboard/super-admin/users', 'where' => 'University users'],
                    ['title' => 'Click "Add SAO staff"', 'detail' => 'You can type an email to tie the link to that address. It is optional.', 'path' => '/dashboard/super-admin/users', 'where' => 'University users'],
                    ['title' => 'Copy and send the link', 'detail' => 'The link works once and expires in 48 hours. The person opens it and makes their own account. Links that are still waiting are listed in the same window, where you can send one again or cancel it.', 'path' => '/dashboard/super-admin/users', 'where' => 'Add SAO staff'],
                ],
                'tips' => ['Make a new link if the first one expires.'],
            ],
            [
                'id' => 'reset-member-password',
                'category' => 'Members',
                'roles' => ['SUPER_ADMIN', 'ADMIN'],
                'title' => 'Reset a member\'s password',
                'action' => 'reset a member\'s password',
                'question' => 'How do I reset someone\'s password?',
                'summary' => 'You create a one-time link that lets the person choose a new password. You never see or set their password yourself.',
                'keywords' => ['reset password', 'forgot password', 'locked out', 'new password', 'password link', 'reset link', 'recover account', 'cannot log in', 'cant login'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open the people list', 'detail' => ['SUPER_ADMIN' => 'In the sidebar, click University users and find the person.', 'ADMIN' => 'In the sidebar, open Members → People and find the person.'], 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/users', 'ADMIN' => '/dashboard/admin/users'], 'where' => 'People'],
                    ['title' => 'Choose Reset password', 'detail' => ['SUPER_ADMIN' => 'Open the menu on their row, choose Reset password and confirm Create reset link.', 'ADMIN' => 'Open the member and click Reset password.'], 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/users', 'ADMIN' => '/dashboard/admin/users'], 'where' => 'People'],
                    ['title' => 'Hand over the link', 'detail' => 'The link is shown to you once. Copy it and send it to the person. It is emailed only when email is turned on.', 'path' => null, 'where' => 'Reset link ready'],
                ],
                'tips' => ['The link works once and expires, so make a new one if it is not used in time.'],
            ],
            [
                'id' => 'upload-student-records',
                'category' => 'Members',
                'roles' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD'],
                'title' => 'Upload student records',
                'action' => 'upload student records',
                'question' => 'How do I upload student records?',
                'summary' => 'Students are matched against these school records when they sign up, and office staff are picked from them. You load them from a CSV file, and nothing is saved until you have checked it.',
                'keywords' => ['student records', 'school records', 'upload records', 'import students', 'csv', 'import records', 'student list', 'enrollment list', 'edp records', 'upload students'],
                'checks' => [],
                'minutes' => 4,
                'steps' => [
                    ['title' => 'Open the student records', 'detail' => ['SUPER_ADMIN' => 'In the sidebar, open Governance → Student records.', 'DEPARTMENT_HEAD' => 'In the sidebar, click People and stay on the Students tab.'], 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/student-records', 'DEPARTMENT_HEAD' => '/dashboard/department-head/people'], 'where' => 'Student records'],
                    ['title' => 'Choose the CSV file', 'detail' => ['SUPER_ADMIN' => 'Use the upload card. Download a blank file first if you need the columns.', 'DEPARTMENT_HEAD' => 'Click Upload student records, then choose the file. Download a blank file first if you need the columns.'], 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/student-records', 'DEPARTMENT_HEAD' => '/dashboard/department-head/people'], 'where' => 'Upload school records'],
                    ['title' => 'Click "Check file"', 'detail' => 'HIUSA reads the whole file and tells you how many records are new, how many will be updated and how many need fixing. Rows that need fixing are skipped.', 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/student-records', 'DEPARTMENT_HEAD' => '/dashboard/department-head/people'], 'where' => 'Upload school records'],
                    ['title' => 'Save the records', 'detail' => 'Click the Save button that shows how many records will be saved. Fix the skipped rows in the file and upload it again if you need them.', 'path' => ['SUPER_ADMIN' => '/dashboard/super-admin/student-records', 'DEPARTMENT_HEAD' => '/dashboard/department-head/people'], 'where' => 'Upload school records'],
                ],
                'tips' => ['A student whose school ID and birth date match a record can then create their own account. Birth dates are only used for that check and are never shown.'],
            ],
            [
                'id' => 'sao-announcement',
                'category' => 'Announcements',
                'roles' => ['SUPER_ADMIN'],
                'title' => 'Post a university-wide announcement',
                'question' => 'How do I post a university announcement?',
                'action' => 'post a university announcement',
                'summary' => 'University announcements reach every role in every organization.',
                'keywords' => ['announcement', 'announce', 'post', 'bulletin', 'broadcast', 'news', 'university announcement'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open University announcements', 'detail' => 'In the sidebar, open Updates → University announcements.', 'path' => '/dashboard/super-admin/announcements', 'where' => 'Updates → University announcements'],
                    ['title' => 'Write the announcement', 'detail' => 'Add a title, body, and category. Mark it important or pinned if needed.', 'path' => '/dashboard/super-admin/announcements', 'where' => 'University announcements'],
                    ['title' => 'Publish', 'detail' => 'It appears right away on every user\'s announcement feed.', 'path' => '/dashboard/super-admin/announcements', 'where' => 'University announcements'],
                ],
                'tips' => [],
            ],

            // ---------------------------------------------------------------
            // DEPARTMENT_HEAD
            // ---------------------------------------------------------------
            [
                'id' => 'dean-endorse-application',
                'category' => 'Organizations',
                'roles' => ['DEPARTMENT_HEAD'],
                'title' => 'Review an organization application',
                'question' => 'How do I endorse an organization application?',
                'summary' => 'A student you allowed to apply sends the application to you first. You review the files, then endorse it to SAO or return it.',
                'keywords' => ['endorse', 'endorsement', 'organization application', 'application', 'applicant', 'review application'],
                'checks' => ['applications_waiting'],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Organization applications', 'detail' => 'In the sidebar, click Organization applications.', 'path' => '/dashboard/organization-applications', 'where' => 'Organization applications'],
                    ['title' => 'Open an application', 'detail' => 'Check the applicant\'s details and open each requirement file.', 'path' => '/dashboard/organization-applications', 'where' => 'Organization applications'],
                    ['title' => 'Endorse or return it', 'detail' => 'Mark each requirement OK, missing or needs changes and add a note. Endorsing sends it to SAO. Returning sends it back to the applicant with your notes.', 'path' => '/dashboard/organization-applications', 'where' => 'Organization applications'],
                ],
                'tips' => ['The applicant sends it again from their own account after you return it.'],
            ],
            [
                'id' => 'dean-allow-applicant',
                'category' => 'Organizations',
                'roles' => ['DEPARTMENT_HEAD'],
                'title' => 'Allow a student to apply for an organization',
                'question' => 'How do I start a new organization for my college?',
                'action' => 'start a new organization',
                'doing' => 'Yes, you can start a new organization for your college, and it begins with you. On the Organizations page you choose a student of your college with Allow a student to apply, and that student fills in the application from their own account. The application then comes back to you: you endorse it to the SAO or return it with your notes. The SAO makes the final decision, and when the SAO approves it the student becomes the organization\'s Admin.',
                'summary' => 'You pick a student of your college. They then see Apply for an organization and send the application to you.',
                'keywords' => ['register organization', 'create organization', 'new organization', 'add organization', 'college organization', 'allow student to apply', 'make an org', 'new org', 'create org', 'start an organization', 'start a club', 'new club', 'sign up an organization'],
                'checks' => ['active_semester', 'college_organizations', 'applicant_grants', 'applications_waiting'],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Organizations', 'detail' => 'In the sidebar, click Organizations.', 'path' => '/dashboard/department-head/organizations', 'where' => 'Organizations'],
                    ['title' => 'Click "Allow a student to apply"', 'detail' => 'Type the student\'s name or email and pick them from the list.', 'path' => '/dashboard/department-head/organizations', 'where' => 'Organizations'],
                    ['title' => 'Wait for the application', 'detail' => 'It arrives in Organization applications. You review it, endorse it to SAO, or return it.', 'path' => '/dashboard/organization-applications', 'where' => 'Organization applications'],
                ],
                'tips' => ['One permission covers one application. Take it back from the same list before the student applies.'],
            ],
            [
                'id' => 'dean-subaccount-oversight',
                'category' => 'Organizations',
                'roles' => ['DEPARTMENT_HEAD'],
                'title' => 'Oversee student organizations via GHL-style sub-accounts',
                'question' => 'How do I oversee organizations as sub-accounts?',
                'summary' => 'Deans can switch context into any student organization under their college from the top navigation bar without logging out.',
                'keywords' => ['sub-account', 'subaccount', 'ghl', 'oversee org', 'switch organization', 'switch org', 'context switch', 'dean oversight', 'master view'],
                'checks' => [],
                'minutes' => 1,
                'steps' => [
                    ['title' => 'Open the workspace switcher', 'detail' => 'In the top bar, click the workspace button. It lists every active organization in your college.', 'path' => null, 'where' => 'Top navigation bar'],
                    ['title' => 'Pick a student organization', 'detail' => 'Search or pick one, for example PSITS-CCS. The sidebar changes to that organization\'s space without logging out.', 'path' => '/dashboard/department-head/organizations', 'where' => 'Top bar → Workspace switcher'],
                    ['title' => 'Look at its people, events, finance and documents', 'detail' => 'Use the tabs on the organization page. People and access is where you give a student access to the organization.', 'path' => '/dashboard/department-head/organizations', 'where' => 'Organization space'],
                    ['title' => 'Go back to your college', 'detail' => 'Click "Back to my college" at the bottom of the sidebar, or pick your college in the workspace switcher.', 'path' => null, 'where' => 'Sidebar / top bar'],
                ],
                'tips' => ['Switching is non-destructive: you stay signed in as the Dean.'],
            ],
            [
                'id' => 'dean-name-organization-head',
                'category' => 'Organizations',
                'roles' => ['DEPARTMENT_HEAD'],
                'title' => 'Name the organization head of an organization in your college',
                'question' => 'How do I give an organization its head?',
                'summary' => 'You name the Organization head (usually the President) of each student organization in your college. The person must already have an account.',
                'keywords' => ['organization head', 'give access', 'president', 'add admin', 'administrator', 'awaiting administrator', 'org admin', 'assign president', 'name head'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Organizations', 'detail' => 'In the sidebar, click Organizations and open the organization that has no head yet.', 'path' => '/dashboard/department-head/organizations', 'where' => 'Organizations'],
                    ['title' => 'Open People and access', 'detail' => 'Use the People and access tab on the organization page.', 'path' => '/dashboard/department-head/organizations', 'where' => 'Organization page → People and access'],
                    ['title' => 'Click "Give access"', 'detail' => 'Type the student\'s name or email, pick them from the list and choose Organization head. You never type a school ID.', 'path' => '/dashboard/department-head/organizations', 'where' => 'People and access → Give access'],
                ],
                'tips' => ['A student without an account signs up first from the sign-up page. The SAO does not name heads for college organizations.'],
            ],
            [
                'id' => 'dean-office-staff',
                'category' => 'Governance',
                'roles' => ['DEPARTMENT_HEAD'],
                'title' => 'Add office staff and delegate a College Secretary',
                'question' => 'How do I add office staff or delegate a secretary?',
                'summary' => 'Deans invite college secretaries and office assistants with a link. They create their own account, so you never type their name, school ID or password.',
                'keywords' => ['staff', 'secretary', 'college secretary', 'dept sec', 'delegate', 'office assistant', 'add staff', 'assistants', 'office staff'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open People', 'detail' => 'In the sidebar, open People and switch to the Office staff tab.', 'path' => '/dashboard/department-head/people', 'where' => 'People → Office staff'],
                    ['title' => 'Click "Invite staff"', 'detail' => 'Type their position, for example College Secretary. An email is optional and only sends the link for you.', 'path' => '/dashboard/department-head/people', 'where' => 'People → Office staff'],
                    ['title' => 'Share the link', 'detail' => 'Copy the link and send it to them. It works once and expires in 48 hours. They set up their own account and sign in with their email.', 'path' => '/dashboard/department-head/people', 'where' => 'Invite office staff'],
                    ['title' => 'Remove access anytime', 'detail' => 'Remove a staff member from the same list. Their account stays and you can invite them again later.', 'path' => '/dashboard/department-head/people', 'where' => 'People → Office staff'],
                ],
                'tips' => ['Office staff can help with college reviews and compliance. Someone who already has an account can be added from Organizations → Office staff by name.'],
            ],

            [
                'id' => 'dean-approvals',
                'category' => 'Approvals',
                'roles' => ['DEPARTMENT_HEAD'],
                'title' => 'Approve budgets, events, and reports for your college',
                'question' => 'How do I approve requests from my college organizations?',
                'action' => 'approve requests from the organizations of a college',
                'summary' => 'Budgets, events, elections, and financial reports from your college need your sign-off before they reach SAO.',
                'keywords' => ['approve', 'approval', 'endorse budget', 'approve event', 'approve budget', 'financial report', 'sign off', 'pending request'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Approvals', 'detail' => 'In the sidebar, click Approvals.', 'path' => '/dashboard/department-head/approvals', 'where' => 'Approvals'],
                    ['title' => 'Open a request', 'detail' => 'Check the amounts, attached files, and requirement checklist.', 'path' => '/dashboard/department-head/approvals', 'where' => 'Approvals'],
                    ['title' => 'Approve or return with remarks', 'detail' => 'Approved budgets and reports go on to SAO for the final decision.', 'path' => '/dashboard/department-head/approvals', 'where' => 'Approvals'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'dean-compliance',
                'category' => 'Accreditation & compliance',
                'roles' => ['DEPARTMENT_HEAD'],
                'title' => 'Check college compliance and send reminders',
                'question' => 'How do I check compliance and remind organizations?',
                'summary' => 'See which college organizations are missing requirement files, and send them a reminder.',
                'keywords' => ['compliance', 'remind', 'reminder', 'missing requirements', 'college compliance', 'follow up'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open College compliance', 'detail' => 'In the sidebar, click College compliance.', 'path' => '/dashboard/department-head/compliance', 'where' => 'College compliance'],
                    ['title' => 'Find organizations with missing or returned files', 'detail' => 'Each organization shows its progress against the active requirements.', 'path' => '/dashboard/department-head/compliance', 'where' => 'College compliance'],
                    ['title' => 'Send a reminder', 'detail' => 'Use the reminder action on that organization. Its admins are notified.', 'path' => '/dashboard/department-head/compliance', 'where' => 'College compliance'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'dean-announcement',
                'category' => 'Announcements',
                'roles' => ['DEPARTMENT_HEAD'],
                'title' => 'Post a college announcement',
                'question' => 'How do I post a college announcement?',
                'action' => 'post a college announcement',
                'summary' => 'College announcements reach every organization and member in your college.',
                'keywords' => ['announcement', 'announce', 'post', 'bulletin', 'college announcement'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Announcements', 'detail' => 'In the sidebar, click Announcements.', 'path' => '/dashboard/department-head/announcements', 'where' => 'Announcements'],
                    ['title' => 'Write and publish', 'detail' => 'Add a title, body, and category, then publish it.', 'path' => '/dashboard/department-head/announcements', 'where' => 'Announcements'],
                ],
                'tips' => [],
            ],

            // ---------------------------------------------------------------
            // ADMIN (Organization) and SBO_OFFICER
            // ---------------------------------------------------------------
            [
                'id' => 'admin-programs-sections',
                'category' => 'Organization setup',
                'roles' => ['ADMIN'],
                'title' => 'Set up programs and sections',
                'question' => 'How do I add programs and sections?',
                'summary' => 'Programs and sections are used when adding members, sending invoices, and checking attendance.',
                'keywords' => ['program', 'programs', 'section', 'sections', 'course', 'year level', 'academic structure', 'bsit'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Programs and sections', 'detail' => 'In the sidebar, open Members → Programs and sections.', 'path' => '/dashboard/admin/programs-sections', 'where' => 'Members → Programs and sections'],
                    ['title' => 'Click "Add a program"', 'detail' => 'Enter the program name (for example BS Information Technology).', 'path' => '/dashboard/admin/programs-sections', 'where' => 'Programs and sections'],
                    ['title' => 'Add sections under the program', 'detail' => 'For example 1-A, 2-A, 3-A, 4-A.', 'path' => '/dashboard/admin/programs-sections', 'where' => 'Programs and sections'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'admin-officer-positions',
                'category' => 'Organization setup',
                'roles' => ['ADMIN'],
                'title' => 'Create officer positions',
                'question' => 'How do I create officer positions?',
                'summary' => 'Officer positions (Vice President, Treasurer, Secretary, and so on) are given to SBO Officers. AI task delegation uses them too.',
                'keywords' => ['position', 'positions', 'officer position', 'sbo position', 'treasurer', 'secretary', 'vice president', 'auditor', 'pio'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Officer positions', 'detail' => 'In the sidebar, open Members → Officer positions.', 'path' => '/dashboard/admin/positions', 'where' => 'Members → Officer positions'],
                    ['title' => 'Click "Add Position"', 'detail' => 'Enter the position title and its responsibilities.', 'path' => '/dashboard/admin/positions', 'where' => 'Officer positions'],
                    ['title' => 'Assign it to an officer', 'detail' => 'Pick the position when you create or edit an SBO Officer in People.', 'path' => '/dashboard/admin/users', 'where' => 'Members → People'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'admin-add-members',
                'category' => 'Members',
                'roles' => ['ADMIN', 'SBO_OFFICER'],
                'title' => 'Add members and officers, and enroll fingerprints',
                'question' => 'How do I add members or officers?',
                'action' => 'add members or officers',
                'summary' => 'Give students in your college access to your organization as members or SBO Officers. Enroll their fingerprints for event check-in.',
                'keywords' => ['add member', 'add user', 'new user', 'member', 'members', 'officer', 'add officer', 'student account', 'fingerprint', 'biometric', 'enroll'],
                'checks' => [],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open People', 'detail' => 'Admin: Members → People. Officer: Members and fingerprints.', 'path' => '/dashboard/admin/users', 'where' => 'Members → People'],
                    ['title' => 'Click "Add existing student"', 'detail' => 'Type the student\'s name or email and pick them from the list, then choose their role (member or officer). You never type a school ID. A student without an account signs up from the sign-up page first.', 'path' => '/dashboard/admin/users', 'where' => 'People'],
                    ['title' => 'Enroll a fingerprint (optional)', 'detail' => 'Open the member and capture their fingerprint with the reader. Only an encrypted template is stored.', 'path' => '/dashboard/admin/users', 'where' => 'People → member'],
                ],
                'tips' => ['Students create their own accounts. The Organization Admin gives them access. Officers can enroll fingerprints.'],
            ],
            [
                'id' => 'admin-budget',
                'category' => 'Finance',
                'roles' => ['ADMIN'],
                'title' => 'Request a budget',
                'question' => 'How do I create or request a budget?',
                'action' => 'request a budget',
                'summary' => 'Budgets are requested through Approvals. The Department Head approves them, then SAO gives final approval before you spend.',
                'keywords' => ['budget', 'budgets', 'allocation', 'request budget', 'new budget', 'fund', 'funding', 'allocate'],
                'checks' => ['active_semester'],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open Approvals → New request', 'detail' => 'In the sidebar, open Approvals and start a new request.', 'path' => '/dashboard/approval-requests/new', 'where' => 'Approvals → New request'],
                    ['title' => 'Choose Budget', 'detail' => 'Enter the title, amount, purpose, and breakdown. Attach supporting files.', 'path' => '/dashboard/approval-requests/new/budget', 'where' => 'New request → Budget'],
                    ['title' => 'Submit and track it', 'detail' => 'Follow its status in Approvals: Dean, then SAO.', 'path' => '/dashboard/approvals', 'where' => 'Approvals'],
                    ['title' => 'See the approved budget', 'detail' => 'Approved budgets appear in Finance → Budgets with their remaining balance.', 'path' => '/dashboard/finance/budget-allocation', 'where' => 'Finance → Budgets'],
                ],
                'tips' => ['Ask AI "How is our budget?" for remaining balances.'],
            ],
            [
                'id' => 'admin-ledger',
                'category' => 'Finance',
                'roles' => ['ADMIN'],
                'title' => 'Record an income or expense in the ledger',
                'question' => 'How do I record a transaction or expense?',
                'summary' => 'Every peso in or out is recorded in the ledger against a budget, with a receipt.',
                'keywords' => ['transaction', 'expense', 'income', 'ledger', 'receipt', 'record expense', 'spend', 'payment out'],
                'checks' => ['active_semester'],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Ledger', 'detail' => 'In the sidebar, open Finance → Ledger.', 'path' => '/dashboard/finance/financial-ledger', 'where' => 'Finance → Ledger'],
                    ['title' => 'Click "Record transaction"', 'detail' => 'Choose income or expense, the budget, amount, date, and description.', 'path' => '/dashboard/finance/financial-ledger', 'where' => 'Ledger'],
                    ['title' => 'Attach the receipt and save', 'detail' => 'The budget\'s remaining balance updates right away, and the entry is written to the audit log.', 'path' => '/dashboard/finance/financial-ledger', 'where' => 'Ledger'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'admin-collections',
                'category' => 'Finance',
                'roles' => ['ADMIN'],
                'title' => 'Collect fees and send student invoices',
                'question' => 'How do I collect fees or invoice students?',
                'summary' => 'Record collections and remittances, and send invoices so students see what they owe.',
                'keywords' => ['collection', 'collections', 'fee', 'fees', 'invoice', 'invoices', 'student account', 'unpaid', 'debt', 'remittance', 'cash advance'],
                'checks' => ['active_semester'],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open Collections and advances', 'detail' => 'In the sidebar, open Finance → Collections and advances.', 'path' => '/dashboard/finance/collections', 'where' => 'Finance → Collections and advances'],
                    ['title' => 'Click "Record collection"', 'detail' => 'Enter the source and amount. Click Verify to post it to the ledger, and record the remittance when the cash is turned over.', 'path' => '/dashboard/finance/collections', 'where' => 'Collections and advances'],
                    ['title' => 'Invoice students', 'detail' => 'Open Finance → Student accounts to send an invoice to members, record payments, and see balances.', 'path' => '/dashboard/finance/student-accounts', 'where' => 'Finance → Student accounts'],
                ],
                'tips' => ['Students see their invoices under My payments → Statement of account.'],
            ],
            [
                'id' => 'admin-financial-report',
                'category' => 'Finance',
                'roles' => ['ADMIN'],
                'title' => 'Generate and submit a financial report',
                'question' => 'How do I generate a financial report?',
                'summary' => 'Build the semester\'s financial report from the ledger and submit it for Dean and SAO review.',
                'keywords' => ['financial report', 'report', 'liquidation', 'statement', 'generate report', 'submit report', 'pdf'],
                'checks' => [],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open Financial reports', 'detail' => 'In the sidebar, open Finance → Financial reports.', 'path' => '/dashboard/finance/transaction-history', 'where' => 'Finance → Financial reports'],
                    ['title' => 'Generate the report', 'detail' => 'Pick the financial semester. HIUSA builds it from the ledger and attached receipts.', 'path' => '/dashboard/finance/transaction-history', 'where' => 'Financial reports'],
                    ['title' => 'Review and submit', 'detail' => 'Download the PDF to check it, then submit it for review.', 'path' => '/dashboard/finance/transaction-history', 'where' => 'Financial reports'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'admin-create-event',
                'category' => 'Events',
                'roles' => ['ADMIN'],
                'title' => 'Create an event and submit its requirements',
                'question' => 'How do I create an event?',
                'action' => 'create an event',
                'open_path' => '/dashboard/events/manage-events?new=1',
                'open_label' => 'Open the new event form',
                'summary' => 'Create the event, attach the required files, and send it for approval. Then book a venue and run check-in on the day.',
                'keywords' => ['event', 'events', 'new event', 'create event', 'activity', 'seminar', 'program', 'event proposal', 'event requirements', 'event plan'],
                'checks' => ['active_semester'],
                'minutes' => 4,
                'steps' => [
                    ['title' => 'Open Events', 'detail' => 'In the sidebar, open Events and tasks → Events.', 'path' => '/dashboard/events/manage-events', 'where' => 'Events and tasks → Events'],
                    ['title' => 'Click "New event"', 'detail' => 'Enter the title, date and time, venue, expected attendees, and budget.', 'path' => '/dashboard/events/manage-events', 'where' => 'Events'],
                    ['title' => 'Upload the event requirements', 'detail' => 'Attach each required file (proposal, program, and so on) and submit for approval.', 'path' => '/dashboard/events/manage-events', 'where' => 'Events → event'],
                    ['title' => 'Plan with AI (optional)', 'detail' => 'Planning can generate a task plan for the event, which you confirm before tasks are created.', 'path' => '/dashboard/events/event-planner', 'where' => 'Events and tasks → Planning'],
                ],
                'tips' => ['Book the venue early. Overlapping approved bookings are blocked.'],
            ],
            [
                'id' => 'book-venue',
                'category' => 'Venues',
                'roles' => ['ADMIN', 'SBO_OFFICER'],
                'title' => 'Book a campus venue',
                'question' => 'How do I book a venue?',
                'action' => 'book a campus venue',
                'summary' => 'Request a campus venue for your activity. SAO approves the booking.',
                'keywords' => ['venue', 'book venue', 'booking', 'reserve', 'room', 'auditorium', 'gym', 'hall', 'request venue'],
                'checks' => ['active_semester'],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Venue booking', 'detail' => 'In the sidebar, open Events and tasks → Venue booking.', 'path' => '/dashboard/venues', 'where' => 'Events and tasks → Venue booking'],
                    ['title' => 'Click "Request a venue"', 'detail' => 'Pick the venue, check its availability, and choose the date and time.', 'path' => '/dashboard/venues', 'where' => 'Venue booking'],
                    ['title' => 'Send the request', 'detail' => 'It stays Pending until SAO approves it. You can withdraw it while pending.', 'path' => '/dashboard/venues', 'where' => 'Venue booking'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'event-check-in',
                'category' => 'Events',
                'roles' => ['ADMIN', 'SBO_OFFICER'],
                'title' => 'Check in attendees at an event',
                'question' => 'How do I record attendance at an event?',
                'summary' => 'Record attendance by fingerprint scan or by hand during an ongoing event.',
                'keywords' => ['attendance', 'check-in', 'check in', 'scan', 'fingerprint attendance', 'record arrival', 'attendees'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Check-in', 'detail' => 'In the sidebar, open Events and tasks → Check-in.', 'path' => '/dashboard/events/check-in', 'where' => 'Events and tasks → Check-in'],
                    ['title' => 'Pick the ongoing event', 'detail' => 'Only approved events happening now accept check-ins.', 'path' => '/dashboard/events/check-in', 'where' => 'Check-in'],
                    ['title' => 'Scan or record an arrival', 'detail' => 'Ask the member to place a finger on the reader, or record the arrival by hand.', 'path' => '/dashboard/events/check-in', 'where' => 'Check-in'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'admin-create-task',
                'category' => 'Tasks',
                'roles' => ['ADMIN'],
                'title' => 'Create a task and let AI recommend who should do it',
                'question' => 'How do I create and assign a task?',
                'action' => 'create a task',
                'open_path' => '/dashboard/tasks/task-board?new=1',
                'open_label' => 'Open the new task form',
                'summary' => 'Create tasks for officers. The AI recommends an assignee based on position and current workload.',
                'keywords' => ['task', 'tasks', 'assign', 'assignment', 'delegate', 'delegation', 'to-do', 'deadline', 'workload', 'recommend assignee'],
                'checks' => ['active_semester'],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Tasks', 'detail' => 'In the sidebar, open Events and tasks → Tasks.', 'path' => '/dashboard/tasks/task-board', 'where' => 'Events and tasks → Tasks'],
                    ['title' => 'Click "New task"', 'detail' => 'Enter the title, description, priority, and deadline.', 'path' => '/dashboard/tasks/task-board?new=1', 'where' => 'Tasks'],
                    ['title' => 'Use AI to recommend an assignee', 'detail' => 'The recommendation looks at positions and workload. Accept it or pick someone else, then save.', 'path' => '/dashboard/tasks/task-board', 'where' => 'New task form'],
                    ['title' => 'Track progress', 'detail' => 'Officers update the status from My tasks. Watch it on the task board.', 'path' => '/dashboard/tasks/task-board?view=progress', 'where' => 'Tasks → Progress'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'officer-update-task',
                'category' => 'Tasks',
                'roles' => ['SBO_OFFICER'],
                'title' => 'Update your assigned tasks',
                'question' => 'How do I update my task status?',
                'summary' => 'Move tasks assigned to you from To do, to In progress, to Completed, and add progress notes.',
                'keywords' => ['my task', 'my tasks', 'assigned task', 'update task', 'task status', 'mark completed', 'progress update'],
                'checks' => [],
                'minutes' => 1,
                'steps' => [
                    ['title' => 'Open My tasks', 'detail' => 'In the sidebar, open Events and tasks → My tasks.', 'path' => '/dashboard/tasks/assigned-tasks', 'where' => 'Events and tasks → My tasks'],
                    ['title' => 'Open a task', 'detail' => 'Check the deadline and details.', 'path' => '/dashboard/tasks/assigned-tasks', 'where' => 'My tasks'],
                    ['title' => 'Mark In Progress or Mark Completed', 'detail' => 'Add a progress update so your admin can see what was done.', 'path' => '/dashboard/tasks/assigned-tasks', 'where' => 'My tasks'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'admin-submit-compliance',
                'category' => 'Accreditation & compliance',
                'roles' => ['ADMIN'],
                'title' => 'Submit your organization\'s compliance requirements',
                'question' => 'How do we submit our compliance requirements?',
                'summary' => 'Upload each active requirement so SAO can keep your organization accredited.',
                'keywords' => ['compliance', 'requirement', 'requirements', 'accreditation', 'submit requirement', 'upload document', 'constitution', 'by-laws', 'returned file'],
                'checks' => ['active_semester'],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open Compliance', 'detail' => 'In the sidebar, open Records → Compliance.', 'path' => '/dashboard/compliance', 'where' => 'Records → Compliance'],
                    ['title' => 'Download the sample format', 'detail' => 'Each requirement has a sample format and a deadline.', 'path' => '/dashboard/compliance', 'where' => 'Compliance'],
                    ['title' => 'Upload your file and click "Submit for review"', 'detail' => 'The status changes to Submitted. If SAO returns it, read the remarks and upload a corrected file.', 'path' => '/dashboard/compliance', 'where' => 'Compliance'],
                ],
                'tips' => ['Ask AI "What haven\'t we submitted yet?" to see what is still missing.'],
            ],
            [
                'id' => 'admin-election',
                'category' => 'Elections',
                'roles' => ['ADMIN'],
                'title' => 'Set up and run an election',
                'question' => 'How do I set up an election?',
                'action' => 'set up and run an election',
                'summary' => 'Create the election, add positions, party lists, and candidates, open voting, then finalize the results.',
                'keywords' => ['election', 'elections', 'vote', 'voting', 'ballot', 'candidate', 'candidates', 'partylist', 'party list', 'position', 'finalize', 'open election', 'start election', 'create election', 'run election', 'set up election', 'hold election'],
                'checks' => ['active_semester'],
                'minutes' => 5,
                'steps' => [
                    ['title' => 'Open Elections', 'detail' => 'In the sidebar, open Voting → Elections.', 'path' => '/dashboard/elections/manage-elections', 'where' => 'Voting → Elections'],
                    ['title' => 'Click "Create election"', 'detail' => 'Set the title and voting window, then add positions with "Add position".', 'path' => '/dashboard/elections/manage-elections', 'where' => 'Elections'],
                    ['title' => 'Add party lists and candidates', 'detail' => 'Create party lists, then add each candidate with their position and platform.', 'path' => '/dashboard/elections/manage-candidates', 'where' => 'Elections → Candidates'],
                    ['title' => 'Open voting and finalize', 'detail' => 'Students vote on the ballot page. After voting closes, finalize the election to publish the results.', 'path' => '/dashboard/elections/election-results', 'where' => 'Voting → Results'],
                ],
                'tips' => ['An election request may need approval through Approvals first.'],
            ],
            [
                'id' => 'admin-merchandise',
                'category' => 'Merchandise',
                'roles' => ['ADMIN'],
                'title' => 'Add merchandise and set up GCash payments',
                'question' => 'How do I add merchandise to the store?',
                'summary' => 'List products with sizes and stock. Students order and pay through GCash.',
                'keywords' => ['merchandise', 'merch', 'product', 'store', 'shop', 'inventory', 'stock', 'shirt', 'lanyard', 'gcash', 'price'],
                'checks' => [],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open Inventory', 'detail' => 'In the sidebar, open Store → Inventory.', 'path' => '/dashboard/merchandise/manage-inventory', 'where' => 'Store → Inventory'],
                    ['title' => 'Click "Add Product"', 'detail' => 'Enter the name, price, image, and sizes or variants, then add the starting stock.', 'path' => '/dashboard/merchandise/manage-inventory', 'where' => 'Inventory'],
                    ['title' => 'Set up GCash', 'detail' => 'Enter the organization\'s GCash name, number, and QR so students can pay.', 'path' => '/dashboard/merchandise/gcash-payment', 'where' => 'Store → GCash settings'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'verify-orders',
                'category' => 'Merchandise',
                'roles' => ['ADMIN', 'SBO_OFFICER'],
                'title' => 'Verify merchandise payments and release orders',
                'question' => 'How do I verify orders and release merchandise?',
                'summary' => 'Check the student\'s GCash proof, mark the order paid, then release it at the claim desk with the student\'s claim token.',
                'keywords' => ['order', 'orders', 'verify payment', 'payment proof', 'claim', 'claim token', 'release', 'pickup', 'claim desk'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Orders', 'detail' => 'In the sidebar, open Store → Orders.', 'path' => '/dashboard/merchandise/manage-orders', 'where' => 'Store → Orders'],
                    ['title' => 'Verify the payment', 'detail' => 'Open the order, check the GCash proof, and mark it paid (or reject it).', 'path' => '/dashboard/merchandise/manage-orders', 'where' => 'Orders'],
                    ['title' => 'Release at the claim desk', 'detail' => 'Scan or enter the student\'s claim token, verify who they are, then release the item.', 'path' => '/dashboard/merchandise/claim-tokens', 'where' => 'Store → Claim desk'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'create-announcement',
                'category' => 'Announcements',
                'roles' => ['ADMIN', 'SBO_OFFICER'],
                'title' => 'Post an organization announcement',
                'question' => 'How do I post an announcement?',
                'action' => 'post an announcement',
                'open_path' => '/dashboard/announcements/create-announcement',
                'open_label' => 'Open the new announcement form',
                'summary' => 'Share news with your members. Once it is published, it shows on their announcement feed.',
                'keywords' => ['announcement', 'announce', 'post', 'bulletin', 'news', 'publish', 'pin'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Announcements', 'detail' => 'In the sidebar, open Updates → Announcements.', 'path' => '/dashboard/announcements/manage-announcements', 'where' => 'Updates → Announcements'],
                    ['title' => 'Click "New announcement"', 'detail' => 'Add a title, body, category, and audience. Pin it or mark it important if needed.', 'path' => '/dashboard/announcements/create-announcement', 'where' => 'New announcement'],
                    ['title' => 'Publish it or send it for approval', 'detail' => ['ADMIN' => 'Publish now or schedule it. Published announcements appear on members\' feeds right away.', 'SBO_OFFICER' => 'Submit it for approval. Your Admin approves it before it appears on members\' feeds.'], 'path' => '/dashboard/announcements/create-announcement', 'where' => 'New announcement'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'sign-clearances',
                'category' => 'Clearances',
                'roles' => ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'],
                'title' => 'Sign or hold student clearances',
                'question' => 'How do I sign student clearances?',
                'summary' => 'Sign each student\'s clearance line for your office, or hold it with a reason, such as unpaid fees.',
                'keywords' => ['clearance', 'clearances', 'sign clearance', 'hold clearance', 'signatory', 'signature'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Clearance signing', 'detail' => 'In the sidebar, click Clearance signing.', 'path' => '/dashboard/clearances', 'where' => 'Clearance signing'],
                    ['title' => 'Pick the clearance period', 'detail' => 'Students waiting for your signature are listed.', 'path' => '/dashboard/clearances', 'where' => 'Clearance signing'],
                    ['title' => 'Sign or hold each line', 'detail' => 'A hold needs a reason. The student sees it right away on My clearance.', 'path' => '/dashboard/clearances', 'where' => 'Clearance signing'],
                ],
                'tips' => [],
            ],

            // ---------------------------------------------------------------
            // STUDENT
            // ---------------------------------------------------------------
            [
                'id' => 'student-vote',
                'category' => 'Elections',
                'roles' => ['STUDENT', 'SBO_OFFICER', 'ADMIN'],
                'title' => 'Vote in an election',
                'question' => 'How do I vote in an election?',
                'summary' => 'Cast one secret ballot per election while voting is open.',
                'keywords' => ['vote', 'voting', 'ballot', 'cast vote', 'election', 'candidate'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open Vote', 'detail' => 'In the sidebar, open Voting → Vote (or My activity → Vote).', 'path' => '/dashboard/elections/cast-vote', 'where' => 'Voting → Vote'],
                    ['title' => 'Read the candidates and platforms', 'detail' => 'Pick one candidate for each position.', 'path' => '/dashboard/elections/cast-vote', 'where' => 'Ballot'],
                    ['title' => 'Review and submit', 'detail' => 'A ballot cannot be changed after you submit it. Results show under Results once finalized.', 'path' => '/dashboard/elections/election-results', 'where' => 'Voting → Results'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'student-order',
                'category' => 'Merchandise',
                'roles' => ['STUDENT', 'SBO_OFFICER', 'ADMIN'],
                'title' => 'Order merchandise and pay with GCash',
                'question' => 'How do I order merchandise?',
                'summary' => 'Order from your organization\'s store, upload your GCash proof, and claim the item with your claim token.',
                'keywords' => ['order', 'buy', 'purchase', 'merchandise', 'merch', 'shop', 'gcash', 'pay', 'claim token', 'shirt', 'lanyard'],
                'checks' => [],
                'minutes' => 3,
                'steps' => [
                    ['title' => 'Open Shop', 'detail' => 'In the sidebar, open Store → Shop.', 'path' => '/dashboard/merchandise/order-merchandise', 'where' => 'Store → Shop'],
                    ['title' => 'Add to cart and place the order', 'detail' => 'Pick the size or variant and quantity.', 'path' => '/dashboard/merchandise/order-merchandise', 'where' => 'Shop'],
                    ['title' => 'Submit your GCash payment', 'detail' => 'Pay to the number or QR shown, then upload the screenshot as proof.', 'path' => '/dashboard/merchandise/my-orders', 'where' => 'Store → My orders'],
                    ['title' => 'Claim it', 'detail' => 'Once an officer verifies your payment, show your claim token at the claim desk.', 'path' => '/dashboard/merchandise/my-orders', 'where' => 'My orders'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'student-clearance',
                'category' => 'Clearances',
                'roles' => ['STUDENT'],
                'title' => 'Check your clearance status',
                'question' => 'How do I check my clearance?',
                'summary' => 'See which offices have signed your clearance and why any line is on hold.',
                'keywords' => ['clearance', 'my clearance', 'signed', 'hold', 'signatory', 'cleared'],
                'checks' => [],
                'minutes' => 1,
                'steps' => [
                    ['title' => 'Open My clearance', 'detail' => 'In the sidebar, open Support → My clearance.', 'path' => '/dashboard/my-clearance', 'where' => 'Support → My clearance'],
                    ['title' => 'Check each signatory line', 'detail' => 'Signed lines are complete. Held lines show the reason, for example an unpaid invoice.', 'path' => '/dashboard/my-clearance', 'where' => 'My clearance'],
                    ['title' => 'Settle any holds', 'detail' => 'Pay open invoices under My payments → Statement of account, then ask the office to sign.', 'path' => '/dashboard/finance/statement-of-account', 'where' => 'My payments → Statement of account'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'student-grievance',
                'category' => 'Grievances',
                'roles' => ['STUDENT'],
                'title' => 'File a grievance',
                'question' => 'How do I file a grievance?',
                'action' => 'file a grievance',
                'summary' => 'Report a concern to your organization or straight to SAO. You can file it anonymously.',
                'keywords' => ['grievance', 'complaint', 'concern', 'report', 'anonymous', 'file grievance', 'issue'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Open My grievances', 'detail' => 'In the sidebar, open Support → My grievances.', 'path' => '/dashboard/my-grievances', 'where' => 'Support → My grievances'],
                    ['title' => 'Click "File a grievance"', 'detail' => 'Choose your organization or SAO, describe the concern, and set the urgency.', 'path' => '/dashboard/my-grievances', 'where' => 'My grievances'],
                    ['title' => 'Choose anonymous if needed, then submit', 'detail' => 'Track its status and read responses on the same page.', 'path' => '/dashboard/my-grievances', 'where' => 'My grievances'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'student-fees',
                'category' => 'Finance',
                'roles' => ['STUDENT', 'SBO_OFFICER', 'ADMIN'],
                'title' => 'Check your fees, invoices, and receipts',
                'question' => 'How do I check what fees I owe?',
                'summary' => 'Your statement of account shows open invoices, payments, and your remaining balance.',
                'keywords' => ['fee', 'fees', 'invoice', 'balance', 'owe', 'statement of account', 'receipt', 'receipts', 'payment', 'unpaid', 'pay fees', 'pay invoice', 'pay balance', 'settle balance', 'settle fees'],
                'checks' => [],
                'minutes' => 1,
                'steps' => [
                    ['title' => 'Open Statement of account', 'detail' => 'In the sidebar, open My payments → Statement of account.', 'path' => '/dashboard/finance/statement-of-account', 'where' => 'My payments → Statement of account'],
                    ['title' => 'Check open invoices', 'detail' => 'Each invoice shows the amount, how much is paid, and the balance.', 'path' => '/dashboard/finance/statement-of-account', 'where' => 'Statement of account'],
                    ['title' => 'Download receipts', 'detail' => 'Official receipts for verified payments are under Receipts.', 'path' => '/dashboard/finance/personal-receipts', 'where' => 'My payments → Receipts'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'student-apply-organization',
                'category' => 'Organizations',
                'roles' => ['STUDENT'],
                'title' => 'Apply to register a new organization',
                'question' => 'How can I apply to register a new organization?',
                'action' => 'start a new organization',
                'doing' => 'Yes, you can ask to start a new organization, and you do it on the Apply for an organization page. Your Department Head chooses which students of the college may apply, and once you are chosen you fill in the application and attach each required file yourself. The Department Head endorses it to the SAO, the SAO makes the final decision, and when it is approved you become the organization\'s Admin.',
                'summary' => 'Your Department Head has to allow you to apply first. Then you apply from your own account. The Dean endorses the application and SAO approves it.',
                'keywords' => ['register organization', 'apply', 'application', 'found', 'founder', 'start an organization', 'new club', 'register a club', 'track application', 'create org', 'new org', 'sign up', 'sign up an organization', 'make an org'],
                'checks' => ['active_semester', 'own_application'],
                'minutes' => 5,
                'steps' => [
                    ['title' => 'Open Apply for an organization', 'detail' => 'It shows in your menu once your Department Head allows you to apply.', 'path' => '/dashboard/student/apply-organization', 'where' => 'Apply for an organization'],
                    ['title' => 'Fill in the application', 'detail' => 'Enter the organization name, acronym, your position and attach each required file.', 'path' => '/dashboard/student/apply-organization', 'where' => 'Apply for an organization'],
                    ['title' => 'Follow it', 'detail' => 'The same page shows where the application is and what to fix if it is returned. After SAO approves it, you become the organization\'s Admin.', 'path' => '/dashboard/student/apply-organization', 'where' => 'Apply for an organization'],
                ],
                'tips' => ['Your Department Head chooses who may apply. The page has nothing to fill in until you are chosen.'],
            ],

            // ---------------------------------------------------------------
            // Every role
            // ---------------------------------------------------------------
            [
                'id' => 'use-ask-ai',
                'category' => 'Getting around',
                'roles' => self::ALL_ROLES,
                'title' => 'Use Ask AI',
                'question' => 'How do I use Ask AI?',
                'summary' => 'Ask AI answers questions about your records (who submitted what, budgets, tasks, orders) and walks you through how to do things. It only sees what your role is allowed to see.',
                'keywords' => ['ask ai', 'ai', 'assistant', 'copilot', 'chatbot', 'question', 'search'],
                'checks' => [],
                'minutes' => 1,
                'steps' => [
                    ['title' => 'Open Ask AI', 'detail' => 'Click Ask AI in the sidebar or the Ask AI pill in the top bar.', 'path' => '/dashboard/ask-ai', 'where' => 'Sidebar → Ask AI'],
                    ['title' => 'Type any question', 'detail' => 'For example "Who hasn\'t submitted requirements?", "How much is left in our budget?", or "How do I create an event?"', 'path' => '/dashboard/ask-ai', 'where' => 'Ask AI'],
                    ['title' => 'Use the result', 'detail' => 'Answers come with tables, charts, and buttons that open the right page. Click a suggested follow-up to keep going.', 'path' => '/dashboard/ask-ai', 'where' => 'Ask AI'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'interactive-tour',
                'category' => 'Getting around',
                'roles' => self::ALL_ROLES,
                'title' => 'Start the interactive tour',
                'question' => 'How do I start the interactive tour?',
                'summary' => 'The interactive tour moves a pointer around the screen and explains each part of your workspace.',
                'keywords' => ['tour', 'onboarding', 'tutorial', 'walkthrough', 'getting started', 'help', 'learn', 'new user'],
                'checks' => [],
                'minutes' => 2,
                'steps' => [
                    ['title' => 'Click "Interactive Tour" in the top bar', 'detail' => 'It is next to the Ask AI pill.', 'path' => null, 'where' => 'Top bar'],
                    ['title' => 'Pick a track', 'detail' => 'Role Guide, Create Org & Term, or Ask AI Guide.', 'path' => null, 'where' => 'Tour panel'],
                    ['title' => 'Step through it', 'detail' => 'Use Next and Back or the arrow keys, or turn on Auto-play.', 'path' => null, 'where' => 'Tour panel'],
                ],
                'tips' => [],
            ],
            [
                'id' => 'change-password',
                'category' => 'Getting around',
                'roles' => self::ALL_ROLES,
                'title' => 'Change your password or update your profile',
                'question' => 'How do I change my password?',
                'summary' => 'Update your profile details and password from the Profile page.',
                'keywords' => ['password', 'change password', 'profile', 'account', 'email', 'reset password', 'forgot password'],
                'checks' => [],
                'minutes' => 1,
                'steps' => [
                    ['title' => 'Open Profile', 'detail' => 'Click your name at the bottom of the sidebar, then Profile.', 'path' => '/dashboard/profile', 'where' => 'Sidebar → Profile'],
                    ['title' => 'Change your details or password', 'detail' => 'Enter your current password, then the new one twice, and save.', 'path' => '/dashboard/profile', 'where' => 'Profile'],
                    ['title' => 'Forgot your password?', 'detail' => 'On the login page, use account recovery. When email is off, ask your organization Admin or the SAO for a one-time link; SAO staff ask another SAO account holder.', 'path' => null, 'where' => 'Login page → Recover account'],
                ],
                'tips' => [],
            ],
        ];
    }

    /**
     * Rank every guide against the question.
     *
     * @return array{best: ?array, accessible: bool, related: array<int, array>, total: int, categories: int, top_confidence: int}
     */
    public function search(string $question, string $role): array
    {
        $guides = $this->all();
        $total = count($guides);
        $resolve = fn (array $guide) => $this->forViewer($guide, $role);
        $categories = count(array_unique(array_column($guides, 'category')));

        $queryTokens = $this->tokens($question);
        $questionLower = Str::lower($question);

        if ($queryTokens === []) {
            return ['best' => null, 'accessible' => false, 'related' => [], 'total' => $total, 'categories' => $categories, 'top_confidence' => 0];
        }

        // Document frequency per token across guides for IDF weighting.
        $docTokens = [];
        $docFreq = [];
        foreach ($guides as $i => $guide) {
            $fields = [
                'title' => $this->tokens($guide['title']),
                'keywords' => $this->tokens(implode(' ', $guide['keywords'])),
                'body' => $this->tokens($guide['summary'].' '.implode(' ', array_map(
                    fn (array $s) => $s['title'].' '.(is_array($s['detail']) ? implode(' ', $s['detail']) : $s['detail']),
                    $guide['steps']
                ))),
            ];
            $docTokens[$i] = $fields;
            foreach (array_unique(array_merge(...array_values($fields))) as $tok) {
                $docFreq[$tok] = ($docFreq[$tok] ?? 0) + 1;
            }
        }

        $scored = [];
        foreach ($guides as $i => $guide) {
            $score = 0.0;
            foreach (array_unique($queryTokens) as $tok) {
                $df = $docFreq[$tok] ?? 0;
                if ($df === 0) {
                    continue;
                }
                $idf = log(1 + ($total / $df));
                if (in_array($tok, $docTokens[$i]['title'], true)) {
                    $score += 3.0 * $idf;
                }
                if (in_array($tok, $docTokens[$i]['keywords'], true)) {
                    $score += 2.5 * $idf;
                }
                if (in_array($tok, $docTokens[$i]['body'], true)) {
                    $score += 0.8 * $idf;
                }
            }

            foreach ($guide['keywords'] as $phrase) {
                if (str_contains($phrase, ' ') && (str_contains($questionLower, Str::lower($phrase)) || $this->containsSequence($queryTokens, $this->tokens($phrase)))) {
                    $score += 4.0;
                }
            }

            $score += 3.0 * $this->trigramSimilarity($question, $guide['title']);

            $isAccessible = in_array($role, $guide['roles'], true);
            if ($isAccessible) {
                // Prefer the caller's own procedure when two guides tie.
                $score *= 1.25;
            }

            if ($score > 0) {
                $scored[] = ['guide' => $guide, 'score' => $score, 'accessible' => $isAccessible];
            }
        }

        usort($scored, fn (array $a, array $b) => $b['score'] <=> $a['score']);

        // A guide for this role that scores nearly as well as another role's guide is the one the person means.
        if ($scored !== [] && ! $scored[0]['accessible']) {
            foreach ($scored as $position => $candidate) {
                if ($candidate['accessible'] && $candidate['score'] >= 2.5 && $candidate['score'] >= $scored[0]['score'] * 0.7) {
                    array_unshift($scored, ...array_splice($scored, $position, 1));
                    break;
                }
            }
        }

        if ($scored === [] || $scored[0]['score'] < 2.5) {
            return ['best' => null, 'accessible' => false, 'related' => [], 'total' => $total, 'categories' => $categories, 'top_confidence' => 0];
        }

        $top = $scored[0];
        $related = array_values(array_map(
            fn (array $s) => $s['guide'],
            array_filter(
                array_slice($scored, 1, 8),
                fn (array $s) => $s['accessible'] && $s['score'] >= $top['score'] * 0.3
            )
        ));

        return [
            'best' => $resolve($top['guide']),
            'accessible' => $top['accessible'],
            'related' => array_map($resolve, array_slice($related, 0, 3)),
            'total' => $total,
            'categories' => $categories,
            'top_confidence' => max(35, min(99, (int) round(min(1.0, $top['score'] / 14) * 100))),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function forRole(string $role): array
    {
        return array_values(array_map(
            fn (array $guide) => $this->forViewer($guide, $role),
            array_filter($this->all(), fn (array $guide) => in_array($role, $guide['roles'], true))
        ));
    }

    /** A step whose detail differs by role is given to the asking role as plain text. */
    private function forViewer(array $guide, string $role): array
    {
        $guide['steps'] = array_map(function (array $step) use ($role): array {
            if (is_array($step['detail'])) {
                $step['detail'] = $step['detail'][$role] ?? (string) reset($step['detail']);
            }

            return $step;
        }, $guide['steps']);

        return $guide;
    }

    public function stepPath(array $step, string $role): ?string
    {
        $path = $step['path'] ?? null;
        if (is_array($path)) {
            return $path[$role] ?? null;
        }

        return $path;
    }

    /**
     * @return array<int, string>
     */
    private function tokens(string $text): array
    {
        $clean = preg_replace('/[^\pL\pN\s-]/u', ' ', Str::lower($text)) ?? '';
        $parts = preg_split('/[\s-]+/u', trim($clean)) ?: [];
        $out = [];
        foreach ($parts as $part) {
            if ($part === '' || in_array($part, self::STOPWORDS, true)) {
                continue;
            }
            $stem = $this->stem($part);
            if (strlen($stem) >= 2 && ! in_array($stem, self::STOPWORDS, true)) {
                $out[] = $stem;
            }
        }

        return $out;
    }

    private function stem(string $word): string
    {
        $aliases = [
            'org' => 'organization', 'orgs' => 'organization', 'club' => 'organization', 'clubs' => 'organization',
            'organisation' => 'organization', 'organisations' => 'organization',
            'sy' => 'year', 'ay' => 'year', 'term' => 'semester', 'terms' => 'semester', 'sem' => 'semester',
            'dean' => 'department', 'merch' => 'merchandise', 'pw' => 'password', 'login' => 'password',
            'make' => 'create', 'add' => 'create', 'new' => 'create', 'start' => 'create', 'set' => 'create', 'setup' => 'create',
            'establish' => 'create', 'register' => 'register',
            'reserve' => 'book', 'reservation' => 'book', 'complaint' => 'grievance', 'complaints' => 'grievance',
            'expenses' => 'expense', 'buy' => 'order', 'purchase' => 'order', 'officers' => 'officer',
        ];

        $base = $word;
        if (strlen($word) > 5 && str_ends_with($word, 'ies')) {
            $base = substr($word, 0, -3).'y';
        } elseif (strlen($word) > 4 && str_ends_with($word, 's') && ! str_ends_with($word, 'ss')) {
            $base = substr($word, 0, -1);
        }
        if (strlen($base) > 5 && str_ends_with($base, 'ing')) {
            $base = $this->undouble(substr($base, 0, -3));
        } elseif (strlen($base) > 4 && str_ends_with($base, 'ed')) {
            $base = $this->undouble(substr($base, 0, -2));
        }

        foreach ([$word, $base, $base.'e'] as $candidate) {
            if (isset($aliases[$candidate])) {
                $base = $aliases[$candidate];
                break;
            }
        }

        // A trailing "e" is dropped so that create, creating and created share one stem.
        return strlen($base) > 4 && str_ends_with($base, 'e') ? substr($base, 0, -1) : $base;
    }

    private function undouble(string $stem): string
    {
        return preg_match('/([^aeioulsz])\1$/', $stem) === 1 ? substr($stem, 0, -1) : $stem;
    }

    /** @param array<int, string> $haystack @param array<int, string> $needle */
    private function containsSequence(array $haystack, array $needle): bool
    {
        $original = $haystack;
        $haystack = array_values(array_filter($haystack, fn (string $token, int $i) => $i === 0 || $token !== $original[$i - 1], ARRAY_FILTER_USE_BOTH));
        $length = count($needle);
        if ($length < 2) {
            return false;
        }
        for ($i = 0; $i + $length <= count($haystack); $i++) {
            if (array_slice($haystack, $i, $length) === $needle) {
                return true;
            }
        }

        return false;
    }

    private function trigramSimilarity(string $a, string $b): float
    {
        $grams = function (string $text): array {
            $clean = preg_replace('/[^a-z0-9]/', '', Str::lower($text)) ?? '';
            $len = strlen($clean);
            if ($len < 3) {
                return $clean !== '' ? [$clean] : [];
            }
            $out = [];
            for ($i = 0; $i <= $len - 3; $i++) {
                $out[] = substr($clean, $i, 3);
            }

            return array_values(array_unique($out));
        };

        $ga = $grams($a);
        $gb = $grams($b);
        if ($ga === [] || $gb === []) {
            return 0.0;
        }

        $union = count(array_unique(array_merge($ga, $gb)));

        return $union > 0 ? count(array_intersect($ga, $gb)) / $union : 0.0;
    }
}
