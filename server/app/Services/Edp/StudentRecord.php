<?php

namespace App\Services\Edp;

final class StudentRecord
{
    public function __construct(
        public readonly int $schoolId,
        public readonly string $firstName,
        public readonly string $lastName,
        public readonly string $birthDate,
        public readonly int $collegeId,
        public readonly string $program,
        public readonly string $yearLevel,
        public readonly ?string $section,
        public readonly bool $claimed,
    ) {}
}
