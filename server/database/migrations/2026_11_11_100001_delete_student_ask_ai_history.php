<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * The Ask AI page replays stored answers as "Recent questions", word for word.
     * Before this release a student's answer could carry other people's school IDs ("ID #...") from the Leadership & Officers Directory.
     * Every stored row records the role the asker held when asking, and that role decided what the answer was allowed to show,
     * so every Ask AI row stored for a student goes, whether or not its text happens to show an ID.
     * Only ASK_AI_ASSISTANT rows are touched: forecasts, drafts, workflow and task outputs stay.
     */
    public function up(): void
    {
        DB::table('ai_outputs')
            ->where('feature_type', 'ASK_AI_ASSISTANT')
            ->where('structured_input->role', 'STUDENT')
            ->delete();
    }

    public function down(): void
    {
        // Deleted answers cannot be restored.
    }
};
