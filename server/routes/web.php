<?php

use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json(['status' => 'ok']));
Route::post('/register', [UserController::class, 'register'])->middleware('throttle:registration');
Route::post('/login', [UserController::class, 'login'])->middleware('throttle:login');
Route::post('/password/forgot', [UserController::class, 'requestPasswordReset'])->middleware('throttle:password');
Route::post('/password/reset/validate', [UserController::class, 'validatePasswordResetToken'])->middleware('throttle:password');
Route::post('/password/reset', [UserController::class, 'resetPassword'])->middleware('throttle:password');
