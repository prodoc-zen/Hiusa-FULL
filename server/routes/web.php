<?php

use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json(['status' => 'ok']));
Route::post('/register', [UserController::class, 'register']);
Route::post('/login', [UserController::class, 'login']);
