<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->timestamp('access_handed_over_at')->nullable();
        });

        // Elections that closed before this release already had their officers set by hand.
        // Marking them done keeps a later results toggle from replacing today's officers.
        DB::table('elections')->where('status', 'closed')->update(['access_handed_over_at' => now()]);
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn('access_handed_over_at');
        });
    }
};
