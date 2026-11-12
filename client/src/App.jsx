import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import DashboardLayout from './components/layout/DashboardLayout';
import RouteLoadingFallback from './components/layout/RouteLoadingFallback';
import ProtectedRoute from './ProtectedRoute';
import LoggedInRoute from './LoggedInRoute';
import SessionExpiry from './components/auth/SessionExpiry';
import { isOfficeStaff, storedUser } from './utils/collegeIdentity';

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const StudentSignUpPage = lazy(() => import('./pages/auth/StudentSignUpPage'));
const LandingPage = lazy(() => import('./pages/auth/LandingPage'));
const OrganizationApplicationsPage = lazy(() => import('./pages/modules/sao/OrganizationApplicationsPage'));
const RecoverAccountPage = lazy(() => import('./pages/auth/RecoverAccountPage'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage'));
const AcceptInvitationPage = lazy(() => import('./pages/auth/AcceptInvitationPage'));
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePasswordPage'));
const DashboardPage = lazy(() => import('./pages/roles/officer/DashboardPage'));
const AdminHomePage = lazy(() => import('./pages/roles/admin/AdminHomePage'));
const OfficeStaffHomePage = lazy(() => import('./pages/roles/admin/OfficeStaffHomePage'));
const SuperAdminHomePage = lazy(() => import('./pages/roles/super-admin/SuperAdminHomePage'));
const SaoOrganizationOverviewPage = lazy(() => import('./pages/roles/super-admin/SaoOrganizationOverviewPage'));
const SystemOrganizationsPage = lazy(() => import('./pages/roles/super-admin/SystemOrganizationsPage'));
const SystemCollegesPage = lazy(() => import('./pages/roles/super-admin/SystemCollegesPage'));
const StudentRecordsPage = lazy(() => import('./pages/roles/super-admin/StudentRecordsPage'));
const SaoUsersPage = lazy(() => import('./pages/roles/super-admin/SaoUsersPage'));
const SaoDocumentsPage = lazy(() => import('./pages/modules/sao/DocumentsTab'));
const RecordsPage = lazy(() => import('./pages/modules/records/RecordsPage'));
const CollegeCompliancePage = lazy(() => import('./pages/roles/department-head/CollegeCompliancePage'));
const SaoStoragePage = lazy(() => import('./pages/modules/sao/StorageOverview'));
const GlobalAnnouncementsPage = lazy(() => import('./pages/roles/super-admin/GlobalAnnouncementsPage'));
const DepartmentHeadAnnouncementsPage = lazy(() => import('./pages/roles/department-head/DepartmentHeadAnnouncementsPage'));
const SaoNotificationsPage = lazy(() => import('./pages/roles/super-admin/SaoNotificationsPage'));
const DepartmentHeadHomePage = lazy(() => import('./pages/roles/department-head/DepartmentHeadHomePage'));
const DepartmentHeadApprovalsPage = lazy(() => import('./pages/roles/department-head/DepartmentHeadApprovalsPage'));
const CollegeOrganizationsPage = lazy(() => import('./pages/roles/department-head/CollegeOrganizationsPage'));
const OrgSpacePage = lazy(() => import('./pages/roles/department-head/OrgSpacePage'));
const CollegePeoplePage = lazy(() => import('./pages/roles/department-head/CollegePeoplePage'));
const SubmitApprovalRequestPage = lazy(() => import('./pages/modules/approvals/SubmitApprovalRequestPage'));
const StudentHomePage = lazy(() => import('./pages/roles/student/StudentHomePage'));
const ApplyOrganizationPage = lazy(() => import('./pages/roles/student/ApplyOrganizationPage'));
const MyOrganizationApplicationPage = lazy(() => import('./pages/roles/student/MyOrganizationApplicationPage'));
const AdminUsersPage = lazy(() => import('./pages/roles/admin/AdminUsersPage'));
const ManageSboPositionsPage = lazy(() => import('./pages/roles/admin/ManageSboPositionsPage'));
const ManageAcademicStructurePage = lazy(() => import('./pages/roles/admin/ManageAcademicStructurePage'));
const GeneralAuditLogPage = lazy(() => import('./pages/roles/admin/GeneralAuditLogPage'));
const FinancePage = lazy(() => import('./pages/modules/finance/FinancePage'));
const FinancialCollectionsPage = lazy(() => import('./pages/modules/finance/FinancialCollectionsPage'));
const StudentFinancialAccountsPage = lazy(() => import('./pages/modules/finance/StudentFinancialAccountsPage'));
const EventsPage = lazy(() => import('./pages/modules/events/EventsPage'));
const TasksPage = lazy(() => import('./pages/modules/tasks/TasksPage'));
const MerchandisePage = lazy(() => import('./pages/modules/merchandise/MerchandisePage'));
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
const SaoCompliancePage = lazy(() => import('./pages/modules/sao/SaoCompliancePage'));
const SaoVenuesPage = lazy(() => import('./pages/modules/venues/SaoVenuesPage'));
const AcademicYearsPage = lazy(() => import('./pages/roles/super-admin/AcademicYearsPage'));
const SaoGrievancesPage = lazy(() => import('./pages/modules/grievances/SaoGrievancesPage'));
const SaoClearancesPage = lazy(() => import('./pages/modules/clearances/SaoClearancesPage'));
const OrganizationCompliancePage = lazy(() => import('./pages/modules/sao/OrganizationCompliancePage'));
const SubmittedFilesPage = lazy(() => import('./pages/modules/sao/SubmittedFilesPage'));
const VenueBookingPage = lazy(() => import('./pages/modules/venues/VenueBookingPage'));
const OrganizationGrievancesPage = lazy(() => import('./pages/modules/grievances/OrganizationGrievancesPage'));
const StudentGrievancesPage = lazy(() => import('./pages/modules/grievances/StudentGrievancesPage'));
const SignatoryClearancesPage = lazy(() => import('./pages/modules/clearances/SignatoryClearancesPage'));
const StudentClearancePage = lazy(() => import('./pages/modules/clearances/StudentClearancePage'));
const AskAiPage = lazy(() => import('./pages/modules/ai/AskAiPage'));
const UiKitPage = import.meta.env.DEV ? lazy(() => import('./pages/dev/UiKitPage')) : null;

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
  const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

  if (role && allowedRoles.includes(role)) {
    const path = role === 'DEPARTMENT_HEAD' ? 'department-head' : role === 'SUPER_ADMIN' ? 'super-admin' : role.toLowerCase().replace('sbo_officer', 'officer');
    return <Navigate to={`/dashboard/${path}`} replace />;
  }

  return <Navigate to="/" replace />;
}

// The election hub shows its own picker before any page below it renders, so the child routes'
// allowedRoles are never reached for these pages. Keep this list equal to theirs.
const ELECTION_MANAGE_PAGE_ROLES = {
  'manage-elections': ['ADMIN'],
  'manage-candidates': ['ADMIN', 'SBO_OFFICER'],
  'manage-partylists': ['ADMIN'],
  'manage-voters': ['SBO_OFFICER'],
};

function ElectionPageGate({ children }) {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '');
  if (path === '/dashboard/elections' && getStoredRole() === 'STUDENT') return <Navigate to="/dashboard/elections/cast-vote" replace />;
  const allowedRoles = ELECTION_MANAGE_PAGE_ROLES[path.split('/').pop()];
  return allowedRoles ? <ProtectedRoute allowedRoles={allowedRoles}>{children}</ProtectedRoute> : children;
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
    return <Navigate to="check-in" replace />;
  }

  return <Navigate to="manage-events" replace />;
}

