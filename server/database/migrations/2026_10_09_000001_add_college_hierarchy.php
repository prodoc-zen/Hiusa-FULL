<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        // SQLite rebuilds the whole organizations table to add or drop a foreign key, and
        // with enforcement on that rebuild cascades into every child table, so the
        // constraints are only declared where ALTER TABLE can change them in place.
        $foreignKeys = DB::getDriverName() !== 'sqlite';

        if (! Schema::hasColumn('organizations', 'college_id')) {
            Schema::table('organizations', function (Blueprint $table) use ($foreignKeys) {
                $table->unsignedBigInteger('college_id')->nullable()->index();

                if ($foreignKeys) {
                    $table->foreign('college_id')->references('id')->on('colleges')->restrictOnDelete();
                }
            });
        }

        if (! Schema::hasColumn('organizations', 'lifecycle_status')) {
            Schema::table('organizations', function (Blueprint $table) use ($foreignKeys) {
                $table->string('lifecycle_status', 20)->default('active');
                $table->unsignedInteger('submitted_by')->nullable();
                $table->timestamp('submitted_at')->nullable();
                $table->unsignedInteger('reviewed_by')->nullable();
                $table->timestamp('reviewed_at')->nullable();
                $table->text('review_remarks')->nullable();
                $table->timestamp('archived_at')->nullable();
                $table->unsignedInteger('archived_by')->nullable();

                if ($foreignKeys) {
                    $table->foreign('submitted_by')->references('school_id')->on('users')->nullOnDelete();
                    $table->foreign('reviewed_by')->references('school_id')->on('users')->nullOnDelete();
                    $table->foreign('archived_by')->references('school_id')->on('users')->nullOnDelete();
                }
            });
        }

        DB::transaction(function () {
            $colleges = DB::table('colleges')->orderBy('id')->get();

            foreach ($colleges as $college) {
                DB::table('organizations')->whereNull('college_id')->where('college', $college->name)->update(['college_id' => $college->id]);
            }

            $homes = [];
            foreach ($colleges as $college) {
                $homes[$college->id] = DB::table('organizations')->where('organization_type', 'COLLEGE')->where('college_id', $college->id)->value('id')
                    ?? $this->createHomeOrganization($college);
            }

            $profiles = DB::table('account_profiles')
                ->join('organizations', 'organizations.id', '=', 'account_profiles.organization_id')
                ->where('account_profiles.role', 'DEPARTMENT_HEAD')
                ->where('organizations.organization_type', '!=', 'COLLEGE')
                ->whereNotNull('organizations.college_id')
                ->get(['account_profiles.id', 'account_profiles.user_school_id', 'account_profiles.organization_id', 'organizations.college_id', 'organizations.college']);

            foreach ($profiles as $profile) {
                $homeId = $homes[$profile->college_id];
                $homeProfileExists = DB::table('account_profiles')->where('user_school_id', $profile->user_school_id)->where('organization_id', $homeId)->exists();

                if ($homeProfileExists) {
                    DB::table('account_profiles')->where('id', $profile->id)->delete();
                } else {
                    DB::table('account_profiles')->where('id', $profile->id)->update(['organization_id' => $homeId]);
                }

                DB::table('users')->where('school_id', $profile->user_school_id)->where('organization_id', $profile->organization_id)
                    ->update(['organization_id' => $homeId, 'department' => $profile->college]);
            }
        });
    }

    public function down(): void
    {
        DB::transaction(function () {
            $profiles = DB::table('account_profiles')
                ->join('organizations', 'organizations.id', '=', 'account_profiles.organization_id')
                ->where('account_profiles.role', 'DEPARTMENT_HEAD')
                ->where('organizations.organization_type', 'COLLEGE')
                ->get(['account_profiles.id', 'account_profiles.user_school_id', 'account_profiles.organization_id', 'organizations.college_id']);

            foreach ($profiles as $profile) {
                $studentId = DB::table('organizations')->where('organization_type', 'STUDENT_ORGANIZATION')->where('college_id', $profile->college_id)->orderBy('id')->value('id');

                if (! $studentId) {
                    continue;
                }

                if (DB::table('account_profiles')->where('user_school_id', $profile->user_school_id)->where('organization_id', $studentId)->exists()) {
                    DB::table('account_profiles')->where('id', $profile->id)->delete();
                } else {
                    DB::table('account_profiles')->where('id', $profile->id)->update(['organization_id' => $studentId]);
                }

                DB::table('users')->where('school_id', $profile->user_school_id)->where('organization_id', $profile->organization_id)->update(['organization_id' => $studentId]);
            }

            DB::table('organizations')->where('organization_type', 'COLLEGE')
                ->whereNotExists(fn ($query) => $query->selectRaw('1')->from('users')->whereColumn('users.organization_id', 'organizations.id'))
                ->whereNotExists(fn ($query) => $query->selectRaw('1')->from('account_profiles')->whereColumn('account_profiles.organization_id', 'organizations.id'))
                ->delete();
        });

        $foreignKeys = DB::getDriverName() !== 'sqlite';

        Schema::table('organizations', function (Blueprint $table) use ($foreignKeys) {
            if ($foreignKeys) {
                $table->dropForeign(['submitted_by']);
                $table->dropForeign(['reviewed_by']);
                $table->dropForeign(['archived_by']);
            }

            $table->dropColumn(['lifecycle_status', 'submitted_by', 'submitted_at', 'reviewed_by', 'reviewed_at', 'review_remarks', 'archived_at', 'archived_by']);
        });

        Schema::table('organizations', function (Blueprint $table) use ($foreignKeys) {
            if ($foreignKeys) {
                $table->dropForeign(['college_id']);
            }

            $table->dropIndex(['college_id']);
            $table->dropColumn('college_id');
        });
    }

    private function createHomeOrganization(object $college): int
    {
        $name = $college->name;
        for ($suffix = 2; DB::table('organizations')->where('name', $name)->exists(); $suffix++) {
            $name = $college->name.' (College'.($suffix > 2 ? ' '.$suffix : '').')';
        }

        $base = Str::slug($name);
        $slug = $base;
        for ($suffix = 2; DB::table('organizations')->where('slug', $slug)->exists(); $suffix++) {
            $slug = $base.'-'.$suffix;
        }

        return DB::table('organizations')->insertGetId([
            'name' => $name,
            'slug' => $slug,
            'college' => $college->name,
            'college_id' => $college->id,
            'acronym' => $college->code,
            'organization_type' => 'COLLEGE',
            'is_active' => true,
            'lifecycle_status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
};
