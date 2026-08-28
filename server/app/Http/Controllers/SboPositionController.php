<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\SboPosition;
use Illuminate\Http\Request;

class SboPositionController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(SboPosition::where('organization_id', $request->user()->organization_id)->orderBy('title')->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate(['title' => ['required', 'string', 'max:100'], 'description' => ['nullable', 'string', 'max:2000'], 'is_active' => ['nullable', 'boolean']]);
        $row = SboPosition::create([...$data, 'organization_id' => $request->user()->organization_id]);
        AuditLog::create(['organization_id' => $request->user()->organization_id, 'user_id' => $request->user()->school_id, 'module' => 'sbo_positions', 'action' => 'created', 'record_type' => SboPosition::class, 'record_id' => $row->id, 'new_values' => $row->getAttributes(), 'ip_address' => $request->ip(), 'created_at' => now()]);

        return response()->json($row, 201);
    }

    public function update(Request $request, SboPosition $position)
    {
        abort_unless($position->organization_id === $request->user()->organization_id, 404);
        $old = $position->getAttributes();
        $data = $request->validate(['title' => ['sometimes', 'required', 'string', 'max:100'], 'description' => ['nullable', 'string', 'max:2000'], 'is_active' => ['nullable', 'boolean']]);
        $position->update($data);
        AuditLog::create(['organization_id' => $position->organization_id, 'user_id' => $request->user()->school_id, 'module' => 'sbo_positions', 'action' => 'updated', 'record_type' => SboPosition::class, 'record_id' => $position->id, 'old_values' => $old, 'new_values' => $position->fresh()->getAttributes(), 'ip_address' => $request->ip(), 'created_at' => now()]);

        return response()->json($position->fresh());
    }
}
