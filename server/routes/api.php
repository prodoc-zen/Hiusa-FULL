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
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\ApprovalRequestController;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::post('/register', [UserController::class, 'register']);
Route::post('/login', [UserController::class, 'login']);
Route::get('/organizations', [OrganizationController::class, 'index']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [UserController::class, 'logout']);

    // Profile Routes (authenticated user updates own profile/password)
    Route::put('/user/profile', [UserController::class, 'updateProfile']);
    Route::put('/user/password', [UserController::class, 'updatePassword']);

    // User Management Routes
    Route::get('/users', [UserController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::post('/users', [UserController::class, 'store'])->middleware('role:ADMIN');
    Route::put('/users/{id}', [UserController::class, 'update'])->middleware('role:ADMIN');
    Route::post('/users/{id}/disable', [UserController::class, 'disable'])->middleware('role:ADMIN');
    Route::delete('/users/{id}', [UserController::class, 'destroy'])->middleware('role:ADMIN');

    // Announcement Routes
    Route::get('/announcements', [AnnouncementController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::post('/announcements', [AnnouncementController::class, 'store'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::put('/announcements/{id}', [AnnouncementController::class, 'update'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::delete('/announcements/{id}', [AnnouncementController::class, 'destroy'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::patch('/announcements/{id}/publish', [AnnouncementController::class, 'togglePublish'])->middleware('role:ADMIN,SBO_OFFICER');

    // Event Routes
    Route::get('/events', [EventController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::get('/events/{id}', [EventController::class, 'show'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::post('/events', [EventController::class, 'store'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::put('/events/{id}', [EventController::class, 'update'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::delete('/events/{id}', [EventController::class, 'destroy'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::patch('/events/{id}/status', [EventController::class, 'updateStatus'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::get('/events/{id}/attendance', [EventController::class, 'getAttendance'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::post('/events/{id}/attendance', [EventController::class, 'recordAttendance'])->middleware('role:SBO_OFFICER');

    // Task Routes
    Route::get('/tasks', [TaskController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD');
    Route::post('/tasks', [TaskController::class, 'store'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::put('/tasks/{id}', [TaskController::class, 'update'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::delete('/tasks/{id}', [TaskController::class, 'destroy'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::patch('/tasks/{id}/status', [TaskController::class, 'updateStatus'])->middleware('role:ADMIN,SBO_OFFICER');

    // Finance Routes — Budgets (ADMIN only: SBO officers do not handle financial matters)
    Route::get('/budgets', [BudgetController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::post('/budgets', [BudgetController::class, 'store'])->middleware('role:ADMIN');
    Route::put('/budgets/{id}', [BudgetController::class, 'update'])->middleware('role:ADMIN');
    Route::delete('/budgets/{id}', [BudgetController::class, 'destroy'])->middleware('role:ADMIN');

    // Finance Routes — Transactions (ADMIN only: SBO officers do not handle financial matters)
    Route::get('/transactions/summary', [TransactionController::class, 'summary'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::get('/transactions', [TransactionController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::post('/transactions', [TransactionController::class, 'store'])->middleware('role:ADMIN');
    Route::delete('/transactions/{id}', [TransactionController::class, 'destroy'])->middleware('role:ADMIN');

    // Finance Routes — Forecasts (ADMIN only: SBO officers do not handle financial matters)
    Route::get('/forecasts', [FinancialForecastController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::post('/forecasts', [FinancialForecastController::class, 'store'])->middleware('role:ADMIN');
    Route::put('/forecasts/{id}', [FinancialForecastController::class, 'update'])->middleware('role:ADMIN');
    Route::delete('/forecasts/{id}', [FinancialForecastController::class, 'destroy'])->middleware('role:ADMIN');

    // Merchandise Routes (catalog CRUD stays SBO_OFFICER; stock adjustment is financial, ADMIN only)
    Route::get('/merchandise', [MerchandiseController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT');
    Route::post('/merchandise', [MerchandiseController::class, 'store'])->middleware('role:SBO_OFFICER');
    Route::put('/merchandise/{id}', [MerchandiseController::class, 'update'])->middleware('role:SBO_OFFICER');
    Route::delete('/merchandise/{id}', [MerchandiseController::class, 'destroy'])->middleware('role:SBO_OFFICER');
    Route::patch('/merchandise/{id}/stock', [MerchandiseController::class, 'adjustStock'])->middleware('role:ADMIN');

    // Order Routes
    Route::get('/orders', [OrderController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT');
    Route::post('/orders', [OrderController::class, 'store'])->middleware('role:STUDENT');
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus'])->middleware('role:SBO_OFFICER');
    Route::post('/orders/claim', [OrderController::class, 'claimByToken'])->middleware('role:SBO_OFFICER');

    // Election Module Routes
    Route::get('/elections', [ElectionController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::get('/elections/{id}', [ElectionController::class, 'show'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::get('/elections/{id}/candidates', [ElectionController::class, 'candidatesIndex'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::get('/elections/{id}/results', [ElectionController::class, 'results'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::get('/elections/{id}/voters', [ElectionController::class, 'voters'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::post('/elections/{id}/vote', [ElectionController::class, 'vote'])->middleware('role:STUDENT');

    Route::post('/elections', [ElectionController::class, 'store'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::put('/elections/{id}', [ElectionController::class, 'update'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::delete('/elections/{id}', [ElectionController::class, 'destroy'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::get('/elections/{id}/positions', [ElectionController::class, 'positionsIndex'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::post('/elections/{id}/positions', [ElectionController::class, 'positionsStore'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::put('/elections/{id}/positions/{positionId}', [ElectionController::class, 'positionsUpdate'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::delete('/elections/{id}/positions/{positionId}', [ElectionController::class, 'positionsDestroy'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::post('/elections/{id}/candidates', [ElectionController::class, 'candidatesStore'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::put('/elections/{id}/candidates/{candidateId}', [ElectionController::class, 'candidatesUpdate'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::delete('/elections/{id}/candidates/{candidateId}', [ElectionController::class, 'candidatesDestroy'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::get('/partylists', [ElectionController::class, 'partylistsIndex'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::post('/partylists', [ElectionController::class, 'partylistsStore'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::put('/partylists/{id}', [ElectionController::class, 'partylistsUpdate'])->middleware('role:ADMIN,SBO_OFFICER');
    Route::delete('/partylists/{id}', [ElectionController::class, 'partylistsDestroy'])->middleware('role:ADMIN,SBO_OFFICER');

    // Approval Requests (Department Head sign-off on events, budgets, elections)
    Route::get('/approval-requests', [ApprovalRequestController::class, 'index'])->middleware('role:ADMIN,DEPARTMENT_HEAD');
    Route::patch('/approval-requests/{id}', [ApprovalRequestController::class, 'review'])->middleware('role:DEPARTMENT_HEAD');

    // Notification Routes
    Route::get('/notifications', [NotificationController::class, 'index'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::patch('/notifications/{id}/read', [NotificationController::class, 'markRead'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::patch('/notifications/read-all', [NotificationController::class, 'markAllRead'])->middleware('role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD');
    Route::post('/notifications', [NotificationController::class, 'store'])->middleware('role:ADMIN,SBO_OFFICER');
});
