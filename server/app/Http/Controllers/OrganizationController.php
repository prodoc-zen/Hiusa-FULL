<?php

namespace App\Http\Controllers;

use App\Models\Organization;

class OrganizationController extends Controller
{
    public function index()
    {
        $query = Organization::query()->where('is_active', true);

        // The SAO is a static system department, not a student-body
        // organization. It is exposed only to the organization-picker used
        // before login so the SAO Director can select it and authenticate.
        if (! request()->boolean('for_login')) {
            $query->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION');
        }

        return response()->json($query->orderBy('name')->get([
            'id', 'name', 'slug', 'college', 'acronym', 'organization_type',
        ]));
    }
}
