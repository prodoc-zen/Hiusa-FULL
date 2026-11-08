<?php

namespace App\Services\Edp;

interface StudentRegistry
{
    /** @throws StudentRegistryUnavailable when the records cannot be reached; callers must treat that as a refusal */
    public function find(int $schoolId): ?StudentRecord;

    /** Returns false when the record was already claimed, so two sign-ups for one ID cannot both win. */
    public function markClaimed(int $schoolId): bool;
}
