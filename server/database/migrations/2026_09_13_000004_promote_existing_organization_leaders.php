<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')
            ->where('role', 'SBO_OFFICER')
            ->where(function ($query) {
                $query->whereIn('position_title', ['President', 'Secretary', 'Adviser'])
                    ->orWhere('position_title', 'like', 'Vice President%');
            })
            ->whereIn('organization_id', DB::table('organizations')
                ->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')
                ->select('id'))
            ->update(['role' => 'ADMIN']);
    }

    public function down(): void
    {
        // Leadership promotions are intentional access changes and are not
        // silently revoked during rollback.
    }
};
