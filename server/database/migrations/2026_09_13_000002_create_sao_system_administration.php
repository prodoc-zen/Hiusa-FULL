<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->string('organization_type', 50)->default('STUDENT_ORGANIZATION')->after('acronym');
            $table->text('description')->nullable()->after('organization_type');
            $table->string('logo_url')->nullable()->after('description');
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->string('announcement_source', 24)->default('ORGANIZATION')->after('organization_id');
            $table->foreignId('source_organization_id')->nullable()->after('announcement_source')->constrained('organizations')->nullOnDelete();
            $table->string('target_scope', 32)->nullable()->after('target_role');
            $table->json('target_organization_ids')->nullable()->after('target_scope');
            $table->json('target_departments')->nullable()->after('target_organization_ids');
            $table->json('target_roles')->nullable()->after('target_departments');
            $table->timestamp('scheduled_at')->nullable()->after('published_at');
            $table->timestamp('expires_at')->nullable()->after('scheduled_at');
            $table->index(['announcement_source', 'is_published'], 'announcements_source_published_index');
        });

        Schema::create('announcement_recipients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('announcement_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('user_id');
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->foreign('user_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->unique(['announcement_id', 'user_id']);
            $table->index(['user_id', 'announcement_id']);
        });

        $saoId = DB::table('organizations')->where('slug', 'student-affairs-office')->value('id');
        if (! $saoId) {
            $saoId = DB::table('organizations')->insertGetId([
                'name' => 'Student Affairs Office',
                'slug' => 'student-affairs-office',
                'college' => null,
                'acronym' => 'SAO',
                'organization_type' => 'SYSTEM_ADMINISTRATION',
                'description' => 'System administration office for university-wide student organization oversight.',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } else {
            DB::table('organizations')->where('id', $saoId)->update([
                'acronym' => 'SAO',
                'organization_type' => 'SYSTEM_ADMINISTRATION',
                'is_active' => true,
                'updated_at' => now(),
            ]);
        }

        // The earlier rollout promoted one administrator in every organization.
        // Keep a single director and restore all other accidental promotions to
        // normal organization administrators.
        $directorId = DB::table('users')->where('role', 'SUPER_ADMIN')->orderBy('school_id')->value('school_id');
        if ($directorId) {
            DB::table('users')->where('role', 'SUPER_ADMIN')->where('school_id', '!=', $directorId)->update(['role' => 'ADMIN']);
            DB::table('users')->where('school_id', $directorId)->update([
                'organization_id' => $saoId,
                'role' => 'SUPER_ADMIN',
                'position_title' => 'SAO Director',
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('announcement_recipients');
        Schema::table('announcements', function (Blueprint $table) {
            $table->dropIndex('announcements_source_published_index');
            $table->dropConstrainedForeignId('source_organization_id');
            $table->dropColumn(['announcement_source', 'target_scope', 'target_organization_ids', 'target_departments', 'target_roles', 'scheduled_at', 'expires_at']);
        });
        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumn(['organization_type', 'description', 'logo_url']);
        });
    }
};