function FinanceIndexRedirect() {
  const role = getStoredRole();

  if (role === 'ADMIN' || role === 'DEPARTMENT_HEAD') {
    return <Navigate to="financial-ledger" replace />;
  }

  return <Navigate to="personal-receipts" replace />;
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

  return <Navigate to="order-merchandise" replace />;
}

function MerchandiseClaimTokensRoute() {
  const role = getStoredRole();
  if (role === 'ADMIN' || role === 'SBO_OFFICER') {
    return <MerchandisePage initialTab="tokens" />;
  }
  return <Navigate to="/dashboard/merchandise/my-orders" replace />;
}

function ApprovalsRoute() {
  if (getStoredRole() === 'DEPARTMENT_HEAD') {
    return <Navigate to="/dashboard/department-head/approvals" replace />;
  }

  return <DepartmentHeadApprovalsPage />;
}

// The role is read when the route renders, not when App renders: App does not re-render after sign-in.
function RecordsRoute() {
  return <RecordsPage role={getStoredRole()} />;
}

function SubmittedFilesRoute() {
  return <SubmittedFilesPage role={getStoredRole()} />;
}

// An ADMIN profile on the college home organization is the dean's office staff: their home is the
// applications queue, not an organization head's setup. The user is read when the route renders.
function AdminHomeRoute() {
  return isOfficeStaff(storedUser()) ? <OfficeStaffHomePage /> : <AdminHomePage />;
}

function OfficeReviewRoute({ children }) {
  const user = storedUser();
  if (user?.role === 'ADMIN' && !isOfficeStaff(user)) return <Navigate to="/dashboard/admin" replace />;
  return children;
}

