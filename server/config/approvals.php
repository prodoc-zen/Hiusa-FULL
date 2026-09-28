<?php

return [
    'routes' => [
        'announcement' => 'ADMIN',
        'budget' => 'DEPARTMENT_HEAD',
        'event' => 'DEPARTMENT_HEAD',
        'election' => 'DEPARTMENT_HEAD',
        'payment' => 'ADMIN',
        'financial_report' => 'DEPARTMENT_HEAD',
    ],

    // Budget approval is single-stage by Department Head by default (paper M6.6, Fig. 43).
    // Set this to 'SUPER_ADMIN' to re-enable the SAO second stage on top of the Department
    // Head approval. Setting 'routes.budget' above to 'ADMIN' instead restores the
    // collaborator's in-organization routing (Admin approves, no separate SAO stage).
    'budget_final' => null,
];
