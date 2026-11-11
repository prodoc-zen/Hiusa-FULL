<?php

namespace App\Http\Controllers;

use App\Models\FinancialSemester;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FinancialSemesterController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(FinancialSemester::where('organization_id', $request->user()->organization_id)
            ->orderByDesc('starts_on')->get());
    }

    public function store(Request $request)
    {
        $organizationId = $request->user()->organization_id;
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100', Rule::unique('financial_semesters')->where('organization_id', $organizationId)],
            'starts_on' => ['required', 'date', 'before_or_equal:today'],
            'ends_on' => ['nullable', 'date', 'after_or_equal:starts_on'],
        ], [
            'name.unique' => 'A semester with this name already exists.',
            'starts_on.before_or_equal' => 'The start date cannot be in the future.',
            'ends_on.after_or_equal' => 'The end date cannot be before the start date.',
        ]);

        $semester = FinancialSemester::create([
            ...$data,
            'organization_id' => $organizationId,
            'ends_on' => $data['ends_on'] ?? today()->toDateString(),
        ]);

        return response()->json($semester, 201);
    }
}
