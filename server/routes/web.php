<?php

use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json(['status' => 'ok']));
Route::post('/register', [UserController::class, 'register']);
Route::post('/login', [UserController::class, 'login']);
Route::post('/password/forgot', [UserController::class, 'requestPasswordReset']);
Route::post('/password/reset/validate', [UserController::class, 'validatePasswordResetToken']);
Route::post('/password/reset', [UserController::class, 'resetPassword']);
