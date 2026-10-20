<?php

namespace App\Services\Compliance;

class RegistrationRequirementCatalog
{
    public const NAMES = [
        'Letter of Intent',
        'Calendar of Activities (1st & 2nd Sem)',
        'Organizational Profile',
        'Constitutional By-Laws',
        'VMGO',
        'Official List of Officers',
        'Officers Data Sheets',
        "Faculty Adviser's Data Sheet / Certificate of Appointment",
        'Endorsement Letter',
        'List of Members',
    ];

    public static function canonicalName(string $name): ?string
    {
        $normalize = fn ($value) => preg_replace('/[^a-z0-9]/', '', strtolower($value));
        $aliases = ['constitutionandbylaws' => 'Constitutional By-Laws', 'constitutionandbylaw' => 'Constitutional By-Laws', 'listofofficers' => 'Official List of Officers'];
        foreach (self::NAMES as $canonical) {
            if ($normalize($name) === $normalize($canonical)) {
                return $canonical;
            }
        }

        return $aliases[$normalize($name)] ?? null;
    }
}
