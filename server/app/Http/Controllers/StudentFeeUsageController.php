<?php

namespace App\Http\Controllers;

use App\Services\Finance\ApprovedFeeUsage;
use Illuminate\Http\Request;

class StudentFeeUsageController extends Controller
{
    public function index(Request $request, ApprovedFeeUsage $usage)
    {
        $data = $request->validate(['report_id' => ['nullable', 'integer', 'min:1']]);

        return response()->json($usage->summaryFor($request->user(), isset($data['report_id']) ? (int) $data['report_id'] : null));
    }
}
