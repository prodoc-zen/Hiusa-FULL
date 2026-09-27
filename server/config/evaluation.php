<?php

// Item bank for the SO1 (current governance/financial practices and problems)
// and SO4 (acceptability) evaluation instruments described in the capstone
// paper's Research Instrument section. Prompts are adapted from the three
// validated questionnaires (adviser, officer, student) in the paper's
// appendix. Codes are assigned in file order, so item order below must not
// be reshuffled once responses exist against it.
$itemCounters = [];
$makeItems = function (string $rolePrefix, string $section, array $prompts, string $type = 'likert', array $options = null, bool $required = true) use (&$itemCounters) {
    $items = [];
    $counterKey = "{$rolePrefix}-{$section}";
    $itemCounters[$counterKey] ??= 0;
    foreach ($prompts as $prompt) {
        $itemCounters[$counterKey]++;
        $items[] = [
            'code' => "{$counterKey}{$itemCounters[$counterKey]}",
            'section' => $section,
            'type' => $type,
            'prompt' => $prompt,
            'options' => $options,
            'required' => $required,
        ];
    }

    return $items;
};

$likertOptions = [
    ['value' => 5, 'label' => 'Strongly Agree'],
    ['value' => 4, 'label' => 'Agree'],
    ['value' => 3, 'label' => 'Neutral'],
    ['value' => 2, 'label' => 'Disagree'],
    ['value' => 1, 'label' => 'Strongly Disagree'],
];

