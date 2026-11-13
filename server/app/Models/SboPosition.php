<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SboPosition extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        // A position made without an explicit choice gets the booking default for its title, wherever it is created.
        static::creating(function (SboPosition $position) {
            if (! array_key_exists('can_book_venues', $position->getAttributes())) {
                $position->can_book_venues = self::bookingDefaultFor((string) $position->title);
            }
        });
    }

    /** President, the Vice Presidents, Secretary (not Assistant Secretary) and Business Manager book venues by default. */
    public static function bookingDefaultFor(string $title): bool
    {
        $title = self::normaliseTitle($title);

        return in_array($title, ['president', 'secretary', 'business manager'], true) || self::isVicePresidentTitle($title);
    }

    /** Lowercased, with every dash and run of whitespace collapsed to one space, so "Vice-President" and "vice  president" compare equal. */
    public static function normaliseTitle(string $title): string
    {
        return mb_strtolower(trim(preg_replace('/[\p{Pd}\s]+/u', ' ', $title) ?? $title));
    }

    /** A vice president seat is "vice president" alone or followed by more words; "Vice Presidential Aide" and "Vice President's Assistant" are not. */
    public static function isVicePresidentTitle(string $title): bool
    {
        return preg_match('/^vice president(?: .+)?$/', self::normaliseTitle($title)) === 1;
    }

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'can_book_venues' => 'boolean'];
    }
}
