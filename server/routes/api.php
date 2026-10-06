<?php

use App\Http\Controllers\AcademicStructureController;
use App\Http\Controllers\AdminDashboardController;
use App\Http\Controllers\ObjectivesOverviewController;
use App\Http\Controllers\ClassListImportController;
use App\Http\Controllers\AccountProfileController;
use App\Http\Controllers\AcademicYearController;
use App\Http\Controllers\AcademicSemesterController;
use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\ApprovalRequestController;
use App\Http\Controllers\BudgetController;
use App\Http\Controllers\CollegeController;
use App\Http\Controllers\DashboardBriefingController;
use App\Http\Controllers\ClearanceController;
use App\Http\Controllers\ComplianceController;
use App\Http\Controllers\ElectionController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\EventRequirementController;
use App\Http\Controllers\FinancialAccountabilityController;
use App\Http\Controllers\FinancialForecastController;
use App\Http\Controllers\FinancialReportController;
use App\Http\Controllers\FinancialSemesterController;
use App\Http\Controllers\FingerprintController;
use App\Http\Controllers\GcashSettingsController;
use App\Http\Controllers\GlobalAnnouncementController;
use App\Http\Controllers\GrievanceController;
use App\Http\Controllers\MerchandiseController;
use App\Http\Controllers\MyActivityController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\SboPositionController;
use App\Http\Controllers\StudentFeedController;
use App\Http\Controllers\SystemAdministrationController;
use App\Http\Controllers\TaskController;
use App\Http\Controllers\TransactionController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\UserPhotoController;
use App\Http\Controllers\VenueBookingController;
use App\Http\Controllers\VenueController;
use App\Http\Middleware\EnsureCurrentEventSemester;
use App\Http\Middleware\EnsureCurrentElectionSemester;
use App\Http\Middleware\EnsureCurrentTaskSemester;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware(['auth:sanctum', 'account.profile', 'throttle:api-read', 'cache.api']);

Route::post('/register', [UserController::class, 'register'])->middleware('throttle:registration');
Route::post('/login', [UserController::class, 'login'])->middleware('throttle:login');
Route::post('/password/forgot', [UserController::class, 'requestPasswordReset'])->middleware('throttle:password');
Route::post('/password/reset/validate', [UserController::class, 'validatePasswordResetToken'])->middleware('throttle:password');
Route::post('/password/reset', [UserController::class, 'resetPassword'])->middleware('throttle:password');
Route::get('/organizations', [OrganizationController::class, 'index'])->middleware('throttle:public');

