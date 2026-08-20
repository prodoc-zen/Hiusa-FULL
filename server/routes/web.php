<?php

use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json(['status' => 'ok']));
Route::post('/register', [UserController::class, 'register'])->middleware('throttle:10,1');
Route::post('/login', [UserController::class, 'login'])->middleware('throttle:10,1');
Route::post('/password/forgot', [UserController::class, 'requestPasswordReset'])->middleware('throttle:5,1');
Route::post('/password/reset/validate', [UserController::class, 'validatePasswordResetToken'])->middleware('throttle:10,1');
Route::post('/password/reset', [UserController::class, 'resetPassword'])->middleware('throttle:5,1');
