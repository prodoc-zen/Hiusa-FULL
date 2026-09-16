<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('sbo_positions')
            ->whereIn(DB::raw('LOWER(title)'), ['adviser', 'advisor', 'organization adviser', 'organization advisor'])
            ->delete();
    }

    public function down(): void
    {
        $now = now();
        $rows = DB::table('organizations')
            ->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')
            ->pluck('id')
            ->flatMap(fn ($organizationId) => collect(['ADMIN', 'SBO_OFFICER'])->map(fn ($role) => [
                'organization_id' => $organizationId,
                'role' => $role,
                'title' => 'Adviser',
                'description' => null,
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]))
            ->all();

        if ($rows !== []) {
            DB::table('sbo_positions')->insertOrIgnore($rows);
        }
    }
};
