<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // archived_by holds the SAO's school_id. It is a plain column, not a foreign key: dropping a foreign key on
        // SQLite rebuilds the table, which other tables' keys on academic_years forbid, so down() could not run there.
        Schema::table('academic_years', function (Blueprint $table) {
            $table->timestamp('archived_at')->nullable();
            $table->unsignedInteger('archived_by')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('academic_years', fn (Blueprint $table) => $table->dropColumn(['archived_at', 'archived_by']));
    }
};
