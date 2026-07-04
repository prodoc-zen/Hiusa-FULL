<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\UserController;
use App\Http\Controllers\ElectionController;
use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\TaskController;
use App\Http\Controllers\BudgetController;
use App\Http\Controllers\TransactionController;
use App\Http\Controllers\FinancialForecastController;
use App\Http\Controllers\MerchandiseController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\NotificationController;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::post('/register', [UserController::class, 'register']);
Route::post('/login', [UserController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [UserController::class, 'logout']);

    // Profile Routes (authenticated user updates own profile/password)
    Route::put('/user/profile', [UserController::class, 'updateProfile']);
    Route::put('/user/password', [UserController::class, 'updatePassword']);

    // User Management Routes
    Route::get('/users', [UserController::class, 'index'])->middleware('role:admin,officer');
    Route::put('/users/{id}', [UserController::class, 'update'])->middleware('role:admin');
    Route::post('/users/{id}/disable', [UserController::class, 'disable'])->middleware('role:admin');
    Route::delete('/users/{id}', [UserController::class, 'destroy'])->middleware('role:admin');

    // Announcement Routes
    Route::get('/announcements', [AnnouncementController::class, 'index'])->middleware('role:admin,officer,adviser,student');
    Route::post('/announcements', [AnnouncementController::class, 'store'])->middleware('role:admin,officer');
    Route::put('/announcements/{id}', [AnnouncementController::class, 'update'])->middleware('role:admin,officer');
    Route::delete('/announcements/{id}', [AnnouncementController::class, 'destroy'])->middleware('role:admin,officer');
    Route::patch('/announcements/{id}/publish', [AnnouncementController::class, 'togglePublish'])->middleware('role:admin,officer');

    // Event Routes
    Route::get('/events', [EventController::class, 'index'])->middleware('role:admin,officer,adviser,student');
    Route::get('/events/{id}', [EventController::class, 'show'])->middleware('role:admin,officer,adviser,student');
    Route::post('/events', [EventController::class, 'store'])->middleware('role:admin,officer');
    Route::put('/events/{id}', [EventController::class, 'update'])->middleware('role:admin,officer');
    Route::delete('/events/{id}', [EventController::class, 'destroy'])->middleware('role:admin,officer');
    Route::patch('/events/{id}/status', [EventController::class, 'updateStatus'])->middleware('role:admin,officer');
    Route::get('/events/{id}/attendance', [EventController::class, 'getAttendance'])->middleware('role:admin,officer,adviser');
    Route::post('/events/{id}/attendance', [EventController::class, 'recordAttendance'])->middleware('role:officer');

    // Task Routes
    Route::get('/tasks', [TaskController::class, 'index'])->middleware('role:admin,officer,adviser');
    Route::post('/tasks', [TaskController::class, 'store'])->middleware('role:admin,officer');
    Route::put('/tasks/{id}', [TaskController::class, 'update'])->middleware('role:admin,officer');
    Route::delete('/tasks/{id}', [TaskController::class, 'destroy'])->middleware('role:admin,officer');
    Route::patch('/tasks/{id}/status', [TaskController::class, 'updateStatus'])->middleware('role:admin,officer');

    // Finance Routes — Budgets
    Route::get('/budgets', [BudgetController::class, 'index'])->middleware('role:admin,officer,adviser');
    Route::post('/budgets', [BudgetController::class, 'store'])->middleware('role:officer');
    Route::put('/budgets/{id}', [BudgetController::class, 'update'])->middleware('role:officer');
    Route::delete('/budgets/{id}', [BudgetController::class, 'destroy'])->middleware('role:officer');

    // Finance Routes — Transactions
    Route::get('/transactions/summary', [TransactionController::class, 'summary'])->middleware('role:admin,officer,adviser');
    Route::get('/transactions', [TransactionController::class, 'index'])->middleware('role:admin,officer,adviser');
    Route::post('/transactions', [TransactionController::class, 'store'])->middleware('role:officer');
    Route::delete('/transactions/{id}', [TransactionController::class, 'destroy'])->middleware('role:officer');

    // Finance Routes — Forecasts
    Route::get('/forecasts', [FinancialForecastController::class, 'index'])->middleware('role:admin,officer,adviser');
    Route::post('/forecasts', [FinancialForecastController::class, 'store'])->middleware('role:officer');
    Route::put('/forecasts/{id}', [FinancialForecastController::class, 'update'])->middleware('role:officer');
    Route::delete('/forecasts/{id}', [FinancialForecastController::class, 'destroy'])->middleware('role:officer');

    // Merchandise Routes
    Route::get('/merchandise', [MerchandiseController::class, 'index'])->middleware('role:admin,officer,adviser,student');
    Route::post('/merchandise', [MerchandiseController::class, 'store'])->middleware('role:officer');
    Route::put('/merchandise/{id}', [MerchandiseController::class, 'update'])->middleware('role:officer');
    Route::delete('/merchandise/{id}', [MerchandiseController::class, 'destroy'])->middleware('role:officer');
    Route::patch('/merchandise/{id}/stock', [MerchandiseController::class, 'adjustStock'])->middleware('role:officer');

    // Order Routes
    Route::get('/orders', [OrderController::class, 'index'])->middleware('role:admin,officer,student');
    Route::post('/orders', [OrderController::class, 'store'])->middleware('role:student');
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus'])->middleware('role:officer');
    Route::post('/orders/claim', [OrderController::class, 'claimByToken'])->middleware('role:officer');

    // Election Module Routes
    Route::get('/elections', [ElectionController::class, 'index'])->middleware('role:admin,officer,adviser,student');
    Route::get('/elections/{id}', [ElectionController::class, 'show'])->middleware('role:admin,officer,adviser,student');
    Route::get('/elections/{id}/candidates', [ElectionController::class, 'candidatesIndex'])->middleware('role:admin,officer,adviser,student');
    Route::get('/elections/{id}/results', [ElectionController::class, 'results'])->middleware('role:admin,officer,adviser,student');
    Route::get('/elections/{id}/voters', [ElectionController::class, 'voters'])->middleware('role:admin,officer,adviser');
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

    // Notification Routes
    Route::get('/notifications', [NotificationController::class, 'index'])->middleware('role:admin,officer,adviser,student');
    Route::patch('/notifications/{id}/read', [NotificationController::class, 'markRead'])->middleware('role:admin,officer,adviser,student');
    Route::patch('/notifications/read-all', [NotificationController::class, 'markAllRead'])->middleware('role:admin,officer,adviser,student');
    Route::post('/notifications', [NotificationController::class, 'store'])->middleware('role:admin,officer');
});


