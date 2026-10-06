<?php

namespace App\Http\Controllers;

use App\Services\Objectives\ObjectivesEvidenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ObjectivesOverviewController extends Controller
{
    public function __invoke(Request $request, ObjectivesEvidenceService $evidence): JsonResponse
    {
        return response()->json($evidence->overview($request->user()));
    }
}