$adviserItems = [
    ...$makeItems('A', 'A', ['Department / College'], 'text'),
    ...$makeItems('A', 'A', ['Student Body Organization handled'], 'text'),
    ...$makeItems('A', 'A', ['Status'], 'single_choice', [
        ['value' => 'current_adviser', 'label' => 'Current Adviser'],
        ['value' => 'former_adviser', 'label' => 'Former Adviser'],
    ]),
    ...$makeItems('A', 'A', ['Years as SBO Adviser'], 'single_choice', [
        ['value' => 'less_than_1', 'label' => 'Less than 1 year'],
        ['value' => '1_to_2', 'label' => '1 to 2 years'],
        ['value' => 'more_than_2', 'label' => 'More than 2 years'],
    ]),
    ...$makeItems('A', 'A', ['Have you previously supervised the financial, operational, or administrative activities of a Student Body Organization (SBO)?'], 'single_choice', [
        ['value' => 'yes', 'label' => 'Yes'],
        ['value' => 'no', 'label' => 'No'],
    ]),
    ...$makeItems('A', 'A', ['How do you currently monitor and receive updates regarding Student Body Organization (SBO) activities?'], 'multi_choice', [
        ['value' => 'messenger', 'label' => 'Messenger'],
        ['value' => 'facebook', 'label' => 'Facebook'],
        ['value' => 'email', 'label' => 'Email'],
        ['value' => 'google_workspace', 'label' => 'Google Workspace (Drive, Docs, Sheets)'],
        ['value' => 'microsoft_teams', 'label' => 'Microsoft Teams'],
        ['value' => 'printed_reports', 'label' => 'Printed reports/documents'],
    ]),
    ...$makeItems('A', 'B', [
        'I receive financial updates through meetings, printed reports, spreadsheets, or messaging platforms.',
        'I review proposed organizational budgets through printed documents or separate digital files submitted by officers.',
        'I receive event proposals and supporting documents through separate communication platforms (emails, messaging platforms, or shared files).',
        'I monitor event preparations through officer meetings or direct progress updates.',
        'I receive information about officer task assignments through meetings or group chats.',
        'I monitor task completion by requesting progress reports from officers.',
        'I receive information about election procedures from the election committee or organization officers.',
        'I review election results through reports submitted after vote counting.',
        'I receive merchandise order records through spreadsheets, written records, or messages.',
        'I review merchandise inventory using reports prepared by assigned officers.',
        'I review official announcements through chats, meetings, or shared documents before they are released.',
        'I receive organizational progress updates through meetings, written reports, or group conversations.',
        'Financial records from previous officers are not always properly preserved during leadership transitions.',
        'Supporting documents for financial transactions are difficult to verify under the current process.',
        'Event plans and related documents are stored across different files or platforms, making them difficult to review.',
        'The current process limits my ability to monitor event progress between officer meetings.',
        'Attendance and participation records are not always readily available for my review after an event.',
        'I have insufficient oversight of how tasks and responsibilities are delegated among officers.',
        'Unequal workloads among officers are difficult to identify under the current process.',
        'The current election process provides limited transparency for proper adviser oversight.',
        'I have limited means of confirming whether the election process prevents duplicate voting.',
        'I have limited visibility into the available stock of Student Body Organization merchandise.',
        'The current process makes it difficult to track an order from reservation to item release.',
        'Pending or unclaimed merchandise orders are not easily identified.',
        'Announcements shared through different platforms may contain inconsistent information.',
        'I find it difficult to verify whether an announcement has been approved before publication.',
        'It is difficult to identify operational problems early because organizational information is scattered across different sources.',
        'Important organizational procedures, decisions, and records are not always preserved when leadership changes.',
        'Incomplete or conflicting records make it difficult to determine responsibility when organizational issues occur.',
    ], 'likert', $likertOptions),
    ...$makeItems('A', 'C', [
        'The system should analyze historical financial transactions to estimate future organizational income and expenses. (OLS Linear Regression - financial forecasting)',
        'The system should use financial forecasts and existing budget records to identify possible overspending. (Budget Advisory System - rule-based financial recommendations)',
        'The system should present financial forecasts and budget recommendations in a clear and understandable format. (Groq LLM and Explainable AI - financial explanation)',
        'The system should generate suggested timelines, resource requirements, and preparation checklists based on event details. (Groq LLM - AI-assisted event planning)',
        'The system should verify student attendance through fingerprint identification during organizational activities. (Biometric identification - DigitalPersona 4500)',
        'The system should recommend suitable officers for tasks based on their assigned roles, current workload, and previous performance. (Rule-Based Weighted Scoring Algorithm - task delegation)',
        'The system should generate an organized sequence of tasks and deadlines for each event or activity. (Workflow Automation - task and process generation)',
        'The system should prevent an eligible student from submitting more than one vote during an election. (One-student-one-vote validation - duplicate-vote prevention)',
        'The system should automatically count valid votes after the election period. (Automated vote tallying - election result generation)',
        'A unique claim token will create a verifiable record for each merchandise release. (Tokenized Queue System - claim verification)',
        'Automatic inventory updates will improve the accuracy of recorded stock levels. (Dynamic Inventory Tracking - real-time stock monitoring)',
        'AI-assisted announcement drafting will help advisers review clearer and more complete announcement content. (Groq LLM - AI-assisted announcement drafting)',
        'A centralized announcement channel will help reduce conflicting information from different platforms.',
    ], 'likert', $likertOptions),
    ...$makeItems('A', 'D', [
        'The Automated Digital Ledger and Transaction History Dashboard of HIUSA will provide advisers with an updated and searchable record of organizational transactions.',
        'The Auto-Generated Financial Reports feature of HIUSA will make organization-wide and event-specific financial records easier to review.',
        'The Budget Advisory feature of HIUSA will help advisers identify possible overspending before additional expenses are approved.',
        'The Event Planner feature of HIUSA will provide advisers with a centralized view of event preparation and status.',
        'The Attendance Tracking feature of HIUSA will provide advisers with reliable records of student participation.',
        'The Task Delegation feature of HIUSA will show how responsibilities are assigned among officers.',
        'The Task Progress feature of HIUSA will help advisers identify delayed or unfinished responsibilities.',
        'The Candidate and Party-list Management feature of HIUSA will provide an organized record of official election candidates.',
        'The Election Results Dashboard of HIUSA will provide a clear record of the final vote count.',
        'The Inventory feature of HIUSA will provide advisers with updated information about available merchandise stocks.',
        'The Claim Token Verification feature of HIUSA will provide a verifiable record of each merchandise release.',
        'The Announcement Approval feature of HIUSA will allow authorized users to review official announcements before publication.',
        'The Notification feature of HIUSA will provide timely updates about important organizational activities.',
    ], 'likert', $likertOptions),
    ...$makeItems('A', 'E', [
        'HIUSA is easy to use and navigate.',
        'HIUSA improves the efficiency of monitoring Student Body Organization operations.',
        'HIUSA provides accurate and updated information for adviser review.',
        'HIUSA is a reliable system for supporting adviser oversight of Student Body Organization activities.',
        'The overall performance of HIUSA meets my needs as a Student Body Organization adviser.',
        'I am satisfied with the features and functions provided by HIUSA.',
        'HIUSA helps me review organizational records and activities more effectively.',
        'HIUSA has the potential to replace the fragmented use of manual records and separate digital platforms.',
        'I would recommend HIUSA to other Student Body Organizations and their advisers.',
        'I provided careful, truthful, and consistent responses regarding the proposed system.',
        'Some of my responses in this section may not accurately reflect my true opinion regarding the proposed system.',
        'Overall, HIUSA is acceptable for supporting Student Body Organization governance and management.',
    ], 'likert', $likertOptions),
    ...$makeItems('A', 'F', ['What suggestions or recommendations do you have for HIUSA (features to add, change, or remove; problems needing attention; or other comments)?'], 'text', null, false),
];

