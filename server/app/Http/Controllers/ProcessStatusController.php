<?php

namespace App\Http\Controllers;

use App\Services\Dashboard\ProcessStatusService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The signed-in person's place in the setup flow for their role. */
class ProcessStatusController extends Controller
{
    public function show(Request $request, ProcessStatusService $service): JsonResponse
    {
        return response()->json($service->forUser($request->user()))->header('Cache-Control', 'no-store, private');
    }
}
