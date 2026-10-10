# Frontend–Laravel API route audit

Generated from `php artisan route:list --path=api --json` and frontend `api.*` calls on 2026-09-28. Paths below are relative to Axios base URL `/api`. Upload rows marked `POST → PUT` send `_method=PUT` in multipart data; Laravel routes them to PUT. The table checks route and controller method registration; payload and response behavior require feature tests.

- 158 registered API routes; 156 frontend calls mapped; 0 unresolved calls.
- All controller actions referenced by routes exist; no duplicate method/path registrations were found.
- Public routes: `POST /api/login`, `GET /api/organizations`, `POST /api/password/forgot`, `POST /api/password/reset`, `POST /api/password/reset/validate`, `POST /api/register`.

| Frontend call (under `client/src/`) | HTTP method | Backend route | Controller method |
|---|---|---|---|
| `services/announcementService.js:4` `/announcements` | GET | `/api/announcements` | `AnnouncementController::index` |
| `services/announcementService.js:20` `/announcements` | POST | `/api/announcements` | `AnnouncementController::store` |
| `services/announcementService.js:23` `/announcements/generate-draft` | POST | `/api/announcements/generate-draft` | `AnnouncementController::generateDraft` |
| `services/announcementService.js:26` `/announcements/generation-quota` | GET | `/api/announcements/generation-quota` | `AnnouncementController::generationQuota` |
| `services/announcementService.js:30` `/announcements/${id}` | POST → PUT via _method | `/api/announcements/{id}` | `AnnouncementController::update` |
| `services/announcementService.js:32` `/announcements/${id}` | PUT | `/api/announcements/{id}` | `AnnouncementController::update` |
| `services/announcementService.js:36` `/announcements/${id}` | DELETE | `/api/announcements/{id}` | `AnnouncementController::destroy` |
| `services/announcementService.js:39` `/announcements/${id}/publish` | PATCH | `/api/announcements/{id}/publish` | `AnnouncementController::togglePublish` |
| `services/authService.js:4` `/login` | POST | `/api/login` | `UserController::login` |
| `services/authService.js:8` `/register` | POST | `/api/register` | `UserController::register` |
| `services/authService.js:12` `/logout` | POST | `/api/logout` | `UserController::logout` |
| `services/authService.js:19` `/password/forgot` | POST | `/api/password/forgot` | `UserController::requestPasswordReset` |
| `services/authService.js:23` `/password/reset/validate` | POST | `/api/password/reset/validate` | `UserController::validatePasswordResetToken` |
| `services/authService.js:27` `/password/reset` | POST | `/api/password/reset` | `UserController::resetPassword` |
| `services/authService.js:31` `/user` | GET | `/api/user` | `Closure` |
| `services/authService.js:39` `/user/profiles` | GET | `/api/user/profiles` | `AccountProfileController::index` |
| `services/authService.js:41` `/user/profiles/${profileId}/switch` | POST | `/api/user/profiles/{profile}/switch` | `AccountProfileController::switch` |
| `services/authService.js:43` `/account-profiles/invite` | POST | `/api/account-profiles/invite` | `AccountProfileController::invite` |
| `services/approvalService.js:4` `/approval-requests` | GET | `/api/approval-requests` | `ApprovalRequestController::index` |
| `services/approvalService.js` (not yet called) `/approval-requests/${id}` | GET | `/api/approval-requests/{approvalRequest}` | `ApprovalRequestController::show` |
| `services/approvalService.js:7` `/approval-requests/${id}` | PATCH | `/api/approval-requests/{id}` | `ApprovalRequestController::review` |
| `services/fingerprintService.js:5` `/users/${userId}/fingerprint` | POST | `/api/users/{id}/fingerprint` | `FingerprintController::store` |
| `services/fingerprintService.js:11` `/users/${userId}/fingerprint` | DELETE | `/api/users/{id}/fingerprint` | `FingerprintController::destroy` |
| `services/fingerprintService.js:12` `/fingerprints/identify` | POST | `/api/fingerprints/identify` | `FingerprintController::identify` |
| `services/fingerprintService.js:13` `/events/${eventId}/attendance/fingerprint` | POST | `/api/events/{id}/attendance/fingerprint` | `FingerprintController::attend` |
| `services/fingerprintService.js:17` `/events/${eventId}/attendance/fingerprint/confirm` | POST | `/api/events/{id}/attendance/fingerprint/confirm` | `FingerprintController::confirmAttendance` |
| `services/financeService.js:5` `/budgets` | GET | `/api/budgets` | `BudgetController::index` |
| `services/financeService.js:8` `/budgets` | POST | `/api/budgets` | `BudgetController::store` |
| `services/financeService.js:11` `/budgets/${id}/advice` | POST | `/api/budgets/{id}/advice` | `BudgetController::advice` |
| `services/financeService.js:14` `/budgets/${id}` | PUT | `/api/budgets/{id}` | `BudgetController::update` |
| `services/financeService.js:17` `/budgets/${id}` | DELETE | `/api/budgets/{id}` | `BudgetController::destroy` |
| `services/financeService.js:21` `/transactions` | GET | `/api/transactions` | `TransactionController::index` |
| `services/financeService.js:24` `/transactions/summary` | GET | `/api/transactions/summary` | `TransactionController::summary` |
| `services/financeService.js:27` `/transactions` | POST | `/api/transactions` | `TransactionController::store` |
| `services/financeService.js:30` `/transactions/${id}` | PUT | `/api/transactions/{id}` | `TransactionController::update` |
| `services/financeService.js:33` `/transactions/${id}` | DELETE | `/api/transactions/{id}` | `TransactionController::destroy` |
| `services/financeService.js:36` `/transactions/personal-receipts` | GET | `/api/transactions/personal-receipts` | `TransactionController::personalReceipts` |
| `services/financeService.js:38` `/invoices` | GET | `/api/invoices` | `FinancialAccountabilityController::invoices` |
| `services/financeService.js:39` `/financial-dashboard` | GET | `/api/financial-dashboard` | `FinancialAccountabilityController::dashboard` |
| `services/financeService.js:40` `/collections` | GET | `/api/collections` | `FinancialAccountabilityController::collections` |
| `services/financeService.js:41` `/collections/${id}/verify` | PATCH | `/api/collections/{collection}/verify` | `FinancialAccountabilityController::verifyCollection` |
| `services/financeService.js:42` `/cash-advances` | GET | `/api/cash-advances` | `FinancialAccountabilityController::advances` |
| `services/financeService.js:43` `/cash-advances/${id}/approve` | PATCH | `/api/cash-advances/{advance}/approve` | `FinancialAccountabilityController::approveAdvance` |
| `services/financeService.js:44` `/student-debts` | GET | `/api/student-debts` | `FinancialAccountabilityController::studentDebts` |
| `services/financeService.js:45` `/invoices` | POST | `/api/invoices` | `FinancialAccountabilityController::storeInvoice` |
| `services/financeService.js:46` `/invoices/${invoiceId}/payments` | POST | `/api/invoices/{invoice}/payments` | `FinancialAccountabilityController::recordInvoicePayment` |
| `services/financeService.js:47` `/audit-logs` | GET | `/api/audit-logs` | `FinancialAccountabilityController::auditLogs` |
| `services/financeService.js:51` `/forecasts` | GET | `/api/forecasts` | `FinancialForecastController::index` |
| `services/financeService.js:54` `/forecasts/generate` | POST | `/api/forecasts/generate` | `FinancialForecastController::generate` |
| `services/financeService.js:57` `/forecasts` | POST | `/api/forecasts` | `FinancialForecastController::store` |
| `services/financeService.js:60` `/forecasts/${id}` | PUT | `/api/forecasts/{id}` | `FinancialForecastController::update` |
| `services/financeService.js:63` `/forecasts/${id}` | DELETE | `/api/forecasts/{id}` | `FinancialForecastController::destroy` |
| `services/financeService.js:66` `/financial-semesters` | GET | `/api/financial-semesters` | `FinancialSemesterController::index` |
| `services/financeService.js:68` `/financial-semesters` | POST | `/api/financial-semesters` | `FinancialSemesterController::store` |
| `services/financeService.js:71` `/financial-reports` | GET | `/api/financial-reports` | `FinancialReportController::index` |
| `services/financeService.js:83` `/financial-reports/generate` | POST | `/api/financial-reports/generate` | `FinancialReportController::generate` |
| `services/financeService.js:87` `/financial-reports/${id}` | GET | `/api/financial-reports/{financialReport}` | `FinancialReportController::show` |
| `services/financeService.js:90` `/financial-reports/${id}/pdf` | GET | `/api/financial-reports/{financialReport}/pdf` | `FinancialReportController::downloadPdf` |
| `services/financeService.js:95` `/financial-reports/${id}/submit` | POST | `/api/financial-reports/{financialReport}/submit` | `FinancialReportController::submit` |
| `services/eventService.js:4` `/events` | GET | `/api/events` | `EventController::index` |
| `services/eventService.js:7` `/events/${id}` | GET | `/api/events/{id}` | `EventController::show` |
| `services/eventService.js:9` `/event-requirements` | GET | `/api/event-requirements` | `EventRequirementController::index` |
| `services/eventService.js:10` `/event-requirements` | POST | `/api/event-requirements` | `EventRequirementController::store` |
| `services/eventService.js:11` `/event-requirements/${id}` | PUT | `/api/event-requirements/{requirement}` | `EventRequirementController::update` |
| `services/eventService.js:12` `/events/${id}/submission` | GET | `/api/events/{event}/submission` | `EventRequirementController::showSubmission` |
| `services/eventService.js:18` `/events/${id}/submission` | POST | `/api/events/{event}/submission` | `EventRequirementController::submit` |
| `services/eventService.js:21` `/events/${eventId}/submission/files/${fileId}` | GET | `/api/events/{event}/submission/files/{file}` | `EventRequirementController::download` |
| `services/eventService.js:39` `/events` | POST | `/api/events` | `EventController::store` |
| `services/eventService.js:42` `/events/${id}` | POST → PUT via _method | `/api/events/{id}` | `EventController::update` |
| `services/eventService.js:43` `/events/${id}` | PUT | `/api/events/{id}` | `EventController::update` |
| `services/eventService.js:46` `/events/${id}` | DELETE | `/api/events/{id}` | `EventController::destroy` |
| `services/eventService.js:49` `/events/${id}/status` | PATCH | `/api/events/{id}/status` | `EventController::updateStatus` |
| `services/eventService.js:52` `/events/${id}/generate-plan` | POST | `/api/events/{id}/generate-plan` | `EventController::generatePlan` |
| `services/eventService.js:55` `/events/${id}/workflows` | GET | `/api/events/{id}/workflows` | `EventController::workflowHistory` |
| `services/eventService.js:58` `/events/${eventId}/workflows/${outputId}/confirm` | POST | `/api/events/{id}/workflows/{aiOutput}/confirm` | `EventController::confirmWorkflow` |
| `services/eventService.js:61` `/events/${eventId}/workflows/${outputId}/discard` | PATCH | `/api/events/{id}/workflows/{aiOutput}/discard` | `EventController::discardWorkflow` |
| `services/eventService.js:64` `/events/${id}/attendance` | GET | `/api/events/{id}/attendance` | `EventController::getAttendance` |
| `services/eventService.js:67` `/events/${id}/attendance` | POST | `/api/events/{id}/attendance` | `EventController::recordAttendance` |
| `services/electionService.js:5` `/elections` | GET | `/api/elections` | `ElectionController::index` |
| `services/electionService.js:6` `/elections/${id}` | GET | `/api/elections/{id}` | `ElectionController::show` |
| `services/electionService.js:31` `/elections` | POST | `/api/elections` | `ElectionController::store` |
| `services/electionService.js:35` `/elections/${id}` | POST → PUT via _method | `/api/elections/{id}` | `ElectionController::update` |
| `services/electionService.js:37` `/elections/${id}` | PUT | `/api/elections/{id}` | `ElectionController::update` |
| `services/electionService.js:39` `/elections/${id}` | DELETE | `/api/elections/{id}` | `ElectionController::destroy` |
| `services/electionService.js:41` `/elections/${id}/positions` | GET | `/api/elections/{id}/positions` | `ElectionController::positionsIndex` |
| `services/electionService.js:42` `/elections/${id}/positions` | POST | `/api/elections/{id}/positions` | `ElectionController::positionsStore` |
| `services/electionService.js:43` `/elections/${id}/positions/${positionId}` | PUT | `/api/elections/{id}/positions/{positionId}` | `ElectionController::positionsUpdate` |
| `services/electionService.js:44` `/elections/${id}/positions/${positionId}` | DELETE | `/api/elections/{id}/positions/{positionId}` | `ElectionController::positionsDestroy` |
| `services/electionService.js:46` `/elections/${id}/candidates` | GET | `/api/elections/{id}/candidates` | `ElectionController::candidatesIndex` |
| `services/electionService.js:58` `/elections/${id}/candidates` | POST | `/api/elections/{id}/candidates` | `ElectionController::candidatesStore` |
| `services/electionService.js:63` `/elections/${id}/candidates/${candidateId}` | POST → PUT via _method | `/api/elections/{id}/candidates/{candidateId}` | `ElectionController::candidatesUpdate` |
| `services/electionService.js:66` `/elections/${id}/candidates/${candidateId}` | DELETE | `/api/elections/{id}/candidates/{candidateId}` | `ElectionController::candidatesDestroy` |
| `services/electionService.js:77` `/partylists` | GET | `/api/partylists` | `ElectionController::partylistsIndex` |
| `services/electionService.js:79` `/partylists` | POST | `/api/partylists` | `ElectionController::partylistsStore` |
| `services/electionService.js:83` `/partylists/${id}` | POST → PUT via _method | `/api/partylists/{id}` | `ElectionController::partylistsUpdate` |
| `services/electionService.js:85` `/partylists/${id}` | DELETE | `/api/partylists/{id}` | `ElectionController::partylistsDestroy` |
| `services/electionService.js:87` `/users` | GET | `/api/users` | `UserController::index` |
| `services/electionService.js:89` `/elections/${electionId}/vote` | POST | `/api/elections/{id}/vote` | `ElectionController::vote` |
| `services/electionService.js:90` `/elections/${id}/results` | GET | `/api/elections/{id}/results` | `ElectionController::results` |
| `services/electionService.js:91` `/elections/${id}/voters` | GET | `/api/elections/{id}/voters` | `ElectionController::voters` |
| `services/userService.js:5` `/users` | GET | `/api/users` | `UserController::index` |
| `services/userService.js:6` `/users` | POST | `/api/users` | `UserController::store` |
| `services/userService.js:7` `/users/${id}` | PUT | `/api/users/{id}` | `UserController::update` |
| `services/userService.js:8` `/sbo-positions` | GET | `/api/sbo-positions` | `SboPositionController::index` |
| `services/userService.js:9` `/sbo-positions` | POST | `/api/sbo-positions` | `SboPositionController::store` |
| `services/userService.js:10` `/sbo-positions/${id}` | PUT | `/api/sbo-positions/{position}` | `SboPositionController::update` |
| `services/userService.js:11` `/sbo-positions/${id}` | DELETE | `/api/sbo-positions/{position}` | `SboPositionController::destroy` |
| `services/userService.js:12` `/academic-structure` | GET | `/api/academic-structure` | `AcademicStructureController::index` |
| `services/userService.js:13` `/academic-structure/programs` | POST | `/api/academic-structure/programs` | `AcademicStructureController::store` |
| `services/userService.js:14` `/academic-structure/programs/${id}` | PUT | `/api/academic-structure/programs/{program}` | `AcademicStructureController::update` |
| `services/userService.js:15` `/academic-structure/programs/${id}` | DELETE | `/api/academic-structure/programs/{program}` | `AcademicStructureController::destroy` |
| `services/userService.js:16` `/users/${id}/disable` | POST | `/api/users/{id}/disable` | `UserController::disable` |
| `services/userService.js:17` `/users/${id}/reactivate` | POST | `/api/users/{id}/reactivate` | `UserController::reactivate` |
| `services/userService.js:18` `/users/${id}` | DELETE | `/api/users/{id}` | `UserController::destroy` |
| `services/taskService.js:4` `/tasks` | GET | `/api/tasks` | `TaskController::index` |
| `services/taskService.js:7` `/tasks` | POST | `/api/tasks` | `TaskController::store` |
| `services/taskService.js:10` `/tasks/${id}` | PUT | `/api/tasks/{id}` | `TaskController::update` |
| `services/taskService.js:13` `/tasks/${id}` | DELETE | `/api/tasks/{id}` | `TaskController::destroy` |
| `services/taskService.js:16` `/tasks/${id}/status` | PATCH | `/api/tasks/{id}/status` | `TaskController::updateStatus` |
| `services/systemAdministrationService.js:5` `/system/overview` | GET | `/api/system/overview` | `SystemAdministrationController::overview` |
| `services/systemAdministrationService.js:6` `/system/organizations` | GET | `/api/system/organizations` | `SystemAdministrationController::organizations` |
| `services/systemAdministrationService.js:8` `/system/organizations/${id}` | PUT | `/api/system/organizations/{organization}` | `SystemAdministrationController::updateOrganization` |
| `services/systemAdministrationService.js:9` `/system/admins` | GET | `/api/system/admins` | `SystemAdministrationController::admins` |
| `services/systemAdministrationService.js:10` `/system/admins` | POST | `/api/system/admins` | `SystemAdministrationController::storeAdmin` |
| `services/systemAdministrationService.js:11` `/system/admins/${id}` | PUT | `/api/system/admins/{user}` | `SystemAdministrationController::updateAdmin` |
| `services/systemAdministrationService.js:12` `/system/admins/${id}` | DELETE | `/api/system/admins/{user}` | `SystemAdministrationController::destroyAdmin` |
| `services/systemAdministrationService.js:13` `/system/admins/${id}/password-reset` | POST | `/api/system/admins/{user}/password-reset` | `SystemAdministrationController::initiateAdminPasswordReset` |
| `services/systemAdministrationService.js:14` `/system/announcements` | GET | `/api/system/announcements` | `GlobalAnnouncementController::index` |
| `services/systemAdministrationService.js:15` `/system/announcements` | POST | `/api/system/announcements` | `GlobalAnnouncementController::store` |
| `services/systemAdministrationService.js:16` `/system/announcements/${id}` | PUT | `/api/system/announcements/{announcement}` | `GlobalAnnouncementController::update` |
| `services/systemAdministrationService.js:17` `/system/announcements/${id}/archive` | PATCH | `/api/system/announcements/{announcement}/archive` | `GlobalAnnouncementController::archive` |
| `services/studentFeedService.js:4` `/student/feed` | GET | `/api/student/feed` | `StudentFeedController::index` |
| `services/profileService.js:4` `/user/profile` | PUT | `/api/user/profile` | `UserController::updateProfile` |
| `services/profileService.js:7` `/user/password` | PUT | `/api/user/password` | `UserController::updatePassword` |
| `services/organizationService.js:4` `/organizations` | GET | `/api/organizations` | `OrganizationController::index` |
| `services/notificationService.js:4` `/notifications` | GET | `/api/notifications` | `NotificationController::index` |
| `services/notificationService.js:7` `/notifications/${id}/read` | PATCH | `/api/notifications/{id}/read` | `NotificationController::markRead` |
| `services/notificationService.js:10` `/notifications/read-all` | PATCH | `/api/notifications/read-all` | `NotificationController::markAllRead` |
| `services/notificationService.js:13` `/notifications` | POST | `/api/notifications` | `NotificationController::store` |
| `services/orderService.js:4` `/orders` | GET | `/api/orders` | `OrderController::index` |
| `services/orderService.js:7` `/orders/analytics/users` | GET | `/api/orders/analytics/users` | `OrderController::analyticsUsers` |
| `services/orderService.js:10` `/orders/${id}/audit-logs` | GET | `/api/orders/{id}/audit-logs` | `OrderController::auditHistory` |
| `services/orderService.js:13` `/orders/export` | GET | `/api/orders/export` | `OrderController::export` |
| `services/orderService.js:20` `/orders` | POST | `/api/orders` | `OrderController::store` |
| `services/orderService.js:27` `/orders/${id}/payment` | POST | `/api/orders/{id}/payment` | `OrderController::submitPayment` |
| `services/orderService.js:31` `/orders/${id}/cancel` | PATCH | `/api/orders/{id}/cancel` | `OrderController::cancel` |
| `services/orderService.js:42` `/orders/${id}/payment-proof` | GET | `/api/orders/{id}/payment-proof` | `OrderController::paymentProof` |
| `services/orderService.js:64` `/orders/${id}/status` | PATCH | `/api/orders/{id}/status` | `OrderController::updateStatus` |
| `services/orderService.js:67` `/orders/claim` | POST | `/api/orders/claim` | `OrderController::claimByToken` |
| `services/merchandiseService.js:4` `/merchandise` | GET | `/api/merchandise` | `MerchandiseController::index` |
| `services/merchandiseService.js:22` `/merchandise` | POST | `/api/merchandise` | `MerchandiseController::store` |
| `services/merchandiseService.js:27` `/merchandise/${id}` | POST → PUT via _method | `/api/merchandise/{id}` | `MerchandiseController::update` |
| `services/merchandiseService.js:31` `/merchandise/${id}` | DELETE | `/api/merchandise/{id}` | `MerchandiseController::destroy` |
| `services/merchandiseService.js:34` `/merchandise/${id}/stock` | PATCH | `/api/merchandise/{id}/stock` | `MerchandiseController::adjustStock` |
| `services/merchandiseService.js:36` `/merchandise/gcash-settings` | GET | `/api/merchandise/gcash-settings` | `GcashSettingsController::show` |
| `services/merchandiseService.js:41` `/merchandise/gcash-settings` | POST | `/api/merchandise/gcash-settings` | `GcashSettingsController::update` |

The production server cannot be inspected from this repository. Verify its deployed commit, migrations, route cache, Nginx forwarding, and built frontend on Lightsail before treating this local audit as a live result.
