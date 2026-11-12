<?php

use App\Http\Controllers\ElectionReportController;
use Illuminate\Support\Facades\Route;

// Required from routes/api.php inside the authenticated group.
Route::get('/elections/{id}/reports/{type}', [ElectionReportController::class, 'show'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
