<?php

namespace App\Http\Middleware;

use App\Models\AcademicSemester;
use App\Models\Election;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureCurrentElectionSemester
{
    public function handle(Request $request, Closure $next): Response
    {
        $election = Election::where('organization_id', $request->user()->organization_id)
            ->find($request->route('id'));
        if (! $election) {
            return response()->json(['message' => 'Election not found.'], 404);
        }
        if ($election->academic_semester_id && $election->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Historical semester elections are read only.'], 409);
        }

        return $next($request);
    }
}
