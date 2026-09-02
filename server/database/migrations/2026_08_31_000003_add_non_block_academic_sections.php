<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $now = now();
        DB::table('academic_programs')->orderBy('id')->each(function ($program) use ($now) {
            foreach ([1, 2, 3, 4] as $yearLevel) {
                DB::table('academic_sections')->insertOrIgnore([
                    'academic_program_id' => $program->id,
                    'year_level' => $yearLevel,
                    'name' => "{$yearLevel} - Non Block",
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        });
    }

    public function down(): void
    {
        DB::table('academic_sections')->whereIn('name', [
            '1 - Non Block', '2 - Non Block', '3 - Non Block', '4 - Non Block',
        ])->delete();
    }
};
