<?php

namespace App\Http\Controllers;

use App\Services\Dashboard\DashboardBriefingService;
use Illuminate\Http\Request;

/**
 * Role-aware dashboard briefing that feeds every role's home screen from one
 * endpoint.
 *
 * GET /api/dashboard/briefing (auth:sanctum, all five roles)
 *
 * Response shape (see docs/api/dashboard-briefing.md for the full contract):
 * {
 *   user: { first_name, role, organization: {id, name, abbreviation, logo_url}|null },
 *   summary: { attention_count, headline },
 *   attention: [{ id, type, severity: high|medium|low, title, detail, due_at|null, href }, ...] (max 8),
 *   pillars: { finance?, events?, tasks?, elections?, merchandise?, communication? }
 *     - only the areas relevant to the caller's role, each shaped
 *       { value, unit, label, context, delta?: {value, period, direction}, meter?: {value, limit} },
 *   insights: [{ engine, title, body, why: {method, inputs, formula}, generated_at, href }, ...] (0-3),
 *   agenda: [{ id, title, starts_at, location|null, href }, ...] (max 5),
 *   activity: [{ id, actor, action, subject, at, href|null }, ...] (max 8),
 *   organizations: [...] (SUPER_ADMIN only),
 * }
 *
 * Strictly organization-scoped for every role except SUPER_ADMIN, who sees
 * the whole university. Money is returned as plain numbers, never formatted
 * strings; timestamps are ISO 8601.
 */
class DashboardBriefingController extends Controller
{
    public function __construct(private readonly DashboardBriefingService $briefing) {}

    public function index(Request $request)
    {
        return response()->json($this->briefing->build($request->user()));
    }
}
