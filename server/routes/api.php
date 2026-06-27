<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\UserController;
use App\Http\Controllers\ElectionController;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::post('/register', [UserController::class, 'register']);
Route::post('/login', [UserController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [UserController::class, 'logout']);

    // User Management Routes
    Route::get('/users', [UserController::class, 'index'])->middleware('role:admin,officer');
    Route::put('/users/{id}', [UserController::class, 'update'])->middleware('role:admin');
    Route::post('/users/{id}/disable', [UserController::class, 'disable'])->middleware('role:admin');
    Route::delete('/users/{id}', [UserController::class, 'destroy'])->middleware('role:admin');

    // Election Module Routes
    Route::get('/elections', [ElectionController::class, 'index'])->middleware('role:admin,officer,adviser,student');
    Route::get('/elections/{id}', [ElectionController::class, 'show'])->middleware('role:admin,officer,adviser,student');
    Route::get('/elections/{id}/candidates', [ElectionController::class, 'candidatesIndex'])->middleware('role:admin,officer,adviser,student');
    Route::get('/elections/{id}/results', [ElectionController::class, 'results'])->middleware('role:admin,officer,adviser,student');
    Route::post('/elections/{id}/vote', [ElectionController::class, 'vote'])->middleware('role:student');

    Route::post('/elections', [ElectionController::class, 'store'])->middleware('role:admin,officer');
    Route::put('/elections/{id}', [ElectionController::class, 'update'])->middleware('role:admin,officer');
    Route::delete('/elections/{id}', [ElectionController::class, 'destroy'])->middleware('role:admin,officer');
    Route::get('/elections/{id}/positions', [ElectionController::class, 'positionsIndex'])->middleware('role:admin,officer,adviser');
    Route::post('/elections/{id}/positions', [ElectionController::class, 'positionsStore'])->middleware('role:admin,officer');
    Route::put('/elections/{id}/positions/{positionId}', [ElectionController::class, 'positionsUpdate'])->middleware('role:admin,officer');
    Route::delete('/elections/{id}/positions/{positionId}', [ElectionController::class, 'positionsDestroy'])->middleware('role:admin,officer');
    Route::post('/elections/{id}/candidates', [ElectionController::class, 'candidatesStore'])->middleware('role:admin,officer');
    Route::put('/elections/{id}/candidates/{candidateId}', [ElectionController::class, 'candidatesUpdate'])->middleware('role:admin,officer');
    Route::delete('/elections/{id}/candidates/{candidateId}', [ElectionController::class, 'candidatesDestroy'])->middleware('role:admin,officer');
    Route::get('/partylists', [ElectionController::class, 'partylistsIndex'])->middleware('role:admin,officer,adviser,student');
    Route::post('/partylists', [ElectionController::class, 'partylistsStore'])->middleware('role:admin,officer');
    Route::put('/partylists/{id}', [ElectionController::class, 'partylistsUpdate'])->middleware('role:admin,officer');
    Route::delete('/partylists/{id}', [ElectionController::class, 'partylistsDestroy'])->middleware('role:admin,officer');
});


