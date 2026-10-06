<?php

/**
 * Single source of truth for which client-side dashboard routes each role
 * may open, so that any href this API hands back (dashboard briefing
 * attention items, insights, agenda, activity feed) can be checked before
 * it is sent. Built directly from client/src/App.jsx's <ProtectedRoute
 * allowedRoles=[...]> declarations - keep this file and that route tree in
 * sync when either changes. tests/Feature/ClientRouteAllowlistTest.php
 * parses App.jsx on every run and fails the suite the moment the two
 * disagree, so drift here gets caught instead of shipping a dead or
 * forbidden href.
 *
 * DashboardInsightEngine and DashboardBriefingService must resolve every
 * href through App\Services\Dashboard\ClientRouteAccess::hrefFor($role,
 * $path) rather than returning a literal path, so a role that cannot open
 * a page is handed null instead of a dead or forbidden link.
 *
 * 'pending_client' lists paths that are decided but not yet wired into
 * App.jsx's route guards. They are NEVER merged into a role's live list
 * below, so ClientRouteAccess::hrefFor resolves them to null for every role
 * until a client change adds the matching <ProtectedRoute> - at which point
 * ClientRouteAllowlistTest::test_pending_client_entries_are_not_yet_live_in_app_jsx
 * starts failing and tells you to move the path out of pending_client into
 * the role's live list instead. Keeping them out of the live lists is
 * deliberate: a role's own array is exactly what App.jsx grants it today, so
 * one role's pending pages can never leak into a live href for a role
 * that has no client route for them at all.
 */

$pendingClient = [];

return [
    'SUPER_ADMIN' => [
        '/dashboard/super-admin',
        '/dashboard/super-admin/organizations',
        '/dashboard/super-admin/colleges',
        '/dashboard/super-admin/event-requirements',
        '/dashboard/super-admin/admins',
        '/dashboard/super-admin/announcements',
        '/dashboard/super-admin/notifications',
        '/dashboard/super-admin/financial-reports',
        '/dashboard/super-admin/compliance',
        '/dashboard/super-admin/venues',
        '/dashboard/super-admin/grievances',
        '/dashboard/super-admin/clearances',
        '/dashboard/super-admin/audit-logs',
        '/dashboard/super-admin/academic-years',
        '/dashboard/objectives',
        '/dashboard/profile',
    ],

    'ADMIN' => [
        '/dashboard/admin',
        '/dashboard/approvals',
        '/dashboard/approval-requests/new',
        '/dashboard/approval-requests/new/announcement',
        '/dashboard/approval-requests/new/budget',
        '/dashboard/approval-requests/new/event',
        '/dashboard/approval-requests/new/election',
        '/dashboard/admin/users',
        '/dashboard/admin/sbo-positions',
        '/dashboard/admin/positions',
        '/dashboard/admin/programs-sections',
        '/dashboard/audit-logs',
        '/dashboard/announcements/manage-announcements',
        '/dashboard/announcements/create-announcement',
        '/dashboard/announcements/view-announcements',
        '/dashboard/events/manage-events',
        '/dashboard/events/event-planner',
        '/dashboard/events/check-in',
        '/dashboard/events/activity-calendar',
        '/dashboard/finance/financial-ledger',
        '/dashboard/finance/collections',
        '/dashboard/finance/student-accounts',
        '/dashboard/finance/budget-allocation',
        '/dashboard/finance/financial-insights',
        '/dashboard/finance/transaction-history',
        '/dashboard/finance/personal-receipts',
        '/dashboard/finance/statement-of-account',
        '/dashboard/merchandise/manage-inventory',
        '/dashboard/merchandise/gcash-payment',
        '/dashboard/merchandise/manage-orders',
        '/dashboard/merchandise/claim-tokens',
        '/dashboard/merchandise/order-merchandise',
        '/dashboard/merchandise/my-orders',
        '/dashboard/tasks/task-board',
        '/dashboard/tasks/create-task',
        '/dashboard/tasks/task-progress',
        '/dashboard/tasks/ai-delegation',
        '/dashboard/compliance',
        '/dashboard/venues',
        '/dashboard/grievances',
        '/dashboard/clearances',
        '/dashboard/objectives',
        '/dashboard/profile',
        '/dashboard/elections',
        '/dashboard/elections/manage-elections',
        '/dashboard/elections/manage-candidates',
        '/dashboard/elections/manage-partylists',
        '/dashboard/elections/cast-vote',
        '/dashboard/elections/election-results',
    ],

    'SBO_OFFICER' => [
        '/dashboard/officer',
        '/dashboard/approval-requests/new',
        '/dashboard/approval-requests/new/announcement',
        '/dashboard/admin/users',
        '/dashboard/announcements/manage-announcements',
        '/dashboard/announcements/create-announcement',
        '/dashboard/announcements/view-announcements',
        '/dashboard/events/check-in',
        '/dashboard/events/activity-calendar',
        '/dashboard/finance/financial-ledger',
        '/dashboard/finance/budget-allocation',
        '/dashboard/finance/financial-insights',
        '/dashboard/finance/transaction-history',
        '/dashboard/finance/personal-receipts',
        '/dashboard/finance/statement-of-account',
        '/dashboard/merchandise/manage-orders',
        '/dashboard/merchandise/claim-tokens',
        '/dashboard/merchandise/order-merchandise',
        '/dashboard/merchandise/my-orders',
        '/dashboard/tasks/assigned-tasks',
        '/dashboard/tasks/ai-delegation',
        '/dashboard/venues',
        '/dashboard/clearances',
        '/dashboard/objectives',
        '/dashboard/profile',
        '/dashboard/elections',
        '/dashboard/elections/manage-candidates',
        '/dashboard/elections/manage-voters',
        '/dashboard/elections/cast-vote',
        '/dashboard/elections/election-results',
    ],

    'DEPARTMENT_HEAD' => [
        '/dashboard/department-head',
        '/dashboard/department-head/approvals',
        '/dashboard/approvals',
        '/dashboard/announcements/view-announcements',
        '/dashboard/events/activity-calendar',
        '/dashboard/finance/financial-ledger',
        '/dashboard/finance/budget-allocation',
        '/dashboard/finance/financial-insights',
        '/dashboard/finance/transaction-history',
        '/dashboard/merchandise/claim-tokens',
        '/dashboard/merchandise/order-merchandise',
        '/dashboard/merchandise/my-orders',
        '/dashboard/objectives',
        '/dashboard/profile',
        '/dashboard/elections',
        '/dashboard/elections/cast-vote',
        '/dashboard/elections/election-results',
    ],

    'STUDENT' => [
        '/dashboard/student',
        '/dashboard/announcements/view-announcements',
        '/dashboard/events/activity-calendar',
        '/dashboard/finance/personal-receipts',
        '/dashboard/finance/statement-of-account',
        '/dashboard/merchandise/claim-tokens',
        '/dashboard/merchandise/order-merchandise',
        '/dashboard/merchandise/my-orders',
        '/dashboard/my-grievances',
        '/dashboard/my-clearance',
        '/dashboard/objectives',
        '/dashboard/profile',
        '/dashboard/elections',
        '/dashboard/elections/cast-vote',
        '/dashboard/elections/election-results',
    ],

    'pending_client' => $pendingClient,
];
