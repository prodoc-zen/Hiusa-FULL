import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from './components/layout/DashboardLayout';
import ProtectedRoute from './ProtectedRoute';
import LoggedInRoute from './LoggedInRoute';

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const OrganizationSelectPage = lazy(() => import('./pages/auth/OrganizationSelectPage'));
const RecoverAccountPage = lazy(() => import('./pages/auth/RecoverAccountPage'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage'));
const DashboardPage = lazy(() => import('./pages/roles/officer/DashboardPage'));
const AdminHomePage = lazy(() => import('./pages/roles/admin/AdminHomePage'));
const DepartmentHeadHomePage = lazy(() => import('./pages/roles/department-head/DepartmentHeadHomePage'));
const DepartmentHeadApprovalsPage = lazy(() => import('./pages/roles/department-head/DepartmentHeadApprovalsPage'));
const StudentHomePage = lazy(() => import('./pages/roles/student/StudentHomePage'));
const AdminUsersPage = lazy(() => import('./pages/roles/admin/AdminUsersPage'));
const ManageSboPositionsPage = lazy(() => import('./pages/roles/admin/ManageSboPositionsPage'));
const ManageAcademicStructurePage = lazy(() => import('./pages/roles/admin/ManageAcademicStructurePage'));
const GeneralAuditLogPage = lazy(() => import('./pages/roles/admin/GeneralAuditLogPage'));
const FinancePage = lazy(() => import('./pages/modules/finance/FinancePage'));
const StudentFinancialAccountsPage = lazy(() => import('./pages/modules/finance/StudentFinancialAccountsPage'));
const EventsPage = lazy(() => import('./pages/modules/events/EventsPage'));
const TasksPage = lazy(() => import('./pages/modules/tasks/TasksPage'));
const MerchandisePage = lazy(() => import('./pages/modules/merchandise/MerchandisePage'));
const GcashPaymentSettingsPage = lazy(() => import('./pages/modules/merchandise/GcashPaymentSettingsPage'));
const ManageAnnouncementsPage = lazy(() => import('./pages/modules/announcements/ManageAnnouncementsPage'));
const CreateAnnouncementPage = lazy(() => import('./pages/modules/announcements/CreateAnnouncementPage'));
const AnnouncementsFeedPage = lazy(() => import('./pages/modules/announcements/AnnouncementsFeedPage'));
const SettingsPage = lazy(() => import('./pages/modules/settings/SettingsPage'));
const ElectionsHub = lazy(() => import('./pages/modules/elections/ElectionsHub'));
const ElectionDetailPage = lazy(() => import('./pages/modules/elections/ElectionDetailPage'));
const ManageCandidatesPage = lazy(() => import('./pages/modules/elections/ManageCandidatesPage'));
const ManagePartylistsPage = lazy(() => import('./pages/modules/elections/ManagePartylistsPage'));
const ManageVotersPage = lazy(() => import('./pages/modules/elections/ManageVotersPage'));
const ElectionResultsPage = lazy(() => import('./pages/modules/elections/ElectionResultsPage'));
const CastVoteRedirectPage = lazy(() => import('./pages/modules/elections/CastVoteRedirectPage'));
const ImmersiveVotePage = lazy(() => import('./pages/modules/elections/ImmersiveVotePage'));

function RouteLoadingFallback() {
  return (
    <div className="space-y-4 p-1" role="status" aria-label="Loading page">
      <div className="h-28 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />)}
      </div>
      <span className="sr-only">Loading page...</span>
    </div>
  );
}

function getStoredRole() {
  const storedUser = localStorage.getItem('user');

  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser)?.role || null;
  } catch {
    return null;
  }
}

function DashboardIndexRedirect() {
  const role = getStoredRole();
  const allowedRoles = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

  if (role && allowedRoles.includes(role)) {
    const path = role === 'DEPARTMENT_HEAD' ? 'department-head' : role.toLowerCase().replace('sbo_officer', 'officer');
    return <Navigate to={`/dashboard/${path}`} replace />;
  }

  return <Navigate to="/login" replace />;
}

function ElectionsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'ADMIN') {
    return <Navigate to="manage-elections" replace />;
  }

  if (role === 'DEPARTMENT_HEAD') {
    return <Navigate to="election-results" replace />;
  }

  if (role === 'STUDENT') {
    return <Navigate to="cast-vote" replace />;
  }

  return <Navigate to="manage-candidates" replace />;
}

function EventsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'STUDENT' || role === 'DEPARTMENT_HEAD') {
    return <Navigate to="activity-calendar" replace />;
  }

  if (role === 'SBO_OFFICER') {
    return <Navigate to="event-operations" replace />;
  }

  return <Navigate to="manage-events" replace />;
}

