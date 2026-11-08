<?php

namespace App\Services\Edp;

// Placeholder for the school's EDP system, which has no reachable API yet. It refuses every lookup
// so a misconfigured driver can never let anyone sign up.
class HttpStudentRegistry implements StudentRegistry
{
    public function __construct(
        private readonly ?string $url = null,
        private readonly ?string $key = null,
        private readonly int $timeout = 5,
    ) {}

    public function find(int $schoolId): ?StudentRecord
    {
        throw new StudentRegistryUnavailable('The EDP student registry is not connected.');
    }

    public function markClaimed(int $schoolId): bool
    {
        throw new StudentRegistryUnavailable('The EDP student registry is not connected.');
    }
}
