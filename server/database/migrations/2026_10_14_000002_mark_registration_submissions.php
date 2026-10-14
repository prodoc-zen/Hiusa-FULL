<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organization_compliance_submissions', function (Blueprint $table) {
            $table->boolean('is_registration_document')->default(false);
        });
        DB::table('organization_compliance_submissions as s')
            ->join('organizations as o', 'o.id', '=', 's.organization_id')
            ->where(function ($query) {
                $query->whereIn('o.lifecycle_status', ['pending', 'returned'])
                    ->orWhere(fn ($reviewed) => $reviewed->whereNotNull('o.submitted_at')->whereNotNull('o.reviewed_at')->whereColumn('s.submitted_at', '<=', 'o.reviewed_at'));
            })
            ->update(['s.is_registration_document' => true]);
    }

    public function down(): void
    {
        Schema::table('organization_compliance_submissions', function (Blueprint $table) {
            $table->dropColumn('is_registration_document');
        });
    }
};
