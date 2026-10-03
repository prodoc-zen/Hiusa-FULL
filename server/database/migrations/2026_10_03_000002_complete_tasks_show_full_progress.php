<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    // Completed tasks seeded or imported before the completion rule existed show 0% done.
    public function up(): void
    {
        DB::table('tasks')->where('status', 'completed')->where('progress_percent', '<', 100)->update(['progress_percent' => 100]);
        DB::table('tasks')->where('status', 'completed')->whereNull('completed_at')->update(['completed_at' => DB::raw('updated_at')]);
    }

    public function down(): void {}
};
