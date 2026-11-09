<?php

namespace App\Http\Middleware;

use App\Models\AcademicSemester;
use App\Models\Election;
use App\Models\Event;
use App\Models\Task;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * period.writable[:event|task|election[,voter]]
 *
 * Blocks a write while the selected school year period is closed. With a row type it also looks up the row the
 * route names (inside the caller's organization, 404 otherwise) and blocks edits to a row that belongs to a
 * closed semester. Rows of a semester that has not started stay editable, so planning ahead works. `election,voter`
 * looks the election up among every organization the caller votes in, for the ballot route.
 */
class EnsurePeriodWritable
{
    public const CLOSED = 'This school year is closed. Its records are read only.';

    public function handle(Request $request, Closure $next, ?string $row = null, ?string $as = null): Response
    {
        $record = null;
        if ($row !== null) {
            $record = $this->find($request, $row, $as);
            if (! $record) {
                return response()->json(['message' => ucfirst($row).' not found.'], 404);
            }
        }

        if (AcademicSemester::selected($request)?->status === 'completed' || ($record && AcademicSemester::isClosed($record->academic_semester_id))) {
            return response()->json(['message' => self::CLOSED], 409);
        }

        return $next($request);
    }

    private function find(Request $request, string $row, ?string $as): ?object
    {
        $organizationId = $request->user()->organization_id;
        // A voter reaches the elections of every organization they vote in, not only the workspace they are signed in to.
        $electionOrganizationIds = $as === 'voter' ? $request->user()->votingOrganizationIds() : [$organizationId];

        return match ($row) {
            'event' => Event::where('organization_id', $organizationId)->find($this->eventId($request)),
            'task' => Task::where('organization_id', $organizationId)->find($request->route('id')),
            'election' => Election::whereIn('organization_id', $electionOrganizationIds)->find($request->route('id')),
        };
    }

    private function eventId(Request $request): mixed
    {
        $id = $request->route('event') ?? $request->route('id');

        return $id instanceof Event ? $id->id : $id;
    }
}
