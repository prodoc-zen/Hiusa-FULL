<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /** Positions whose holders are organization-level administrators. */
    private const LEADERSHIP_POSITIONS = [
        'President',
        'Vice President â€“ Internal',
        'Vice President â€“ External',
        'Secretary',
        'Adviser',
    ];

    public function up(): void
    {
        // A President, Vice President, Secretary, and Adviser are each normal
        // Admins for their own organization. This does not affect the SAO
        // Director or grant any one organization access to another.
        DB::table('users')
            ->where('role', 'SBO_OFFICER')
            ->whereIn('position_title', self::LEADERSHIP_POSITIONS)
            ->whereIn('organization_id', DB::table('organizations')
                ->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')
                ->select('id'))
            ->update(['role' => 'ADMIN']);
    }

    public function down(): void
    {
        // Role changes are intentional account promotions. Do not silently
        // remove organization administration privileges on rollback.
    }
};
