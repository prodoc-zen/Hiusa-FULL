<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/** The signed-in person's own recent actions, newest first, from the audit trail. */
class MyActivityController extends Controller
{
    public function __invoke(Request $request)
    {
        $logs = AuditLog::where('user_id', $request->user()->school_id)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(10, ['id', 'module', 'action', 'record_type', 'record_id', 'created_at']);

        $logs->getCollection()->transform(fn (AuditLog $log) => [
            'id' => $log->id,
            'module' => $log->module,
            'module_label' => Str::headline($log->module),
            'action_label' => Str::headline(str_replace('.', ' ', $log->action)),
            'record_label' => $log->record_type
                ? Str::headline(class_basename($log->record_type)).($log->record_id ? ' #'.$log->record_id : '')
                : null,
            'created_at' => $log->created_at?->toIso8601String(),
        ]);

        return response()->json($logs);
    }
}