$officerItems = [
    ...$makeItems('O', 'A', ['Your Full Name (optional)'], 'text', null, false),
    ...$makeItems('O', 'A', ['Student Body Organization'], 'text'),
    ...$makeItems('O', 'A', ['Position held'], 'text'),
    ...$makeItems('O', 'A', ['Status'], 'single_choice', [
        ['value' => 'current_officer', 'label' => 'Current Officer'],
        ['value' => 'former_officer', 'label' => 'Former Officer'],
    ]),
    ...$makeItems('O', 'A', ['Years of Service'], 'single_choice', [
        ['value' => 'less_than_1', 'label' => 'Less than 1 year'],
        ['value' => '1_to_2', 'label' => '1 to 2 years'],
        ['value' => 'more_than_2', 'label' => 'More than 2 years'],
    ]),
    ...$makeItems('O', 'B', [
        'I record financial transactions using paper records, spreadsheets, or separate digital files.',
        'I monitor organizational budgets using reports or files prepared by officers.',
        'I plan organizational events through meetings, group chats, or shared documents.',
        'I record student attendance using paper lists or separate attendance tools.',
        'I receive task assignments through meetings, verbal instructions, or messaging platforms.',
        'I report the progress of my assigned tasks through messages, meetings, or separate documents.',
        'I manage candidate or voter information using written records or separate digital files.',
        'I receive election results after votes have been manually counted or processed through a separate tool.',
        'I track merchandise stock using spreadsheets or written inventory records.',
        'I verify merchandise orders and payments using receipts, messages, or separate records.',
        'I prepare or review organizational announcements through messaging platforms or shared documents.',
        'I distribute organizational updates through group chats, social media, or email.',
        'I have limited access to updated information about the organization\'s available funds.',
        'Preparing financial reports requires substantial manual work.',
        'Event plans and supporting documents are scattered across different files or platforms.',
        'Manual attendance recording makes it difficult to maintain complete participation records.',
        'Task assignments are not always documented and assigned clearly.',
        'Unequal workloads among officers are difficult to identify under the current process.',
        'It is difficult to verify whether only eligible students participate in an election.',
        'Manual or separate vote-counting methods delay the availability of final election results.',
        'Merchandise stock records are not always updated after orders or item releases.',
        'Matching merchandise payments with their corresponding orders requires manual checking.',
        'Announcements shared through different platforms may contain inconsistent information.',
        'It is difficult to confirm whether organizational updates have reached their intended recipients.',
        'Using separate platforms causes the same organizational information to be recorded more than once.',
        'Important organizational records are not always preserved when officer leadership changes.',
        'Incomplete records make it difficult to determine accountability when organizational problems occur.',
    ], 'likert', $likertOptions),
    ...$makeItems('O', 'C', [
        'The system should use historical transaction data and current budget records to generate responsible spending recommendations. (OLS Linear Regression and Budget Advisory System - financial forecasting and decision support)',
        'The system should explain financial forecasts and budget recommendations in a clear and understandable format. (Groq LLM and Explainable AI - interpretation of financial insights)',
        'The system should generate suggested timelines, resource needs, and preparation checklists based on the details of an event. (Groq LLM - AI-assisted Event Planning Assistant)',
        'The system should use fingerprint verification to record student attendance during organizational activities. (Biometric Identification - DigitalPersona 4500 Fingerprint Reader)',
        'The system should recommend suitable officers for tasks based on their roles, current workloads, and previous performance. (Rule-Based Weighted Scoring Algorithm - AI-assisted task delegation)',
        'The system should generate an organized sequence of tasks and deadlines for each event or organizational activity. (Workflow Automation - task and process generation)',
        'The system should allow each authenticated and eligible student to submit only one vote during an election. (One-student-one-vote validation - duplicate-vote prevention)',
        'The system should automatically count valid votes after the approved election period ends. (Automated Vote Tallying - election result generation)',
        'The system should generate a unique claim token for each approved merchandise reservation. (Tokenized Queue System - merchandise claim verification)',
        'The system should automatically update stock records when merchandise is reserved, cancelled, or released. (Dynamic Inventory Tracking - real-time stock monitoring)',
        'The system should assist officers in preparing clear and organized announcement drafts. (Groq LLM - AI-assisted announcement drafting)',
        'The system should require authorized review before an official announcement is published. (Announcement Approval Workflow - content review and authorization)',
    ], 'likert', $likertOptions),
    ...$makeItems('O', 'D', [
        'The Automated Digital Ledger feature of HIUSA will provide officers with an updated and traceable record of organizational transactions.',
        'The Auto-Generated Financial Reports feature of HIUSA will reduce the manual effort required to prepare organization-wide and event-specific financial reports.',
        'The Event Planner feature of HIUSA will organize event schedules, requirements, and preparation details in one location.',
        'The Attendance Tracking feature of HIUSA will provide officers with a reliable record of student participation in organizational activities.',
        'The Task Delegation feature of HIUSA will provide officers with a clear basis for assigning organizational responsibilities.',
        'The Task Progress feature of HIUSA will help officers monitor deadlines and identify unfinished responsibilities.',
        'The Election Management feature of HIUSA will organize official candidate and election-period information in one location.',
        'The Election Results Dashboard of HIUSA will provide officers with a clear presentation of the final vote count.',
        'The Inventory feature of HIUSA will provide officers with updated information about available merchandise stock.',
        'The Order and Fulfillment feature of HIUSA will allow officers to track each merchandise order from reservation to item release.',
        'The Announcement Management feature of HIUSA will provide one official location for preparing and managing organizational announcements.',
        'The Notification feature of HIUSA will provide officers with timely updates about events, task deadlines, and organizational activities.',
    ], 'likert', $likertOptions),
    ...$makeItems('O', 'E', [
        'HIUSA is easy to use and navigate.',
        'The Officer Dashboard of HIUSA presents the organizational information relevant to my assigned responsibilities.',
        'HIUSA improves the efficiency of completing my responsibilities as a Student Body Organization officer.',
        'HIUSA improves coordination among Student Body Organization officers.',
        'HIUSA provides accurate and updated organizational records.',
        'HIUSA performs its functions reliably during normal organizational operations.',
        'HIUSA provides appropriate access to functions based on my assigned officer role.',
        'HIUSA provides a more organized way of managing records that are currently stored across separate files and platforms.',
        'I am satisfied with the features and functions provided by HIUSA.',
        'The overall performance of HIUSA meets my needs as a Student Body Organization officer.',
        'I would recommend HIUSA to other Student Body Organizations and their officers.',
        'Overall, HIUSA is acceptable for managing Student Body Organization operations.',
        'I provided careful, truthful, and consistent responses regarding the proposed system.',
        'Some of my responses in this section may not accurately reflect my true opinion regarding the proposed system.',
    ], 'likert', $likertOptions),
    ...$makeItems('O', 'F', ['What suggestions or recommendations do you have for HIUSA (features to add, change, or remove; problems needing attention; or other comments)?'], 'text', null, false),
];

