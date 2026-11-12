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
        $title = mb_strtolower(trim($title));

        return in_array($title, ['president', 'secretary', 'business manager'], true) || str_starts_with($title, 'vice president');
    }

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'can_book_venues' => 'boolean'];
    }
}
