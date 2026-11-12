<?php

use App\Http\Controllers\ElectionGovernanceController;
use Illuminate\Support\Facades\Route;

// Required from routes/api.php inside the authenticated group.
Route::post('/elections/{id}/suspend', [ElectionGovernanceController::class, 'suspend'])->middleware(['throttle:api-write', 'role:ADMIN', 'period.writable:election']);
Route::post('/elections/{id}/resume', [ElectionGovernanceController::class, 'resume'])->middleware(['throttle:api-write', 'role:ADMIN', 'period.writable:election']);
Route::post('/elections/{id}/cancel', [ElectionGovernanceController::class, 'cancel'])->middleware(['throttle:api-write', 'role:ADMIN', 'period.writable:election']);
Route::get('/elections/{id}/approval-history', [ElectionGovernanceController::class, 'approvalHistory'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,SUPER_ADMIN']);
