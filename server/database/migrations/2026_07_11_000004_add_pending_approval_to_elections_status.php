<?php

use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        // Intentionally empty: the reference SQL patch does not add pending_approval to elections.status.
    }

    public function down(): void
    {
        // Intentionally empty.
    }
};
