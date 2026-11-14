<?php

namespace App\Services\Ai;

/**
 * The plain meaning of the words HIUSA uses for its offices and its paperwork. Nothing here is read from a record, so
 * every role gets the same sentence; the page that goes with a term is chosen per role and checked against what the
 * role can open before it is shown.
 */
class AskAiGlossary
{
    /** @var array<string, array{title: string, aliases: array<int, string>, means: string, pages: array<string, array{0: string, 1: string}>}> */
    public const TERMS = [
        'sao' => [
            'title' => 'SAO',
            'aliases' => ['sao', 'student affairs office', 'student affairs'],
            'means' => 'SAO is the Student Affairs Office. It registers student organizations, publishes the requirements each organization has to send every semester, reviews what they send, and gives the final approval on budgets, events and financial reports.',
            'pages' => [],
        ],
        'department_head' => [
            'title' => 'Department Head',
            'aliases' => ['department head', 'department heads', 'dean', 'deans'],
            'means' => 'The Department Head, also called the dean, looks after one college. They choose which students of the college may apply to start an organization, endorse those applications to the SAO, and review the requests of the organizations in their college.',
            'pages' => [],
        ],
        'admin' => [
            'title' => 'Organization Admin',
            'aliases' => ['organization admin', 'organisation admin', 'org admin', 'organization head', 'organization heads', 'admin'],
            'means' => 'The Admin, also called the organization head, runs one student organization in HIUSA: its members, events, budget, tasks and the files it sends to the SAO. The officers work under the Admin.',
            'pages' => [],
        ],
        'officer' => [
            'title' => 'SBO Officer',
            'aliases' => ['sbo officer', 'sbo officers', 'sbo', 'officer', 'officers'],
            'means' => 'An SBO Officer is an officer of a student organization. The organization\'s Admin chooses which parts of HIUSA each officer can use.',
            'pages' => [],
        ],
        'clearance' => [
            'title' => 'Clearance',
            'aliases' => ['clearance', 'clearances'],
            'means' => 'A clearance lists the signatories who have to sign a student off, and whether each one has signed yet.',
            'pages' => [
                'STUDENT' => ['/dashboard/my-clearance', 'Open My clearance'],
                'SUPER_ADMIN' => ['/dashboard/super-admin/clearances', 'Open Clearances'],
                'ADMIN' => ['/dashboard/clearances', 'Open Clearances'],
                'SBO_OFFICER' => ['/dashboard/clearances', 'Open Clearances'],
                'DEPARTMENT_HEAD' => ['/dashboard/clearances', 'Open Clearances'],
            ],
        ],
        'accreditation' => [
            'title' => 'Accreditation',
            'aliases' => ['accreditation', 'accredited'],
            'means' => 'Accreditation is the SAO\'s recognition of a student organization for a semester. An organization keeps it by sending the compliance requirements the SAO publishes.',
            'pages' => [],
        ],
        'requirement' => [
            'title' => 'Compliance requirement',
            'aliases' => ['compliance requirement', 'compliance requirements', 'requirement', 'requirements', 'compliance'],
            'means' => 'A compliance requirement is a document every organization has to send to the SAO for the active semester, with a deadline. Compliance means having sent all of them.',
            'pages' => [
                'SUPER_ADMIN' => ['/dashboard/super-admin/compliance', 'Open Compliance'],
                'DEPARTMENT_HEAD' => ['/dashboard/department-head/compliance', 'Open College compliance'],
                'ADMIN' => ['/dashboard/compliance', 'Open Compliance'],
            ],
        ],
        'claim_token' => [
            'title' => 'Claim token',
            'aliases' => ['claim token', 'claim tokens', 'claim code', 'claim codes', 'token'],
            'means' => 'A claim token is the code that shows you paid for a merchandise order. You show it at the claim desk to receive the item, and it appears on the Claim tokens page once your payment has been verified.',
            'pages' => [
                'STUDENT' => ['/dashboard/merchandise/claim-tokens', 'Open Claim tokens'],
                'ADMIN' => ['/dashboard/merchandise/claim-tokens', 'Open Claim tokens'],
                'SBO_OFFICER' => ['/dashboard/merchandise/claim-tokens', 'Open Claim tokens'],
            ],
        ],
        'semester' => [
            'title' => 'Semester',
            'aliases' => ['semester', 'active semester', 'the semester'],
            'means' => 'The active semester is the school term HIUSA is working in. Registrations, requirements, events, budgets and elections all belong to a semester, and a closed semester stays as read-only history.',
            'pages' => [],
        ],
    ];

    /** The term a normalized question asks the meaning of, or null when it asks anything else. */
    public function lookup(string $q): ?string
    {
        foreach (self::TERMS as $key => $term) {
            $aliases = implode('|', array_map(fn (string $alias) => preg_quote($alias, '/'), $term['aliases']));
            $pattern = "/^(?:what is|what's|whats|what are|what does|what do|define|meaning of|explain|ano ang|ano po ang)(?: (?:the|a|an))? (?:{$aliases})(?: (?:mean|means|stand for|stands for|is|are|do|does))?$/";
            if (preg_match($pattern, $q) === 1) {
                return $key;
            }
        }

        return null;
    }
}