function FinanceIndexRedirect() {
  const role = getStoredRole();

  if (role === 'ADMIN') {
    return <Navigate to="financial-ledger" replace />;
  }

  if (role === 'DEPARTMENT_HEAD') {
    return <Navigate to="transaction-history" replace />;
  }

  if (role === 'STUDENT') {
    return <Navigate to="personal-receipts" replace />;
  }

  return <Navigate to="financial-insights" replace />;
}

function TasksIndexRedirect() {
  const role = getStoredRole();

  if (role === 'ADMIN') {
    return <Navigate to="task-board" replace />;
  }

  return <Navigate to="assigned-tasks" replace />;
}

function MerchandiseIndexRedirect() {
  const role = getStoredRole();

  if (role === 'ADMIN') {
    return <Navigate to="manage-inventory" replace />;
  }

  if (role === 'SBO_OFFICER') {
    return <Navigate to="manage-orders" replace />;
  }

  if (role === 'STUDENT' || role === 'DEPARTMENT_HEAD') {
    return <Navigate to="order-merchandise" replace />;
  }

  return <Navigate to="order-merchandise" replace />;
}

function AnnouncementsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'ADMIN' || role === 'SBO_OFFICER') {
    return <Navigate to="manage-announcements" replace />;
  }

  return <Navigate to="view-announcements" replace />;
}

function NotFoundRedirect() {
  return <Navigate to={localStorage.getItem('auth_token') ? '/dashboard' : '/select-organization'} replace />;
}

