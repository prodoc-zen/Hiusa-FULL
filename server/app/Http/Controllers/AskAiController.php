<?php

namespace App\Http\Controllers;

use App\Services\Ai\AskAiService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AskAiController extends Controller
{
    public function __construct(private readonly AskAiService $askAi) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->askAi->overview($request->user()));
    }

    public function ask(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'question' => ['required', 'string', 'min:2', 'max:500'],
            'topic' => ['nullable', 'string', 'max:60'],
        ]);

        return response()->json(
            $this->askAi->ask(
                $request->user(),
                $validated['question'],
                $validated['topic'] ?? null
            )
        );
    }
}