$studentItems = [
    ...$makeItems('S', 'A', ['Program / Department'], 'text'),
    ...$makeItems('S', 'A', ['Year Level'], 'single_choice', [
        ['value' => 'first_year', 'label' => 'First Year'],
        ['value' => 'second_year', 'label' => 'Second Year'],
        ['value' => 'third_year', 'label' => 'Third Year'],
        ['value' => 'fourth_year', 'label' => 'Fourth Year'],
        ['value' => 'other', 'label' => 'Other (Basic Education / Senior High)'],
    ]),
    ...$makeItems('S', 'A', ['Are you currently a member of a recognized Student Body Organization? (You are a member if you have paid the membership fee.)'], 'single_choice', [
        ['value' => 'yes', 'label' => 'Yes'],
        ['value' => 'no', 'label' => 'No'],
    ]),
    ...$makeItems('S', 'A', ['If yes, which Student Body Organization?'], 'text', null, false),
    ...$makeItems('S', 'B', [
        'I receive Student Body Organization announcements through social media, messaging applications, or email.',
        'I check separate platforms to look for changes in organizational schedules or activities.',
        'I learn about upcoming organizational events through posts, group chats, or verbal updates.',
        'My attendance at organizational activities is recorded through paper lists, online forms, or other separate methods.',
        'I receive candidate and party-list information through posters, social media, or separate documents.',
        'I cast my vote through paper ballots, online forms, or a separate voting platform.',
        'I ask officers about available merchandise through messages or face-to-face communication.',
        'I submit merchandise orders through chats, online forms, or written lists.',
        'I contact an officer to ask about the payment or claim status of my merchandise order.',
        'I use different platforms depending on the Student Body Organization service I need.',
        'I sometimes miss important announcements because updates are posted on different platforms.',
        'Information about the same organizational activity may differ across communication channels.',
        'Previous organizational announcements are difficult to find when I need them.',
        'Complete event details are not always available in one place.',
        'Changes to event schedules are not always communicated to me promptly.',
        'The current attendance process makes it difficult to confirm whether my participation was recorded correctly.',
        'Candidate and party-list information is not always presented in an organized manner.',
        'I do not always receive clear confirmation that my vote has been recorded.',
        'Final election results are not always available promptly after voting.',
        'I cannot easily confirm whether a merchandise item is still available before ordering.',
        'I cannot easily track the current status of my merchandise order.',
        'Confirmation of merchandise payments may take longer than expected.',
        'The current claiming process does not always provide a clear reference for my order.',
        'Using different platforms makes Student Body Organization services inconvenient to access.',
    ], 'likert', $likertOptions),
    ...$makeItems('S', 'C', [
        'The system should organize approved Student Body Organization events in one activity calendar. (Centralized Activity Calendar - event information access)',
        'The system should notify students about new events and approaching schedules. (Automated Notification System - timely event updates)',
        'The system should use fingerprint verification to record student attendance during organizational activities. (Biometric Identification - DigitalPersona 4500 Fingerprint Reader)',
        'The system should require students to sign in before accessing an active election. (User Authentication - controlled election access)',
        'The system should allow each eligible student to submit only one vote during an election. (One-Student-One-Vote Validation - duplicate-vote prevention)',
        'The system should automatically count valid votes after the election period ends. (Automated Vote Tallying - election result generation)',
        'The system should display the current availability of merchandise before a student places an order. (Dynamic Inventory Tracking - real-time stock information)',
        'The system should allow students to reserve available merchandise online. (Online Pre-Ordering System - digital merchandise reservation)',
        'The system should allow students to submit proof of GCash payment for officer verification. (Digital Payment Verification - payment confirmation)',
        'The system should generate a unique claim token for each approved merchandise order. (Tokenized Queue System - merchandise claim verification)',
        'The system should automatically update the status of each merchandise order. (Order Status Tracking - pending, paid, and completed records)',
        'The system should display published announcements in one searchable location. (Centralized Announcement Feed - organized information access)',
        'The system should limit student access to functions and information intended for the Student role. (Role-Based Access Control - controlled system access)',
    ], 'likert', $likertOptions),
    ...$makeItems('S', 'D', [
        'The Student Dashboard of HIUSA will provide one place for viewing my current organizational updates and activities.',
        'The Announcement Feed of HIUSA will provide students with one official source of organizational information.',
        'The Notification feature of HIUSA will provide timely updates about important organizational activities.',
        'The Activity Calendar of HIUSA will help students view upcoming Student Body Organization events.',
        'The Attendance Tracking feature of HIUSA will provide students with a reliable record of their event participation.',
        'The Digital Voting feature of HIUSA will provide students with a convenient way to participate in organizational elections.',
        'The Candidate and Party-list feature of HIUSA will present official election choices in an organized manner.',
        'The Election Results Dashboard of HIUSA will provide students with a clear presentation of the final election results.',
        'The Merchandise Catalog of HIUSA will display available items, prices, and stock information.',
        'The Online Reservation feature of HIUSA will allow students to reserve merchandise without submitting orders through separate platforms.',
        'The My Orders feature of HIUSA will allow students to monitor the status of their merchandise orders.',
        'The Claim Token feature of HIUSA will provide students with a unique reference when claiming merchandise.',
        'The Digital Receipt feature of HIUSA will provide students with a record of their completed payment transactions.',
    ], 'likert', $likertOptions),
    ...$makeItems('S', 'E', [
        'HIUSA is easy to use and navigate.',
        'The Student Dashboard of HIUSA presents the organizational information relevant to me as a student.',
        'HIUSA makes official Student Body Organization announcements easier to access.',
        'HIUSA makes it easier for me to participate in organizational events.',
        'HIUSA provides a convenient way to participate in Student Body Organization elections.',
        'HIUSA provides an organized merchandise-ordering experience.',
        'HIUSA provides accurate and updated organizational information.',
        'HIUSA performs its functions reliably during normal use.',
        'HIUSA reduces the need to use multiple platforms for Student Body Organization services.',
        'HIUSA limits my access to the functions intended for students.',
        'The overall performance of HIUSA meets my needs as a student.',
        'I am satisfied with the features and functions available to students in HIUSA.',
        'I would recommend HIUSA to other students.',
        'I provided careful, truthful, and consistent responses regarding the proposed system.',
        'Some of my responses in this section may not accurately reflect my true opinion regarding the proposed system.',
    ], 'likert', $likertOptions),
    ...$makeItems('S', 'F', ['What suggestions or recommendations do you have for HIUSA (features to add, change, or remove; problems needing attention; or other comments)?'], 'text', null, false),
];