function ActivityCalendarRoute() {
  if (getStoredRole() === 'ADMIN') {
    return <Navigate to="/dashboard/events/manage-events?view=calendar" replace />;
  }

  return <EventsPage initialTab="events" />;
}

function AnnouncementsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'DEPARTMENT_HEAD') return <Navigate to="/dashboard/department-head/announcements" replace />;

  if (role === 'ADMIN' || role === 'SBO_OFFICER') {
    return <Navigate to="manage-announcements" replace />;
  }

  return <Navigate to="view-announcements" replace />;
}

function NotFoundRedirect() {
  return <Navigate to={localStorage.getItem('auth_token') ? '/dashboard' : '/'} replace />;
}

function App() {
  return (
    <>
    <SessionExpiry />
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
      {/* Authentication */}
      <Route path="/" element={<LandingPage />} />
      {UiKitPage && <Route path="/dev/ui-kit" element={<UiKitPage />} />}
      <Route element={<LoggedInRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sign-up" element={<StudentSignUpPage />} />
        <Route path="/recover-account" element={<RecoverAccountPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      {/* Outside the signed-out group: an employee who already has an account signs in first, then opens the staff link. */}
      <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
      

      {/* Dashboard Pages */}
      <Route element={<ProtectedRoute />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          {/* Role Home Pages */}
          <Route index element={<DashboardIndexRedirect />} />
          <Route path="ask-ai" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN", "ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]}><AskAiPage /></ProtectedRoute>} />
          <Route path="super-admin" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SuperAdminHomePage /></ProtectedRoute>} />
          <Route path="super-admin/agency" element={<Navigate to="/dashboard/super-admin/colleges" replace />} />
          <Route path="super-admin/organizations" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SystemOrganizationsPage /></ProtectedRoute>} />
          <Route path="super-admin/organizations/:organizationId" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoOrganizationOverviewPage /></ProtectedRoute>} />
          <Route path="super-admin/org/:orgId" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><OrgSpacePage oversight /></ProtectedRoute>} />
          <Route path="super-admin/colleges" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SystemCollegesPage /></ProtectedRoute>} />
          <Route path="super-admin/student-records" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><StudentRecordsPage /></ProtectedRoute>} />
          <Route path="super-admin/users" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoUsersPage /></ProtectedRoute>} />
          <Route path="super-admin/documents" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoDocumentsPage /></ProtectedRoute>} />
          <Route path="department-head/documents" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD", "ADMIN"]}><OfficeReviewRoute><SaoDocumentsPage role="DEPARTMENT_HEAD" /></OfficeReviewRoute></ProtectedRoute>} />
          <Route path="department-head/compliance" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD"]}><CollegeCompliancePage /></ProtectedRoute>} />
          <Route path="super-admin/file-storage" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoStoragePage /></ProtectedRoute>} />
          <Route path="super-admin/compliance" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoCompliancePage /></ProtectedRoute>} />
          <Route path="super-admin/venues" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoVenuesPage /></ProtectedRoute>} />
          <Route path="super-admin/grievances" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoGrievancesPage /></ProtectedRoute>} />
          <Route path="super-admin/clearances" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoClearancesPage /></ProtectedRoute>} />
          <Route path="super-admin/audit-logs" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><GeneralAuditLogPage /></ProtectedRoute>} />
          <Route path="super-admin/academic-years" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><AcademicYearsPage /></ProtectedRoute>} />
          <Route path="super-admin/event-requirements" element={<Navigate to="/dashboard/super-admin/compliance?tab=events" replace />} />
          <Route path="organization-applications" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN", "DEPARTMENT_HEAD", "ADMIN"]}><OfficeReviewRoute><OrganizationApplicationsPage /></OfficeReviewRoute></ProtectedRoute>} />
          <Route path="super-admin/announcements" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><GlobalAnnouncementsPage /></ProtectedRoute>} />
          <Route path="super-admin/notifications" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><SaoNotificationsPage /></ProtectedRoute>} />
          <Route path="admin" element={<ProtectedRoute allowedRoles={["ADMIN"]}><AdminHomeRoute /></ProtectedRoute>} />
          <Route path="officer" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><DashboardPage /></ProtectedRoute>} />
          <Route path="department-head" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD"]}><DepartmentHeadHomePage /></ProtectedRoute>} />
          <Route path="department-head/approvals" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD", "ADMIN"]}><OfficeReviewRoute><DepartmentHeadApprovalsPage /></OfficeReviewRoute></ProtectedRoute>} />
          <Route path="department-head/people" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD", "ADMIN"]}><OfficeReviewRoute><CollegePeoplePage /></OfficeReviewRoute></ProtectedRoute>} />
          <Route path="department-head/organizations" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD", "ADMIN"]}><OfficeReviewRoute><CollegeOrganizationsPage /></OfficeReviewRoute></ProtectedRoute>} />
          <Route path="records" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN", "DEPARTMENT_HEAD", "ADMIN", "SBO_OFFICER"]}><RecordsRoute /></ProtectedRoute>} />
          <Route path="department-head/org/:orgId" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD"]}><OrgSpacePage /></ProtectedRoute>} />
          <Route path="submitted-files" element={<ProtectedRoute allowedRoles={["ADMIN", "DEPARTMENT_HEAD"]}><SubmittedFilesRoute /></ProtectedRoute>} />
          <Route path="approvals" element={<ProtectedRoute allowedRoles={["ADMIN", "DEPARTMENT_HEAD"]}><ApprovalsRoute /></ProtectedRoute>} />
          <Route path="super-admin/approvals" element={<Navigate to="/dashboard/super-admin/compliance?tab=financial" replace />} />
          <Route path="super-admin/organization-approvals" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]}><DepartmentHeadApprovalsPage /></ProtectedRoute>} />
          <Route path="super-admin/financial-reports" element={<Navigate to="/dashboard/super-admin/compliance?tab=financial" replace />} />
          <Route path="approval-requests/new" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><SubmitApprovalRequestPage /></ProtectedRoute>} />
          <Route path="approval-requests/new/announcement" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><CreateAnnouncementPage /></ProtectedRoute>} />
          <Route path="approval-requests/new/budget" element={<ProtectedRoute allowedRoles={["ADMIN"]}><FinancePage initialTab="budgets" startBudgetProposal /></ProtectedRoute>} />
          <Route path="approval-requests/new/event" element={<ProtectedRoute allowedRoles={["ADMIN"]}><EventsPage initialTab="events" startEventRequest /></ProtectedRoute>} />
          <Route path="approval-requests/new/election" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ElectionsHub startCreateElection /></ProtectedRoute>} />
          <Route path="student" element={<ProtectedRoute allowedRoles={["STUDENT"]}><StudentHomePage /></ProtectedRoute>} />
          <Route path="student/apply-organization" element={<ProtectedRoute allowedRoles={["STUDENT"]}><ApplyOrganizationPage /></ProtectedRoute>} />
          <Route path="student/organization-applications/:applicationId" element={<ProtectedRoute allowedRoles={["STUDENT"]}><MyOrganizationApplicationPage /></ProtectedRoute>} />
          <Route path="admin/users" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><AdminUsersPage /></ProtectedRoute>} />
          <Route path="admin/sbo-positions" element={<ProtectedRoute allowedRoles={["ADMIN"]}><Navigate to="/dashboard/admin/positions" replace /></ProtectedRoute>} />
          <Route path="admin/positions" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ManageSboPositionsPage /></ProtectedRoute>} />
          <Route path="admin/programs-sections" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ManageAcademicStructurePage /></ProtectedRoute>} />
          <Route path="audit-logs" element={<ProtectedRoute allowedRoles={["ADMIN"]}><GeneralAuditLogPage /></ProtectedRoute>} />

          {/* Shared Modules */}
          <Route path="department-head/announcements" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD"]}><DepartmentHeadAnnouncementsPage /></ProtectedRoute>} />
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
            <Route path="event-operations" element={<Navigate to="../check-in" replace />} />
            <Route path="check-in" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><EventsPage initialTab="attendance" /></ProtectedRoute>} />
            <Route path="activity-calendar" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN", "STUDENT", "DEPARTMENT_HEAD"]}><ActivityCalendarRoute /></ProtectedRoute>} />
          </Route>

          <Route path="finance" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD", "STUDENT"]} />}>
            <Route index element={<FinanceIndexRedirect />} />
            <Route path="financial-ledger" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD"]}><FinancePage initialTab="transactions" /></ProtectedRoute>} />
            <Route path="collections" element={<ProtectedRoute allowedRoles={["ADMIN"]}><FinancialCollectionsPage /></ProtectedRoute>} />
            <Route path="student-accounts" element={<ProtectedRoute allowedRoles={["ADMIN"]}><StudentFinancialAccountsPage /></ProtectedRoute>} />
            <Route path="budget-allocation" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD"]}><FinancePage initialTab="budgets" /></ProtectedRoute>} />
            <Route path="financial-insights" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD"]}><FinancePage initialTab="forecasting" /></ProtectedRoute>} />
            <Route path="transaction-history" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD"]}><FinancePage initialTab="reports" /></ProtectedRoute>} />
            <Route path="personal-receipts" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]}><FinancePage initialTab="receipts" /></ProtectedRoute>} />
            <Route path="statement-of-account" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]}><FinancePage initialTab="invoices" /></ProtectedRoute>} />
          </Route>

          <Route path="merchandise">
            <Route index element={<MerchandiseIndexRedirect />} />
            <Route path="manage-inventory" element={<ProtectedRoute allowedRoles={["ADMIN"]}><MerchandisePage initialTab="inventory" /></ProtectedRoute>} />
            <Route path="gcash-payment" element={<ProtectedRoute allowedRoles={["ADMIN"]}><Navigate to="/dashboard/merchandise/manage-orders" replace /></ProtectedRoute>} />
            <Route path="manage-orders" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><MerchandisePage initialTab="orders" /></ProtectedRoute>} />
            <Route path="claim-tokens" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]}><MerchandiseClaimTokensRoute /></ProtectedRoute>} />
            <Route path="order-merchandise" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]}><MerchandisePage initialTab="order" /></ProtectedRoute>} />
            <Route path="my-orders" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]}><MerchandisePage initialTab="my-orders" /></ProtectedRoute>} />
          </Route>

          <Route path="tasks">
            <Route index element={<TasksIndexRedirect />} />
            <Route path="task-board" element={<ProtectedRoute allowedRoles={["ADMIN"]}><TasksPage initialTab="board" /></ProtectedRoute>} />
            <Route path="create-task" element={<ProtectedRoute allowedRoles={["ADMIN"]}><Navigate to="/dashboard/tasks/task-board?new=1" replace /></ProtectedRoute>} />
            <Route path="assigned-tasks" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><TasksPage initialTab="board" /></ProtectedRoute>} />
            <Route path="task-progress" element={<ProtectedRoute allowedRoles={["ADMIN"]}><Navigate to="/dashboard/tasks/task-board?view=progress" replace /></ProtectedRoute>} />
            <Route path="ai-delegation" element={<ProtectedRoute allowedRoles={["ADMIN"]}><TasksPage initialTab="ai" /></ProtectedRoute>} />
          </Route>

          {/* Manage Profile */}
          <Route path="compliance" element={<ProtectedRoute allowedRoles={["ADMIN"]}><OrganizationCompliancePage /></ProtectedRoute>} />
          <Route path="venues" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><VenueBookingPage /></ProtectedRoute>} />
          <Route path="grievances" element={<ProtectedRoute allowedRoles={["ADMIN"]}><OrganizationGrievancesPage /></ProtectedRoute>} />
          <Route path="my-grievances" element={<ProtectedRoute allowedRoles={["STUDENT"]}><StudentGrievancesPage /></ProtectedRoute>} />
          <Route path="clearances" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "DEPARTMENT_HEAD"]}><SignatoryClearancesPage /></ProtectedRoute>} />
          <Route path="my-clearance" element={<ProtectedRoute allowedRoles={["STUDENT"]}><StudentClearancePage /></ProtectedRoute>} />
          <Route path="profile" element={<ProtectedRoute allowedRoles={["SUPER_ADMIN", "ADMIN", "SBO_OFFICER", "STUDENT", "DEPARTMENT_HEAD"]}><SettingsPage /></ProtectedRoute>} />
          <Route path="organization" element={<Navigate to="/dashboard/profile" replace />} />
          <Route path="settings" element={<Navigate to="/dashboard/profile" replace />} />

          {/* Election module - nested routes */}
          <Route path="elections" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN", "STUDENT", "DEPARTMENT_HEAD"]}><ElectionPageGate><ElectionsHub /></ElectionPageGate></ProtectedRoute>}>
            <Route index element={<ElectionsIndexRedirect />} />
            <Route path="manage-elections" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ElectionDetailPage /></ProtectedRoute>} />
            <Route path="manage-candidates" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><ManageCandidatesPage /></ProtectedRoute>} />
            <Route path="manage-partylists" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ManagePartylistsPage /></ProtectedRoute>} />
            <Route path="manage-voters" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><ManageVotersPage /></ProtectedRoute>} />
            <Route path="cast-vote" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]}><CastVoteRedirectPage /></ProtectedRoute>} />
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
      <Route element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]} />}>
        <Route path="/elections/:electionId/vote" element={<ImmersiveVotePage />} />
      </Route>
      <Route path="*" element={<NotFoundRedirect />} />
      </Routes>
    </Suspense>
    </>
  );
}

export default App;
