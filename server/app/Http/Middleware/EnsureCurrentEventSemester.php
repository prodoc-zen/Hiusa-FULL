<?php

namespace App\Http\Middleware;

use App\Models\AcademicSemester;
use App\Models\Event;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureCurrentEventSemester
{
    public function handle(Request $request, Closure $next): Response
    {
        $id = $request->route('event') ?? $request->route('id');
        $id = $id instanceof Event ? $id->id : $id;
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }
        if ($event->academic_semester_id && $event->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Historical semester events are read only.'], 409);
        }

        return $next($request);
    }
}
