<?php

namespace App\Http\Middleware;

use App\Models\AcademicSemester;
use App\Models\Task;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureCurrentTaskSemester
{
    public function handle(Request $request, Closure $next): Response
    {
        $task = Task::where('organization_id', $request->user()->organization_id)->find($request->route('id'));
        if (! $task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }
        if ($task->academic_semester_id && $task->academic_semester_id !== AcademicSemester::active()?->id) {
            return response()->json(['message' => 'Historical semester tasks are read only.'], 409);
        }

        return $next($request);
    }
}
