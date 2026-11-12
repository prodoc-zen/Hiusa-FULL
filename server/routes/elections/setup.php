<?php

use App\Http\Controllers\ElectionController;
use Illuminate\Support\Facades\Route;

// Required from routes/api.php inside the authenticated group.
Route::post('/elections/{id}/submit', [ElectionController::class, 'submit'])->middleware(['throttle:api-write', 'role:ADMIN', 'period.writable:election']);
