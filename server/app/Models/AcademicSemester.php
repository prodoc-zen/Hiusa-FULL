<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Http\Request;

class AcademicSemester extends Model
{
    public const PERIOD_HEADER = 'X-Academic-Semester';

    /** Roles that choose a period; everyone else always works in the active one. */
    private const PERIOD_ROLES = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER'];

    /** Roles that may plan ahead in a semester that has not started. */
    private const PLANNING_ROLES = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'];

    protected $guarded = [];

    protected function casts(): array
    {
        return ['starts_on' => 'date:Y-m-d', 'ends_on' => 'date:Y-m-d', 'number' => 'integer'];
    }

    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class);
    }

    public static function active(): ?self
    {
        return static::with('academicYear')->where('status', 'active')->first();
    }

    /**
     * The semester a request works in: the one named by the X-Academic-Semester header when the caller may pick
     * it, otherwise the active one. An unknown id, a semester the caller may not see, or a malformed header
     * falls back to the active semester.
     */
    public static function selected(?Request $request = null): ?self
    {
        $request ??= request();
        $role = $request->user()?->role;
        $id = $request->headers->get(self::PERIOD_HEADER);

        if ($role !== null && in_array($role, self::PERIOD_ROLES, true) && is_string($id) && ctype_digit($id)) {
            $semester = static::with('academicYear')->find((int) $id);
            if ($semester && ($semester->status !== 'upcoming' || in_array($role, self::PLANNING_ROLES, true))) {
                return $semester;
            }
        }

        return static::active();
    }

    /** The semester a new record belongs to: the selected one, unless that period is closed. */
    public static function forNewRecord(?Request $request = null): ?self
    {
        $selected = static::selected($request);

        return $selected && $selected->status !== 'completed' ? $selected : static::active();
    }

    public static function isClosed(?int $semesterId): bool
    {
        return $semesterId !== null && static::whereKey($semesterId)->where('status', 'completed')->exists();
    }
}
