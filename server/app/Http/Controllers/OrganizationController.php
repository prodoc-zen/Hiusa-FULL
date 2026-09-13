<?php

namespace App\Http\Controllers;

use App\Models\Organization;

class OrganizationController extends Controller
{
    public function index()
    {
        return response()->json(
            Organization::query()
                ->where('is_active', true)
                ->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')
                ->orderBy('name')
                ->get(['id', 'name', 'slug', 'college', 'acronym'])
        );
    }
}
