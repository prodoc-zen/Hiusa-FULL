<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const REQUIRED_POSITIONS = [
        'President',
        'Vice President – Internal',
        'Vice President – External',
        'Secretary',
        'Assistant Secretary',
        'Treasurer',
        'Auditor',
        'Public Information Officer',
        'Representative',
        'Business Manager',
        'Adviser',
    ];

    public function up(): void
    {
        DB::transaction(function () {
            DB::table('users')
                ->where('position_title', 'Vice President')
                ->update(['position_title' => 'Vice President – Internal']);
            DB::table('users')
                ->where('position_title', 'Public Relations Officer')
                ->update(['position_title' => 'Public Information Officer']);

            $now = now();
            foreach (DB::table('organizations')->pluck('id') as $organizationId) {
                foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
                    $this->renameOrMerge($organizationId, $role, 'Vice President', 'Vice President – Internal');
                    $this->renameOrMerge($organizationId, $role, 'Public Relations Officer', 'Public Information Officer');

                    foreach (self::REQUIRED_POSITIONS as $title) {
                        DB::table('sbo_positions')->updateOrInsert(
                            ['organization_id' => $organizationId, 'role' => $role, 'title' => $title],
                            ['is_active' => true, 'updated_at' => $now, 'created_at' => $now]
                        );
                    }
                }
            }
        });
    }

    public function down(): void
    {
        DB::transaction(function () {
            DB::table('users')
                ->whereIn('position_title', ['Vice President – Internal', 'Vice President – External'])
                ->update(['position_title' => 'Vice President']);
            DB::table('users')
                ->where('position_title', 'Public Information Officer')
                ->update(['position_title' => 'Public Relations Officer']);

            foreach (DB::table('organizations')->pluck('id') as $organizationId) {
                foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
                    $this->renameOrMerge($organizationId, $role, 'Vice President – Internal', 'Vice President');
                    $this->renameOrMerge($organizationId, $role, 'Public Information Officer', 'Public Relations Officer');
                    DB::table('sbo_positions')->where([
                        'organization_id' => $organizationId,
                        'role' => $role,
                    ])->whereIn('title', ['Vice President – External', 'Assistant Secretary', 'Representative'])->delete();
                }
            }
        });
    }

    private function renameOrMerge(int $organizationId, string $role, string $from, string $to): void
    {
        $source = DB::table('sbo_positions')->where([
            'organization_id' => $organizationId,
            'role' => $role,
            'title' => $from,
        ])->first();

        if (! $source) {
            return;
        }

        $targetExists = DB::table('sbo_positions')->where([
            'organization_id' => $organizationId,
            'role' => $role,
            'title' => $to,
        ])->exists();

        if ($targetExists) {
            DB::table('sbo_positions')->where('id', $source->id)->delete();
        } else {
            DB::table('sbo_positions')->where('id', $source->id)->update(['title' => $to, 'updated_at' => now()]);
        }
    }
};