function App() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
      {/* Authentication */}
      <Route path="/" element={<Navigate to="/select-organization" replace />} />
      <Route element={<LoggedInRoute />}>
        <Route path="/select-organization" element={<OrganizationSelectPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recover-account" element={<RecoverAccountPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      

      {/* Dashboard Pages */}
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          {/* Role Home Pages */}
          <Route index element={<DashboardIndexRedirect />} />
          <Route path="admin" element={<ProtectedRoute allowedRoles={["ADMIN"]}><AdminHomePage /></ProtectedRoute>} />
          <Route path="officer" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><DashboardPage /></ProtectedRoute>} />
          <Route path="department-head" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD"]}><DepartmentHeadHomePage /></ProtectedRoute>} />
          <Route path="department-head/approvals" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD"]}><DepartmentHeadApprovalsPage /></ProtectedRoute>} />
          <Route path="approvals" element={<ProtectedRoute allowedRoles={["ADMIN", "DEPARTMENT_HEAD"]}><DepartmentHeadApprovalsPage /></ProtectedRoute>} />
          <Route path="student" element={<ProtectedRoute allowedRoles={["STUDENT"]}><StudentHomePage /></ProtectedRoute>} />
          <Route path="admin/users" element={<ProtectedRoute allowedRoles={["ADMIN"]}><AdminUsersPage /></ProtectedRoute>} />
          <Route path="admin/sbo-positions" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ManageSboPositionsPage /></ProtectedRoute>} />
          <Route path="admin/positions" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ManageSboPositionsPage /></ProtectedRoute>} />
          <Route path="admin/programs-sections" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ManageAcademicStructurePage /></ProtectedRoute>} />
          <Route path="audit-logs" element={<ProtectedRoute allowedRoles={["ADMIN"]}><GeneralAuditLogPage /></ProtectedRoute>} />

          {/* Shared Modules */}
          <Route path="announcements">
            <Route index element={<AnnouncementsIndexRedirect />} />
            <Route path="manage-announcements" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><ManageAnnouncementsPage /></ProtectedRoute>} />
            <Route path="create-announcement" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><CreateAnnouncementPage /></ProtectedRoute>} />
            <Route path="view-announcements" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT", "DEPARTMENT_HEAD"]}><AnnouncementsFeedPage /></ProtectedRoute>} />
          </Route>

          <Route path="events">
            <Route index element={<EventsIndexRedirect />} />
            <Route path="manage-events" element={<ProtectedRoute allowedRoles={["ADMIN"]}><EventsPage initialTab="events" /></ProtectedRoute>} />
            <Route path="event-planner" element={<ProtectedRoute allowedRoles={["ADMIN"]}><EventsPage initialTab="tasks" /></ProtectedRoute>} />
            <Route path="event-operations" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><EventsPage initialTab="attendance" /></ProtectedRoute>} />
            <Route path="check-in" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT", "DEPARTMENT_HEAD"]}><EventsPage initialTab="attendance" /></ProtectedRoute>} />
            <Route path="activity-calendar" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN", "STUDENT", "DEPARTMENT_HEAD"]}><EventsPage initialTab="events" /></ProtectedRoute>} />
          </Route>

          <Route path="finance">
            <Route index element={<FinanceIndexRedirect />} />
            <Route path="financial-ledger" element={<ProtectedRoute allowedRoles={["ADMIN"]}><FinancePage initialTab="transactions" /></ProtectedRoute>} />
            <Route path="student-accounts" element={<ProtectedRoute allowedRoles={["ADMIN"]}><StudentFinancialAccountsPage /></ProtectedRoute>} />
            <Route path="budget-allocation" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN", "DEPARTMENT_HEAD"]}><FinancePage initialTab="budgets" /></ProtectedRoute>} />
            <Route path="financial-insights" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><FinancePage initialTab="forecasting" /></ProtectedRoute>} />
            <Route path="transaction-history" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN", "DEPARTMENT_HEAD"]}><FinancePage initialTab="reports" /></ProtectedRoute>} />
            <Route path="personal-receipts" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]}><FinancePage initialTab="receipts" /></ProtectedRoute>} />
            <Route path="statement-of-account" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]}><FinancePage initialTab="invoices" /></ProtectedRoute>} />
          </Route>

          <Route path="merchandise">
            <Route index element={<MerchandiseIndexRedirect />} />
            <Route path="manage-inventory" element={<ProtectedRoute allowedRoles={["ADMIN"]}><MerchandisePage initialTab="inventory" /></ProtectedRoute>} />
            <Route path="gcash-payment" element={<ProtectedRoute allowedRoles={["ADMIN"]}><GcashPaymentSettingsPage /></ProtectedRoute>} />
            <Route path="manage-orders" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><MerchandisePage initialTab="orders" /></ProtectedRoute>} />
            <Route path="claim-tokens" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT", "DEPARTMENT_HEAD"]}><MerchandisePage initialTab="tokens" /></ProtectedRoute>} />
            <Route path="order-merchandise" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]}><MerchandisePage initialTab="order" /></ProtectedRoute>} />
            <Route path="my-orders" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]}><MerchandisePage initialTab="my-orders" /></ProtectedRoute>} />
          </Route>

          <Route path="tasks">
            <Route index element={<TasksIndexRedirect />} />
            <Route path="task-board" element={<ProtectedRoute allowedRoles={["ADMIN"]}><TasksPage initialTab="board" /></ProtectedRoute>} />
            <Route path="create-task" element={<ProtectedRoute allowedRoles={["ADMIN"]}><TasksPage initialTab="create" /></ProtectedRoute>} />
            <Route path="assigned-tasks" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><TasksPage initialTab="board" /></ProtectedRoute>} />
            <Route path="task-progress" element={<ProtectedRoute allowedRoles={["ADMIN"]}><TasksPage initialTab="progress" /></ProtectedRoute>} />
            <Route path="ai-delegation" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><TasksPage initialTab="ai" /></ProtectedRoute>} />
          </Route>

          {/* Manage Profile */}
          <Route path="profile" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT", "DEPARTMENT_HEAD"]}><SettingsPage /></ProtectedRoute>} />
          <Route path="organization" element={<Navigate to="/dashboard/profile" replace />} />
          <Route path="settings" element={<Navigate to="/dashboard/profile" replace />} />

          {/* Election module - nested routes */}
          <Route path="elections" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN", "STUDENT", "DEPARTMENT_HEAD"]}><ElectionsHub /></ProtectedRoute>}>
            <Route index element={<ElectionsIndexRedirect />} />
            <Route path="manage-elections" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ElectionDetailPage /></ProtectedRoute>} />
            <Route path="manage-candidates" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><ManageCandidatesPage /></ProtectedRoute>} />
            <Route path="manage-partylists" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ManagePartylistsPage /></ProtectedRoute>} />
            <Route path="manage-voters" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><ManageVotersPage /></ProtectedRoute>} />
            <Route path="cast-vote" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]}><CastVoteRedirectPage /></ProtectedRoute>} />
            <Route path="election-results" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]}><ElectionResultsPage /></ProtectedRoute>} />

            {/* Legacy election links redirected to REFERENCE view IDs */}
            <Route path="manage" element={<Navigate to="../manage-elections" replace />} />
            <Route path="candidates" element={<Navigate to="../manage-candidates" replace />} />
            <Route path="partylists" element={<Navigate to="../manage-partylists" replace />} />
            <Route path="voters" element={<Navigate to="../manage-voters" replace />} />
            <Route path="results" element={<Navigate to="../election-results" replace />} />
          </Route>

        </Route>
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]} />}>
        <Route path="/elections/:electionId/vote" element={<ImmersiveVotePage />} />
      </Route>
      <Route path="*" element={<NotFoundRedirect />} />
      </Routes>
    </Suspense>
  );
}

export default App;
