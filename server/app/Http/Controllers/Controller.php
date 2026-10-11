<?php

namespace App\Http\Controllers;

use DateTimeInterface;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

abstract class Controller
{
    /**
     * An instant the client sent, in whatever offset it carried (the booking page sends UTC), as
     * the application's wall-clock time. Dates are stored and compared in that time, so a query or
     * a write that kept the incoming offset would land hours away from the moment it names.
     */
    protected function localTime(string|DateTimeInterface $value): Carbon
    {
        return Carbon::parse($value)->setTimezone(config('app.timezone'));
    }

    /**
     * Organizations a read may span. A Department Head sees the whole college
     * and may narrow it to one organization with `organization_id`.
     *
     * @return array<int, int>
     */
    protected function readableOrganizationIds(Request $request): array
    {
        $user = $request->user();
        $scoped = $user->scopedOrganizationIds();

        if ($user->role !== 'DEPARTMENT_HEAD') {
            return $scoped;
        }

        $filter = $request->validate(['organization_id' => ['nullable', 'integer', Rule::in($scoped)]]);

        return isset($filter['organization_id']) ? [(int) $filter['organization_id']] : $scoped;
    }
}
