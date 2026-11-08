<?php

namespace App\Http\Middleware;

use App\Models\AccountProfile;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps an officer inside the areas the organization head or the dean ticked for their profile.
 * Only SBO_OFFICER profiles are limited, and only when `modules` is set; Admins and everyone
 * else pass. `org.module:finance` pins one area; plain `org.module` reads the area from the
 * first path segment so no route can be forgotten.
 */
class EnsureOrganizationModule
{
    private const SEGMENT_MODULES = [
        'users' => 'members', 'academic-structure' => 'members', 'sbo-positions' => 'members',
        'events' => 'events', 'event-requirements' => 'events', 'venues' => 'events', 'venue-bookings' => 'events', 'fingerprints' => 'events',
        'budgets' => 'finance', 'transactions' => 'finance', 'forecasts' => 'finance', 'financial-dashboard' => 'finance',
        'financial-reports' => 'finance', 'financial-semesters' => 'finance', 'collections' => 'finance', 'cash-advances' => 'finance',
        'invoices' => 'finance', 'student-debts' => 'finance',
        'tasks' => 'tasks',
        'merchandise' => 'merchandise', 'orders' => 'merchandise',
        'elections' => 'elections', 'partylists' => 'elections',
        'compliance' => 'compliance', 'clearance-periods' => 'compliance', 'clearance-signatures' => 'compliance',
        'announcements' => 'announcements',
    ];

    private const OWN_ROUTES = ['api/transactions/personal-receipts'];

    public function handle(Request $request, Closure $next, ?string $module = null): Response
    {
        $user = $request->user();
        $profile = $user?->activeProfile();

        if ($user?->role !== 'SBO_OFFICER' || ! $profile || $profile->modules === null) {
            return $next($request);
        }

        $module ??= $this->moduleFor($request);

        if ($module !== null && in_array($module, AccountProfile::MODULES, true) && ! $profile->allowsModule($module)) {
            return response()->json(['message' => 'You do not have access to this part of the organization.'], 403);
        }

        return $next($request);
    }

    private function moduleFor(Request $request): ?string
    {
        $uri = $request->route()?->uri() ?? '';

        if (in_array($uri, self::OWN_ROUTES, true)) {
            return null;
        }

        return self::SEGMENT_MODULES[explode('/', $uri)[1] ?? ''] ?? null;
    }
}
