<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

abstract class Controller
{
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
