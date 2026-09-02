<?php

use App\Http\Controllers\AcademicStructureController;
use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\ApprovalRequestController;
use App\Http\Controllers\BudgetController;
use App\Http\Controllers\ElectionController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\FinancialAccountabilityController;
use App\Http\Controllers\FinancialForecastController;
use App\Http\Controllers\FinancialReportController;
use App\Http\Controllers\GcashSettingsController;
use App\Http\Controllers\MerchandiseController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\SboPositionController;
use App\Http\Controllers\TaskController;
use App\Http\Controllers\TransactionController;
use App\Http\Controllers\UserController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware(['auth:sanctum', 'throttle:api-read']);

Route::post('/register', [UserController::class, 'register'])->middleware('throttle:10,1');
Route::post('/login', [UserController::class, 'login'])->middleware('throttle:10,1');
Route::post('/password/forgot', [UserController::class, 'requestPasswordReset'])->middleware('throttle:5,1');
Route::post('/password/reset/validate', [UserController::class, 'validatePasswordResetToken'])->middleware('throttle:10,1');
Route::post('/password/reset', [UserController::class, 'resetPassword'])->middleware('throttle:5,1');
Route::get('/organizations', [OrganizationController::class, 'index'])->middleware('throttle:30,1');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [UserController::class, 'logout'])->middleware('throttle:api-write');

    // Profile Routes (authenticated user updates own profile/password)
    Route::put('/user/profile', [UserController::class, 'updateProfile'])->middleware('throttle:api-write');
    Route::put('/user/password', [UserController::class, 'updatePassword'])->middleware('throttle:api-write');

    // User Management Routes
    Route::get('/users', [UserController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/users', [UserController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/users/{id}', [UserController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/users/{id}/disable', [UserController::class, 'disable'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/users/{id}/reactivate', [UserController::class, 'reactivate'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/users/{id}', [UserController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/sbo-positions', [SboPositionController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/sbo-positions', [SboPositionController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/sbo-positions/{position}', [SboPositionController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/sbo-positions/{position}', [SboPositionController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/academic-structure', [AcademicStructureController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN']);
    Route::post('/academic-structure/programs', [AcademicStructureController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/academic-structure/programs/{program}', [AcademicStructureController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/academic-structure/programs/{program}', [AcademicStructureController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Announcement Routes
    Route::get('/announcements', [AnnouncementController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::post('/announcements/generate-draft', [AnnouncementController::class, 'generateDraft'])->middleware(['throttle:ai-generation', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/announcements', [AnnouncementController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::put('/announcements/{id}', [AnnouncementController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::delete('/announcements/{id}', [AnnouncementController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::patch('/announcements/{id}/publish', [AnnouncementController::class, 'togglePublish'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/announcements/{id}/view', [AnnouncementController::class, 'recordView'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);

    // Event Routes
    Route::get('/events', [EventController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/events/{id}', [EventController::class, 'show'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::post('/events', [EventController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/events/{id}', [EventController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/events/{id}', [EventController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/events/{id}/status', [EventController::class, 'updateStatus'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/events/{id}/generate-plan', [EventController::class, 'generatePlan'])->middleware(['throttle:ai-generation', 'role:ADMIN']);
    Route::get('/events/{id}/attendance', [EventController::class, 'getAttendance'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/events/{id}/attendance', [EventController::class, 'recordAttendance'])->middleware(['throttle:attendance', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);

    // Task Routes
    Route::get('/tasks', [TaskController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/tasks', [TaskController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/tasks/{id}', [TaskController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/tasks/{id}', [TaskController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/tasks/{id}/status', [TaskController::class, 'updateStatus'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);

    // Finance Routes - Budgets
    Route::get('/budgets', [BudgetController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/budgets', [BudgetController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/budgets/{id}/advice', [BudgetController::class, 'advice'])->middleware(['throttle:ai-generation', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::put('/budgets/{id}', [BudgetController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::delete('/budgets/{id}', [BudgetController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Finance Routes - Transactions
    Route::get('/transactions/summary', [TransactionController::class, 'summary'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::get('/transactions/personal-receipts', [TransactionController::class, 'personalReceipts'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::get('/transactions', [TransactionController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/transactions', [TransactionController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/transactions/{id}', [TransactionController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/transactions/{id}', [TransactionController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Financial accountability: collections are ledgered only after verification; remittances are custody movements.
    Route::get('/financial-dashboard', [FinancialAccountabilityController::class, 'dashboard'])->middleware(['throttle:api-read', 'role:ADMIN,DEPARTMENT_HEAD']);
    Route::get('/collections', [FinancialAccountabilityController::class, 'collections'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/collections', [FinancialAccountabilityController::class, 'storeCollection'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::patch('/collections/{collection}/verify', [FinancialAccountabilityController::class, 'verifyCollection'])->middleware(['throttle:api-write', 'role:ADMIN,DEPARTMENT_HEAD']);
    Route::post('/collections/{collection}/remittances', [FinancialAccountabilityController::class, 'storeRemittance'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/cash-advances', [FinancialAccountabilityController::class, 'advances'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/cash-advances', [FinancialAccountabilityController::class, 'storeAdvance'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::patch('/cash-advances/{advance}/approve', [FinancialAccountabilityController::class, 'approveAdvance'])->middleware(['throttle:api-write', 'role:ADMIN,DEPARTMENT_HEAD']);
    Route::patch('/cash-advances/{advance}/release', [FinancialAccountabilityController::class, 'releaseAdvance'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/cash-advances/{advance}/repayments', [FinancialAccountabilityController::class, 'repayAdvance'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/invoices', [FinancialAccountabilityController::class, 'invoices'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::get('/student-debts', [FinancialAccountabilityController::class, 'studentDebts'])->middleware(['throttle:api-read', 'role:ADMIN,STUDENT']);
    Route::post('/invoices', [FinancialAccountabilityController::class, 'storeInvoice'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/invoices/{invoice}/payments', [FinancialAccountabilityController::class, 'recordInvoicePayment'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/audit-logs', [FinancialAccountabilityController::class, 'auditLogs'])->middleware(['throttle:api-read', 'role:ADMIN']);

    // Finance Routes - Forecasts
    Route::get('/forecasts', [FinancialForecastController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/forecasts/generate', [FinancialForecastController::class, 'generate'])->middleware(['throttle:ai-generation', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/forecasts', [FinancialForecastController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::put('/forecasts/{id}', [FinancialForecastController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::delete('/forecasts/{id}', [FinancialForecastController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);

    // Finance Routes - Reports
    Route::get('/financial-reports', [FinancialReportController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/financial-reports/generate', [FinancialReportController::class, 'generate'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);

    // Merchandise Routes
    Route::get('/merchandise', [MerchandiseController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/merchandise', [MerchandiseController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/merchandise/{id}', [MerchandiseController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/merchandise/{id}', [MerchandiseController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/merchandise/{id}/stock', [MerchandiseController::class, 'adjustStock'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/merchandise/gcash-settings', [GcashSettingsController::class, 'show'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/merchandise/gcash-settings', [GcashSettingsController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Order Routes
    Route::get('/orders', [OrderController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/orders', [OrderController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/orders/{id}/payment', [OrderController::class, 'submitPayment'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/orders/{id}/audit-logs', [OrderController::class, 'auditHistory'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/orders/claim', [OrderController::class, 'claimByToken'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/orders/analytics/users', [OrderController::class, 'analyticsUsers'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/orders/export', [OrderController::class, 'export'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/orders/{id}/payment-proof', [OrderController::class, 'paymentProof'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);

    // Election Module Routes
    Route::get('/elections', [ElectionController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}', [ElectionController::class, 'show'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}/candidates', [ElectionController::class, 'candidatesIndex'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}/results', [ElectionController::class, 'results'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}/voters', [ElectionController::class, 'voters'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/elections/{id}/vote', [ElectionController::class, 'vote'])->middleware(['throttle:voting', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);

    Route::post('/elections', [ElectionController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/elections/{id}', [ElectionController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/elections/{id}', [ElectionController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/elections/{id}/positions', [ElectionController::class, 'positionsIndex'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/elections/{id}/positions', [ElectionController::class, 'positionsStore'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/elections/{id}/positions/{positionId}', [ElectionController::class, 'positionsUpdate'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/elections/{id}/positions/{positionId}', [ElectionController::class, 'positionsDestroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/elections/{id}/candidates', [ElectionController::class, 'candidatesStore'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::put('/elections/{id}/candidates/{candidateId}', [ElectionController::class, 'candidatesUpdate'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::delete('/elections/{id}/candidates/{candidateId}', [ElectionController::class, 'candidatesDestroy'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/partylists', [ElectionController::class, 'partylistsIndex'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::post('/partylists', [ElectionController::class, 'partylistsStore'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/partylists/{id}', [ElectionController::class, 'partylistsUpdate'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/partylists/{id}', [ElectionController::class, 'partylistsDestroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Approval Requests (Department Head sign-off on events, budgets, elections)
    Route::get('/approval-requests', [ApprovalRequestController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,DEPARTMENT_HEAD']);
    Route::patch('/approval-requests/{id}', [ApprovalRequestController::class, 'review'])->middleware(['throttle:api-write', 'role:ADMIN,DEPARTMENT_HEAD']);

    // Notification Routes
    Route::get('/notifications', [NotificationController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::patch('/notifications/read-all', [NotificationController::class, 'markAllRead'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::patch('/notifications/{id}/read', [NotificationController::class, 'markRead'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::post('/notifications', [NotificationController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
});
