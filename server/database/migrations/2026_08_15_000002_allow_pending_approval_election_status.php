<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            DB::statement("ALTER TABLE elections MODIFY status ENUM('upcoming', 'active', 'closed', 'pending_approval') NOT NULL DEFAULT 'upcoming'");
        }
    }

    public function down(): void
    {
        if (in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            DB::statement("UPDATE elections SET status = 'upcoming' WHERE status = 'pending_approval'");
            DB::statement("ALTER TABLE elections MODIFY status ENUM('upcoming', 'active', 'closed') NOT NULL DEFAULT 'upcoming'");
        }
    }
};