return [
    // Maps a HIUSA account role to the evaluation instrument it answers.
    // SUPER_ADMIN is intentionally absent: the SAO director configures and
    // reads results but does not respond as a study participant.
    'role_instruments' => [
        'STUDENT' => 'student',
        'SBO_OFFICER' => 'officer',
        'ADMIN' => 'officer',
        'DEPARTMENT_HEAD' => 'adviser',
    ],

    'sections' => [
        'A' => ['label' => 'Profile', 'objective' => null],
        'B' => ['label' => 'Current Process and Problems Encountered', 'objective' => 'SO1'],
        'C' => ['label' => 'Mechanism or Techniques of the Proposed System', 'objective' => 'SO2'],
        'D' => ['label' => 'Top/Key Features of the Proposed System (HIUSA)', 'objective' => 'SO3'],
        'E' => ['label' => 'Level of Acceptability of the Proposed System (HIUSA)', 'objective' => 'SO4'],
        'F' => ['label' => 'Recommendations', 'objective' => null],
    ],

    'instruments' => [
        'adviser' => [
            'label' => 'Adviser Questionnaire',
            'items' => $adviserItems,
        ],
        'officer' => [
            'label' => 'Officer Questionnaire',
            'items' => $officerItems,
        ],
        'student' => [
            'label' => 'Student Questionnaire',
            'items' => $studentItems,
        ],
    ],

    // Table 3 (Likert Scale interpretation) from the capstone paper's
    // Research Design > Statistical Treatment of Data section.
    'likert_labels' => [
        ['min' => 4.21, 'max' => 5.00, 'label' => 'Strongly Agreed'],
        ['min' => 3.41, 'max' => 4.20, 'label' => 'Agreed'],
        ['min' => 2.61, 'max' => 3.40, 'label' => 'Undecided'],
        ['min' => 1.81, 'max' => 2.60, 'label' => 'Disagreed'],
        ['min' => 1.00, 'max' => 1.80, 'label' => 'Strongly Disagreed'],
    ],

    // Ethical Considerations (paper): responses are reported only in
    // aggregate. A group (per organization + respondent_type, or per an
    // arbitrary filtered slice) smaller than this is never shown a mean,
    // a distribution, or any open-ended feedback text.
    'anonymity_threshold' => 3,
];
