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
            $table->foreignId('parent_organization_id')->nullable()->constrained('organizations')->restrictOnDelete();
        });

        Schema::create('account_profiles', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_school_id');
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('role', 32);
            $table->string('account_status', 16)->default('active');
            $table->string('position_title', 100)->nullable();
            $table->timestamps();
            $table->foreign('user_school_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->unique(['user_school_id', 'organization_id']);
            $table->index(['organization_id', 'role']);
        });

        DB::table('users')->orderBy('school_id')->chunk(500, function ($users) {
            DB::table('account_profiles')->insert($users->map(fn ($user) => [
                'user_school_id' => $user->school_id,
                'organization_id' => $user->organization_id,
                'role' => $user->role,
                'account_status' => $user->account_status,
                'position_title' => $user->position_title,
                'created_at' => now(),
                'updated_at' => now(),
            ])->all());
        });

        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->foreignId('account_profile_id')->nullable()->constrained('account_profiles')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', fn (Blueprint $table) => $table->dropConstrainedForeignId('account_profile_id'));
        Schema::dropIfExists('account_profiles');
        Schema::table('organizations', fn (Blueprint $table) => $table->dropConstrainedForeignId('parent_organization_id'));
    }
};