Route::middleware(['auth:sanctum', 'account.profile', 'cache.api'])->group(function () {
    Route::get('/academic-periods', [AcademicSemesterController::class, 'index'])->middleware('throttle:api-read');
    Route::get('/academic-periods/active', [AcademicSemesterController::class, 'active'])->middleware('throttle:api-read');
    Route::get('/user/profiles', [AccountProfileController::class, 'index'])->middleware('throttle:api-read');
    Route::post('/user/profiles/{profile}/switch', [AccountProfileController::class, 'switch'])->middleware('throttle:api-write');
    Route::get('/account-profiles/organizations', [AccountProfileController::class, 'organizations'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);
    Route::get('/account-profiles/candidates', [AccountProfileController::class, 'candidates'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);
    Route::get('/account-profiles', [AccountProfileController::class, 'members'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);
    Route::delete('/account-profiles/{profile}', [AccountProfileController::class, 'destroy'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN,ADMIN']);
    Route::post('/account-profiles/invite', [AccountProfileController::class, 'invite'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN,ADMIN']);
    Route::post('/logout', [UserController::class, 'logout'])->middleware('throttle:api-write');

    // Profile Routes (authenticated user updates own profile/password)
    Route::put('/user/profile', [UserController::class, 'updateProfile'])->middleware('throttle:api-write');
    Route::put('/user/password', [UserController::class, 'updatePassword'])->middleware('throttle:api-write');
    Route::get('/me/activity', MyActivityController::class)->middleware('throttle:api-read');
    Route::get('/user/notification-preferences', [NotificationController::class, 'preferences'])->middleware('throttle:api-read');
    Route::put('/user/notification-preferences', [NotificationController::class, 'updatePreferences'])->middleware('throttle:api-write');
    Route::get('/student/feed', [StudentFeedController::class, 'index'])->middleware(['throttle:api-read', 'role:STUDENT']);
    Route::get('/dashboard/briefing', [DashboardBriefingController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::get('/objectives/overview', ObjectivesOverviewController::class)->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);

    // User Management Routes
    Route::get('/users', [UserController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/users', [UserController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/users/import', [UserController::class, 'import'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/users/{id}', [UserController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/users/{id}/photo', [UserPhotoController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/users/{id}/disable', [UserController::class, 'disable'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/users/{id}/reactivate', [UserController::class, 'reactivate'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/users/{id}', [UserController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/sbo-positions', [SboPositionController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/sbo-positions', [SboPositionController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/sbo-positions/{position}', [SboPositionController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/sbo-positions/{position}', [SboPositionController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/academic-structure', [AcademicStructureController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/admin/dashboard', [AdminDashboardController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN']);
    Route::post('/academic-structure/class-list/preview', [ClassListImportController::class, 'preview'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/academic-structure/class-list/apply', [ClassListImportController::class, 'apply'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/academic-structure/programs', [AcademicStructureController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/academic-structure/programs/{program}', [AcademicStructureController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/academic-structure/programs/{program}', [AcademicStructureController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Announcement Routes
    Route::get('/announcements', [AnnouncementController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/announcements/generation-quota', [AnnouncementController::class, 'generationQuota'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/announcements/generate-draft', [AnnouncementController::class, 'generateDraft'])->middleware(['throttle:ai-generation', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/announcements', [AnnouncementController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::put('/announcements/{id}', [AnnouncementController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::delete('/announcements/{id}', [AnnouncementController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::patch('/announcements/{id}/publish', [AnnouncementController::class, 'togglePublish'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/announcements/{id}/view', [AnnouncementController::class, 'recordView'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::put('/announcements/{id}/reaction', [AnnouncementController::class, 'react'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::delete('/announcements/{id}/reaction', [AnnouncementController::class, 'unreact'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);

    // SAO Director: separate global administration endpoints, intentionally
    // distinct from all organization operation and AI-generation routes.
    Route::get('/system/overview', [SystemAdministrationController::class, 'overview'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN']);
    Route::get('/system/organizations', [SystemAdministrationController::class, 'organizations'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN']);
    Route::post('/system/organizations', [SystemAdministrationController::class, 'storeOrganization'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/system/organizations/{organization}', [SystemAdministrationController::class, 'updateOrganization'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::post('/system/organizations/{organization}/logo', [SystemAdministrationController::class, 'uploadOrganizationLogo'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/system/colleges', [CollegeController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN']);
    Route::post('/system/colleges', [CollegeController::class, 'store'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/system/colleges/{college}', [CollegeController::class, 'update'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::post('/system/colleges/{college}/logo', [CollegeController::class, 'uploadLogo'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::delete('/system/colleges/{college}', [CollegeController::class, 'destroy'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/system/academic-years', [AcademicYearController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN']);
    Route::post('/system/academic-years/{academicYear}/semesters', [AcademicSemesterController::class, 'store'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::patch('/system/academic-semesters/{academicSemester}/active', [AcademicSemesterController::class, 'activate'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::patch('/system/academic-semesters/{academicSemester}/close', [AcademicSemesterController::class, 'close'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::post('/system/academic-years', [AcademicYearController::class, 'store'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/system/academic-years/{academicYear}', [AcademicYearController::class, 'update'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::patch('/system/academic-years/{academicYear}/current', [AcademicYearController::class, 'makeCurrent'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::patch('/system/academic-years/{academicYear}/close', [AcademicYearController::class, 'close'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::delete('/system/academic-years/{academicYear}', [AcademicYearController::class, 'destroy'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/system/admins', [SystemAdministrationController::class, 'admins'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN']);
    Route::post('/system/admins', [SystemAdministrationController::class, 'storeAdmin'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/system/admins/{user}', [SystemAdministrationController::class, 'updateAdmin'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::delete('/system/admins/{user}', [SystemAdministrationController::class, 'destroyAdmin'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::post('/system/admins/{user}/password-reset', [SystemAdministrationController::class, 'initiateAdminPasswordReset'])->middleware(['throttle:password', 'role:SUPER_ADMIN']);
    Route::post('/system/admins/{user}/handover', [SystemAdministrationController::class, 'handoverAdmin'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/system/organizations/{organization}/members', [SystemAdministrationController::class, 'organizationMembers'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN']);
    Route::get('/system/announcements', [GlobalAnnouncementController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN']);
    Route::post('/system/announcements', [GlobalAnnouncementController::class, 'store'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/system/announcements/{announcement}', [GlobalAnnouncementController::class, 'update'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::patch('/system/announcements/{announcement}/archive', [GlobalAnnouncementController::class, 'archive'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);

    // DigitalPersona capture is performed in the browser. Laravel sends the
    // transient PNG samples to the private SourceAFIS service and stores only
    // encrypted templates. Event identification intentionally uses one scan.
    Route::post('/users/{id}/fingerprint', [FingerprintController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::delete('/users/{id}/fingerprint', [FingerprintController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/fingerprints/identify', [FingerprintController::class, 'identify'])->middleware(['throttle:attendance', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/events/{id}/attendance/fingerprint', [FingerprintController::class, 'attend'])->middleware(['throttle:attendance', 'role:ADMIN,SBO_OFFICER', EnsureCurrentEventSemester::class]);
    Route::post('/events/{id}/attendance/fingerprint/confirm', [FingerprintController::class, 'confirmAttendance'])->middleware(['throttle:attendance', 'role:ADMIN,SBO_OFFICER', EnsureCurrentEventSemester::class]);

    // Event Routes
    Route::get('/events', [EventController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/attendance/personal-summary', [EventController::class, 'personalAttendance'])->middleware(['throttle:api-read', 'role:STUDENT']);
    Route::get('/event-requirements', [EventRequirementController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,DEPARTMENT_HEAD']);
    Route::post('/event-requirements', [EventRequirementController::class, 'store'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/event-requirements/order', [EventRequirementController::class, 'reorder'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/event-requirements/{requirement}', [EventRequirementController::class, 'update'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::delete('/event-requirements/{requirement}', [EventRequirementController::class, 'destroy'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/events/{event}/submission', [EventRequirementController::class, 'showSubmission'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,DEPARTMENT_HEAD']);
    Route::post('/events/{event}/submission', [EventRequirementController::class, 'submit'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentEventSemester::class]);
    Route::get('/events/{event}/submission/files/{file}', [EventRequirementController::class, 'download'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,DEPARTMENT_HEAD']);
    Route::get('/events/{id}', [EventController::class, 'show'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::post('/events', [EventController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/events/{id}', [EventController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentEventSemester::class]);
    Route::delete('/events/{id}', [EventController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentEventSemester::class]);
    Route::patch('/events/{id}/status', [EventController::class, 'updateStatus'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentEventSemester::class]);
    Route::post('/events/{id}/generate-plan', [EventController::class, 'generatePlan'])->middleware(['throttle:ai-generation', 'role:ADMIN', EnsureCurrentEventSemester::class]);
    Route::get('/events/{id}/workflows', [EventController::class, 'workflowHistory'])->middleware(['throttle:api-read', 'role:ADMIN']);
    Route::post('/events/{id}/workflows/{aiOutput}/confirm', [EventController::class, 'confirmWorkflow'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentEventSemester::class]);
    Route::patch('/events/{id}/workflows/{aiOutput}/discard', [EventController::class, 'discardWorkflow'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentEventSemester::class]);
    Route::get('/events/{id}/attendance', [EventController::class, 'getAttendance'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/events/{id}/attendance', [EventController::class, 'recordAttendance'])->middleware(['throttle:attendance', 'role:ADMIN,SBO_OFFICER', EnsureCurrentEventSemester::class]);

    // Task Routes
    Route::get('/tasks', [TaskController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/tasks/recommendation', [TaskController::class, 'recommendation'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/tasks', [TaskController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/tasks/{id}', [TaskController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentTaskSemester::class]);
    Route::delete('/tasks/{id}', [TaskController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentTaskSemester::class]);
    Route::patch('/tasks/{id}/status', [TaskController::class, 'updateStatus'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER', EnsureCurrentTaskSemester::class]);

    // Finance Routes - Budgets
    Route::get('/budgets', [BudgetController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/budgets', [BudgetController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/budgets/{id}/advice', [BudgetController::class, 'advice'])->middleware(['throttle:ai-generation', 'role:ADMIN']);
    Route::put('/budgets/{id}', [BudgetController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/budgets/{id}', [BudgetController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Finance Routes - Transactions
    Route::get('/transactions/summary', [TransactionController::class, 'summary'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::get('/transactions/personal-receipts', [TransactionController::class, 'personalReceipts'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::get('/transactions', [TransactionController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/transactions', [TransactionController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/transactions/{id}', [TransactionController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/transactions/{id}', [TransactionController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Financial accountability: collections are ledgered only after verification; remittances are custody movements.
    Route::get('/financial-dashboard', [FinancialAccountabilityController::class, 'dashboard'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::get('/collections', [FinancialAccountabilityController::class, 'collections'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/collections', [FinancialAccountabilityController::class, 'storeCollection'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/collections/{collection}/verify', [FinancialAccountabilityController::class, 'verifyCollection'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/collections/{collection}/remittances', [FinancialAccountabilityController::class, 'storeRemittance'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/cash-advances', [FinancialAccountabilityController::class, 'advances'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/cash-advances', [FinancialAccountabilityController::class, 'storeAdvance'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/cash-advances/{advance}/approve', [FinancialAccountabilityController::class, 'approveAdvance'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/cash-advances/{advance}/release', [FinancialAccountabilityController::class, 'releaseAdvance'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/cash-advances/{advance}/repayments', [FinancialAccountabilityController::class, 'repayAdvance'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/invoices', [FinancialAccountabilityController::class, 'invoices'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::get('/student-debts', [FinancialAccountabilityController::class, 'studentDebts'])->middleware(['throttle:api-read', 'role:ADMIN,STUDENT']);
    Route::post('/invoices', [FinancialAccountabilityController::class, 'storeInvoice'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/invoices/{invoice}/payments', [FinancialAccountabilityController::class, 'recordInvoicePayment'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/invoices/{invoice}/status', [FinancialAccountabilityController::class, 'closeInvoice'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/audit-logs/export', [FinancialAccountabilityController::class, 'exportAuditLogs'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);
    Route::get('/audit-logs', [FinancialAccountabilityController::class, 'auditLogs'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);

    // Finance Routes - Forecasts
    Route::get('/forecasts', [FinancialForecastController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/forecasts/generate', [FinancialForecastController::class, 'generate'])->middleware(['throttle:ai-generation', 'role:ADMIN']);
    Route::post('/forecasts', [FinancialForecastController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/forecasts/{id}', [FinancialForecastController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/forecasts/{id}', [FinancialForecastController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Finance Routes - Reports
    Route::get('/financial-reports', [FinancialReportController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::get('/financial-semesters', [FinancialSemesterController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN']);
    Route::post('/financial-semesters', [FinancialSemesterController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::post('/financial-reports/generate', [FinancialReportController::class, 'generate'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/financial-reports/{financialReport}', [FinancialReportController::class, 'show'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::get('/financial-reports/{financialReport}/pdf', [FinancialReportController::class, 'downloadPdf'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::post('/financial-reports/{financialReport}/submit', [FinancialReportController::class, 'submit'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Merchandise Routes
    Route::get('/merchandise', [MerchandiseController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/merchandise', [MerchandiseController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/merchandise/{id}', [MerchandiseController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/merchandise/{id}', [MerchandiseController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/merchandise/{id}/stock', [MerchandiseController::class, 'adjustStock'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::get('/merchandise/{id}/audit-logs', [MerchandiseController::class, 'auditHistory'])->middleware(['throttle:api-read', 'role:ADMIN']);
    Route::get('/merchandise/gcash-settings', [GcashSettingsController::class, 'show'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/merchandise/gcash-settings', [GcashSettingsController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Order Routes
    Route::get('/orders', [OrderController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/orders', [OrderController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::patch('/orders/{id}/cancel', [OrderController::class, 'cancel'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::post('/orders/{id}/payment', [OrderController::class, 'submitPayment'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/orders/{id}/audit-logs', [OrderController::class, 'auditHistory'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/orders/claim', [OrderController::class, 'claimByToken'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/orders/claim/verify', [OrderController::class, 'verifyClaimToken'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/orders/analytics/users', [OrderController::class, 'analyticsUsers'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/orders/export', [OrderController::class, 'export'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::get('/orders/{id}/payment-proof', [OrderController::class, 'paymentProof'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT']);

    // Election Module Routes
    Route::get('/elections', [ElectionController::class, 'index'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}', [ElectionController::class, 'show'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}/informative-letter', [ElectionController::class, 'informativeLetter'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}/candidates', [ElectionController::class, 'candidatesIndex'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}/results', [ElectionController::class, 'results'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::get('/elections/{id}/voters', [ElectionController::class, 'voters'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/elections/{id}/vote', [ElectionController::class, 'vote'])->middleware(['throttle:voting', 'role:ADMIN,SBO_OFFICER,DEPARTMENT_HEAD,STUDENT', EnsureCurrentElectionSemester::class]);

    Route::post('/elections', [ElectionController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/elections/{id}', [ElectionController::class, 'update'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentElectionSemester::class]);
    Route::patch('/elections/{id}/finalize', [ElectionController::class, 'finalize'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentElectionSemester::class]);
    Route::delete('/elections/{id}', [ElectionController::class, 'destroy'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentElectionSemester::class]);
    Route::get('/elections/{id}/positions', [ElectionController::class, 'positionsIndex'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER']);
    Route::post('/elections/{id}/positions', [ElectionController::class, 'positionsStore'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentElectionSemester::class]);
    Route::put('/elections/{id}/positions/{positionId}', [ElectionController::class, 'positionsUpdate'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentElectionSemester::class]);
    Route::delete('/elections/{id}/positions/{positionId}', [ElectionController::class, 'positionsDestroy'])->middleware(['throttle:api-write', 'role:ADMIN', EnsureCurrentElectionSemester::class]);
    Route::post('/elections/{id}/candidates', [ElectionController::class, 'candidatesStore'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER', EnsureCurrentElectionSemester::class]);
    Route::put('/elections/{id}/candidates/{candidateId}', [ElectionController::class, 'candidatesUpdate'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER', EnsureCurrentElectionSemester::class]);
    Route::delete('/elections/{id}/candidates/{candidateId}', [ElectionController::class, 'candidatesDestroy'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER', EnsureCurrentElectionSemester::class]);
    Route::get('/partylists', [ElectionController::class, 'partylistsIndex'])->middleware(['throttle:api-read', 'role:ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::post('/partylists', [ElectionController::class, 'partylistsStore'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::put('/partylists/{id}', [ElectionController::class, 'partylistsUpdate'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::delete('/partylists/{id}', [ElectionController::class, 'partylistsDestroy'])->middleware(['throttle:api-write', 'role:ADMIN']);

    // Approval requests: Department Head handles operational sign-off;
    // Super Admin is the final approver for budget and financial records.
    Route::get('/approval-requests', [ApprovalRequestController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,DEPARTMENT_HEAD']);
    Route::patch('/approval-requests/{id}', [ApprovalRequestController::class, 'review'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN,ADMIN,DEPARTMENT_HEAD']);

    // Notification Routes
    Route::get('/notifications', [NotificationController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::patch('/notifications/read-all', [NotificationController::class, 'markAllRead'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::patch('/notifications/{id}/read', [NotificationController::class, 'markRead'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER,STUDENT,DEPARTMENT_HEAD']);
    Route::post('/notifications', [NotificationController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);

    // SAO organization compliance and accreditation: requirement types are
    // SAO's per-academic-year catalog; submissions are each org's own
    // evidence against that catalog, always scoped to the acting org.
    Route::get('/compliance/requirement-types', [ComplianceController::class, 'requirementTypes'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);
    Route::post('/compliance/requirement-types', [ComplianceController::class, 'storeRequirementType'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/compliance/requirement-types/{requirementType}', [ComplianceController::class, 'updateRequirementType'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/compliance/status', [ComplianceController::class, 'status'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);
    Route::get('/compliance/submissions', [ComplianceController::class, 'submissions'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);
    Route::post('/compliance/submissions', [ComplianceController::class, 'storeSubmission'])->middleware(['throttle:api-write', 'role:ADMIN']);
    Route::patch('/compliance/submissions/{submission}/review', [ComplianceController::class, 'reviewSubmission'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/compliance/submissions/{submission}/document', [ComplianceController::class, 'downloadSubmission'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN']);

    // SAO venues and bookings: SUPER_ADMIN owns the venue catalog; ADMIN and
    // SBO_OFFICER request bookings for their own organization only. Overlap
    // detection only ever compares against APPROVED bookings for the venue.
    Route::get('/venues', [VenueController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER']);
    Route::post('/venues', [VenueController::class, 'store'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::put('/venues/{venue}', [VenueController::class, 'update'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::delete('/venues/{venue}', [VenueController::class, 'destroy'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/venues/{venue}/availability', [VenueController::class, 'availability'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER']);
    Route::get('/venue-bookings', [VenueBookingController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER']);
    Route::post('/venue-bookings', [VenueBookingController::class, 'store'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);
    Route::patch('/venue-bookings/{venueBooking}/review', [VenueBookingController::class, 'review'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::patch('/venue-bookings/{venueBooking}/withdraw', [VenueBookingController::class, 'withdraw'])->middleware(['throttle:api-write', 'role:ADMIN,SBO_OFFICER']);

    // Confidential grievances: STUDENT files against own org or directly to
    // SAO; organization_id is always derived from the authenticated student,
    // never accepted from input. See GrievanceController docblock for the
    // anonymity rule.
    Route::get('/grievances', [GrievanceController::class, 'index'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,STUDENT']);
    Route::get('/grievances/{grievance}', [GrievanceController::class, 'show'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,STUDENT']);
    Route::post('/grievances', [GrievanceController::class, 'store'])->middleware(['throttle:api-write', 'role:STUDENT']);
    Route::patch('/grievances/{grievance}/status', [GrievanceController::class, 'updateStatus'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN,ADMIN']);

    // Digital clearances: SUPER_ADMIN defines a period's required signatory
    // roles. The "sao" role is university-wide and signed only by
    // SUPER_ADMIN; every other role is signed only by its own organization's
    // ADMIN or SBO_OFFICER. See ClearanceController docblock.
    Route::get('/clearance-periods', [ClearanceController::class, 'periodsIndex'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER']);
    Route::post('/clearance-periods', [ClearanceController::class, 'periodsStore'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN']);
    Route::get('/clearance-periods/{clearancePeriod}/students', [ClearanceController::class, 'studentsIndex'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER']);
    Route::get('/clearances/mine', [ClearanceController::class, 'mine'])->middleware(['throttle:api-read', 'role:STUDENT']);
    Route::get('/clearance-signatures', [ClearanceController::class, 'signaturesIndex'])->middleware(['throttle:api-read', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER']);
    Route::patch('/clearance-signatures/{clearanceSignature}', [ClearanceController::class, 'sign'])->middleware(['throttle:api-write', 'role:SUPER_ADMIN,ADMIN,SBO_OFFICER']);
});
