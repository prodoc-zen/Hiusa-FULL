<?php

// Event registration (RSVP) routes for Wave B slice S2.
//
// This file is intentionally NOT required from routes/api.php (that file is
// owned by another slice this wave). It is registered instead from a `then`
// callback passed to withRouting() in bootstrap/app.php, which runs in the
// same routing-boot pass right after routes/api.php loads. The group below
// mirrors the outer group in routes/api.php exactly (api middleware + /api
// prefix from withRouting itself, plus auth:sanctum/account.profile/cache.api
// applied here) so these routes behave identically to their neighbours.

use App\Http\Controllers\EventRegistrationController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'account.profile', 'cache.api'])->group(function () {
    Route::get('/me/event-registrations', [EventRegistrationController::class, 'mine'])
        ->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);

    Route::get('/events/{id}/registrations', [EventRegistrationController::class, 'index'])
        ->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);

    Route::post('/events/{id}/registrations', [EventRegistrationController::class, 'store'])
        ->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);

    Route::delete('/events/{id}/registrations/mine', [EventRegistrationController::class, 'destroyMine'])
        ->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
});
