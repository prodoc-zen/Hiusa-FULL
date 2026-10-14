<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clearance_periods', function (Blueprint $table) {
            $table->json('legacy_required_roles')->nullable();
        });
        Schema::table('clearance_signatures', function (Blueprint $table) {
            $table->timestamp('retired_at')->nullable();
            $table->json('migrated_from_ids')->nullable();
        });

        DB::transaction(function () {
            foreach (DB::table('clearance_periods')->orderBy('id')->get() as $period) {
                $original = json_decode($period->required_roles, true);
                if (! array_diff($original, ['organization', 'department_head', 'sao'])) {
                    continue;
                }
                $map = fn ($role) => match ($role) {
                    'sao' => 'sao', 'department_head', 'adviser', 'organization_adviser', 'dean' => 'department_head', default => 'organization',
                };
                $roles = array_values(array_unique(array_map($map, $original)));
                DB::table('clearance_periods')->where('id', $period->id)->update([
                    'legacy_required_roles' => $period->required_roles, 'required_roles' => json_encode($roles),
                ]);
                $rows = DB::table('clearance_signatures')->where('clearance_period_id', $period->id)->orderBy('id')->get();
                foreach ($rows->groupBy(fn ($row) => $row->student_id.':'.$map($row->required_role)) as $group) {
                    $role = $map($group->first()->required_role);
                    if ($group->count() === 1 && $group->first()->required_role === $role) {
                        continue;
                    }
                    // Original signatures remain stored for audit and rollback. A former adviser line cannot authorize a Department Head signature.
                    $chosen = $group->sortBy(fn ($row) => ['held' => 0, 'pending' => 1, 'cleared' => 2][$row->status] ?? 1)->first();
                    $ids = $group->pluck('id')->all();
                    DB::table('clearance_signatures')->whereIn('id', $ids)->update(['retired_at' => now()]);
                    $copy = (array) $chosen;
                    unset($copy['id']);
                    $copy['required_role'] = $role;
                    $copy['retired_at'] = null;
                    $copy['migrated_from_ids'] = json_encode($ids);
                    if ($role === 'department_head') {
                        $copy['status'] = 'pending';
                        $copy['signed_by'] = null;
                        $copy['signed_at'] = null;
                        $copy['remarks'] = 'Department Head signature required under the updated clearance roles.'.($chosen->remarks ? ' Previous note: '.$chosen->remarks : '');
                    }
                    // A canonical row may already exist alongside a legacy row.
                    $existing = $group->firstWhere('required_role', $role);
                    if ($existing) {
                        DB::table('clearance_signatures')->where('id', $existing->id)->update(['retired_at' => null]);
                    } else {
                        DB::table('clearance_signatures')->insert($copy);
                    }
                }
            }
        });
    }

    public function down(): void
    {
        DB::transaction(function () {
            DB::table('clearance_signatures')->whereNotNull('migrated_from_ids')->delete();
            DB::table('clearance_signatures')->whereNotNull('retired_at')->update(['retired_at' => null]);
            foreach (DB::table('clearance_periods')->whereNotNull('legacy_required_roles')->get() as $period) {
                DB::table('clearance_periods')->where('id', $period->id)->update(['required_roles' => $period->legacy_required_roles]);
            }
        });
        Schema::table('clearance_signatures', fn (Blueprint $table) => $table->dropColumn(['retired_at', 'migrated_from_ids']));
        Schema::table('clearance_periods', fn (Blueprint $table) => $table->dropColumn('legacy_required_roles'));
    }
};
