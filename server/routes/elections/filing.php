<?php

use App\Http\Controllers\ElectionApplicationController;
use Illuminate\Support\Facades\Route;

// Required from routes/api.php inside the authenticated group. Filing is open to every voting member, so the member
// writes look the election up among every organization the caller votes in, as the ballot route does. The two edit
// routes answer PUT as well as POST: a file upload that edits a row is a multipart POST that spells itself _method=PUT.
Route::get('/elections/{id}/applications', [ElectionApplicationController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
Route::get('/elections/{id}/applications/mine', [ElectionApplicationController::class, 'mine'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT']);
Route::post('/elections/{id}/applications', [ElectionApplicationController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT', 'period.writable:election,voter']);
Route::match(['put', 'post'], '/elections/{id}/applications/{application}', [ElectionApplicationController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT', 'period.writable:election,voter']);
Route::post('/elections/{id}/applications/{application}/submit', [ElectionApplicationController::class, 'submit'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT', 'period.writable:election,voter']);
Route::post('/elections/{id}/applications/{application}/withdraw', [ElectionApplicationController::class, 'withdraw'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT', 'period.writable:election,voter']);
Route::get('/elections/{id}/applications/{application}/files/{kind}', [ElectionApplicationController::class, 'file'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT']);
Route::patch('/elections/{id}/applications/{application}/review', [ElectionApplicationController::class, 'review'])->middleware(['throttle:api-write', 'role:ADMIN', 'period.writable:election']);

Route::post('/elections/{id}/slates', [ElectionApplicationController::class, 'slateStore'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT', 'period.writable:election,voter']);
Route::match(['put', 'post'], '/elections/{id}/slates/{partylist}', [ElectionApplicationController::class, 'slateUpdate'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT', 'period.writable:election,voter']);
Route::post('/elections/{id}/slates/{partylist}/members', [ElectionApplicationController::class, 'slateMemberStore'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT', 'period.writable:election,voter']);
Route::post('/elections/{id}/slates/{partylist}/submit', [ElectionApplicationController::class, 'slateSubmit'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT', 'period.writable:election,voter']);
