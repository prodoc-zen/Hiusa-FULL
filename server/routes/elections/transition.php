<?php

use App\Http\Controllers\OfficerTransitionController;
use Illuminate\Support\Facades\Route;

// Required from routes/api.php inside the authenticated group. `officer-transition` is deliberately not mapped in
// EnsureOrganizationModule, so every officer can read it. Only officers prepare or acknowledge a handover.
Route::get('/officer-transition/officers', [OfficerTransitionController::class, 'officers'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,SUPER_ADMIN']);
Route::get('/officer-transition/handover', [OfficerTransitionController::class, 'handover'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,SUPER_ADMIN']);
// Preparing an item with an attachment is a multipart POST that spells itself _method=PUT, so the route answers both.
Route::match(['put', 'post'], '/officer-transition/handover/{handover}', [OfficerTransitionController::class, 'prepare'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
Route::post('/officer-transition/handover/{handover}/acknowledge', [OfficerTransitionController::class, 'acknowledge'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
Route::get('/officer-transition/handover/{handover}/attachment', [OfficerTransitionController::class, 'attachment'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,SUPER_ADMIN']);
Route::get('/officer-transition/renewal', [OfficerTransitionController::class, 'renewal'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,SUPER_ADMIN']);
