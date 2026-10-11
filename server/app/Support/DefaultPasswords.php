<?php

namespace App\Support;

class DefaultPasswords
{
    private const SEEDED = ['Demo@12345', 'Admin@123456'];

    public static function classList(int|string $schoolId): string
    {
        return substr(str_pad((string) $schoolId, 4, '0', STR_PAD_LEFT), -4).'-uclm';
    }

    /**
     * Passwords that were ever handed out or seeded for this account.
     *
     * @return list<string>
     */
    public static function for(int|string $schoolId): array
    {
        return [self::classList($schoolId), ...self::SEEDED];
    }

    public static function isGuessable(string $password, int|string $schoolId): bool
    {
        return in_array($password, self::for($schoolId), true) || $password === (string) $schoolId;
    }
}
