<?php

namespace App\Services\Edp;

use App\Models\StudentRegistryEntry;

class LocalStudentRegistry implements StudentRegistry
{
    public function find(int $schoolId): ?StudentRecord
    {
        $entry = StudentRegistryEntry::where('school_id', $schoolId)->first();

        return $entry ? new StudentRecord(
            $entry->school_id,
            $entry->first_name,
            $entry->last_name,
            $entry->birth_date->format('Y-m-d'),
            $entry->college_id,
            $entry->program,
            $entry->year_level,
            $entry->section,
            $entry->claimed_at !== null,
        ) : null;
    }

    public function markClaimed(int $schoolId): bool
    {
        return StudentRegistryEntry::where('school_id', $schoolId)->whereNull('claimed_at')
            ->update(['claimed_at' => now()]) === 1;
    }
}
