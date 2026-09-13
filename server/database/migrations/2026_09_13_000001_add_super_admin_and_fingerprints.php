<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fingerprints', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('user_id');
            $table->longText('template');
            $table->string('template_format', 100);
            $table->unsignedTinyInteger('finger_index')->default(0);
            $table->unsignedInteger('enrolled_by')->nullable();
            $table->timestamp('enrolled_at');
            $table->timestamps();

            $table->unique(['organization_id', 'user_id', 'finger_index'], 'fingerprints_org_user_finger_unique');
            $table->index(['organization_id', 'template_format'], 'fingerprints_org_format_index');
            $table->foreign('user_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('enrolled_by')->references('school_id')->on('users')->nullOnDelete();
        });

        Schema::create('fingerprint_verifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('user_id')->nullable();
            $table->unsignedInteger('performed_by')->nullable();
            $table->foreignId('event_id')->nullable()->constrained()->nullOnDelete();
            $table->string('result', 32)->index();
            $table->decimal('score', 10, 4)->nullable();
            $table->decimal('threshold', 10, 4)->nullable();
            $table->timestamp('verified_at')->index();
            $table->timestamps();

            $table->foreign('user_id')->references('school_id')->on('users')->nullOnDelete();
            $table->foreign('performed_by')->references('school_id')->on('users')->nullOnDelete();
        });

        // Every existing organization with an administrator needs a safe way
        // into the new role model immediately after deployment. Keep one root
        // account per organization by promoting its oldest active admin.
        $organizationIds = DB::table('users')
            ->where('role', 'ADMIN')
            ->where('account_status', 'active')
            ->distinct()
            ->pluck('organization_id');

        foreach ($organizationIds as $organizationId) {
            $schoolId = DB::table('users')
                ->where('organization_id', $organizationId)
                ->where('role', 'ADMIN')
                ->where('account_status', 'active')
                ->orderBy('created_at')
                ->orderBy('school_id')
                ->value('school_id');

            if ($schoolId) {
                DB::table('users')->where('school_id', $schoolId)->update([
                    'role' => 'SUPER_ADMIN',
                ]);
            }
        }

        // Budgets are financial records, so unresolved budget requests move to
        // the organization's final financial approver.
        DB::table('approval_requests')
            ->where('entity_type', 'budget')
            ->where('status', 'pending')
            ->update(['required_role' => 'SUPER_ADMIN']);
    }

    public function down(): void
    {
        DB::table('approval_requests')
            ->where('entity_type', 'budget')
            ->where('status', 'pending')
            ->where('required_role', 'SUPER_ADMIN')
            ->update(['required_role' => 'DEPARTMENT_HEAD']);

        DB::table('users')->where('role', 'SUPER_ADMIN')->update(['role' => 'ADMIN']);

        Schema::dropIfExists('fingerprint_verifications');
        Schema::dropIfExists('fingerprints');
    }
};
