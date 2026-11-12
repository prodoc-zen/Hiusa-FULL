<?php

use App\Http\Controllers\ElectionResultsController;
use Illuminate\Support\Facades\Route;

// Required from routes/api.php inside the authenticated group. GET /elections/{id}/results stays in api.php.
Route::post('/elections/{id}/runoff', [ElectionResultsController::class, 'runoff'])->middleware(['throttle:api-write', 'role:ADMIN', 'period.writable:election']);
// The reviewer is not signed in to the election's organization, so no period.writable lookup here: the controller finds
// the election through the reviewer's own scope.
Route::post('/elections/{id}/positions/{position}/tie-resolution', [ElectionResultsController::class, 'resolveTie'])->middleware(['throttle:api-write', 'role:DEPARTMENT_HEAD,SUPER_ADMIN']);
