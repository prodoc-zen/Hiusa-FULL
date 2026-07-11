import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/auth/LoginPage';
import OrganizationSelectPage from './pages/auth/OrganizationSelectPage';
import DashboardLayout from './components/layout/DashboardLayout';
import DashboardPage from './pages/roles/officer/DashboardPage';
import AdminHomePage from './pages/roles/admin/AdminHomePage';
import DepartmentHeadHomePage from './pages/roles/department-head/DepartmentHeadHomePage';
import StudentHomePage from './pages/roles/student/StudentHomePage';
import AdminUsersPage from './pages/roles/admin/AdminUsersPage';
import FinancePage from './pages/modules/finance/FinancePage';
import EventsPage from './pages/modules/events/EventsPage';
import TasksPage from './pages/modules/tasks/TasksPage';
import MerchandisePage from './pages/modules/merchandise/MerchandisePage';
import ManageAnnouncementsPage from './pages/modules/announcements/ManageAnnouncementsPage';
import CreateAnnouncementPage from './pages/modules/announcements/CreateAnnouncementPage';
import AnnouncementsFeedPage from './pages/modules/announcements/AnnouncementsFeedPage';
import SettingsPage from './pages/modules/settings/SettingsPage';
import ProtectedRoute from './ProtectedRoute';
import LoggedInRoute from './LoggedInRoute';

import ElectionsHub from './pages/elections/ElectionsHub';
import ElectionDetailPage from './pages/elections/ElectionDetailPage';
import ManageCandidatesPage from './pages/elections/ManageCandidatesPage';
import ManagePartylistsPage from './pages/elections/ManagePartylistsPage';
import ManageVotersPage from './pages/elections/ManageVotersPage';
import ElectionResultsPage from './pages/elections/ElectionResultsPage';
import CastVotePage from './pages/elections/CastVotePage';

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
    return <Navigate to="election-results" replace />;
  }

  if (role === 'STUDENT') {
    return <Navigate to="cast-vote" replace />;
  }

  return <Navigate to="manage-elections" replace />;
}

function EventsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'STUDENT') {
    return <Navigate to="activity-calendar" replace />;
  }

  if (role === 'ADMIN') {
    return <Navigate to="event-operations" replace />;
  }

  return <Navigate to="manage-events" replace />;
}

function FinanceIndexRedirect() {
  const role = getStoredRole();

  if (role === 'ADMIN') {
    return <Navigate to="financial-insights" replace />;
  }

  return <Navigate to="financial-ledger" replace />;
}

function TasksIndexRedirect() {
  const role = getStoredRole();

  if (role === 'ADMIN') {
    return <Navigate to="task-progress" replace />;
  }

  return <Navigate to="task-board" replace />;
}

function MerchandiseIndexRedirect() {
  const role = getStoredRole();

  if (role === 'STUDENT') {
    return <Navigate to="order-merchandise" replace />;
  }

  return <Navigate to="manage-inventory" replace />;
}

function AnnouncementsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'STUDENT' || role === 'ADMIN') {
    return <Navigate to="view-announcements" replace />;
  }

  return <Navigate to="manage-announcements" replace />;
}

function App() {
  return (
    <Routes>
      {/* Authentication */}
      <Route path="/" element={<Navigate to="/select-organization" replace />} />
      <Route element={<LoggedInRoute />}>
        <Route path="/select-organization" element={<OrganizationSelectPage />} />
        <Route path="/login" element={<LoginPage />} />
      </Route>
      

      {/* Dashboard Pages */}
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          {/* Role Home Pages */}
          <Route index element={<DashboardIndexRedirect />} />
          <Route path="admin" element={<ProtectedRoute allowedRoles={["ADMIN"]}><AdminHomePage /></ProtectedRoute>} />
          <Route path="officer" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><DashboardPage /></ProtectedRoute>} />
          <Route path="department-head" element={<ProtectedRoute allowedRoles={["DEPARTMENT_HEAD"]}><DepartmentHeadHomePage /></ProtectedRoute>} />
          <Route path="student" element={<ProtectedRoute allowedRoles={["STUDENT"]}><StudentHomePage /></ProtectedRoute>} />
          <Route path="admin/users" element={<ProtectedRoute allowedRoles={["ADMIN"]}><AdminUsersPage /></ProtectedRoute>} />

          {/* Shared Modules */}
          <Route path="announcements">
            <Route index element={<AnnouncementsIndexRedirect />} />
            <Route path="manage-announcements" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><ManageAnnouncementsPage /></ProtectedRoute>} />
            <Route path="create-announcement" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER"]}><CreateAnnouncementPage /></ProtectedRoute>} />
            <Route path="view-announcements" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]}><AnnouncementsFeedPage /></ProtectedRoute>} />
          </Route>

          <Route path="events">
            <Route index element={<EventsIndexRedirect />} />
            <Route path="manage-events" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><EventsPage initialTab="events" /></ProtectedRoute>} />
            <Route path="event-planner" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><EventsPage initialTab="tasks" /></ProtectedRoute>} />
            <Route path="event-operations" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><EventsPage initialTab="attendance" /></ProtectedRoute>} />
            <Route path="activity-calendar" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN", "STUDENT"]}><EventsPage initialTab="events" /></ProtectedRoute>} />
          </Route>

          <Route path="finance">
            <Route index element={<FinanceIndexRedirect />} />
            <Route path="financial-ledger" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><FinancePage initialTab="transactions" /></ProtectedRoute>} />
            <Route path="budget-allocation" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><FinancePage initialTab="forecasting" /></ProtectedRoute>} />
            <Route path="financial-insights" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><FinancePage initialTab="forecasting" /></ProtectedRoute>} />
            <Route path="transaction-history" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><FinancePage initialTab="reports" /></ProtectedRoute>} />
          </Route>

          <Route path="merchandise">
            <Route index element={<MerchandiseIndexRedirect />} />
            <Route path="manage-inventory" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><MerchandisePage initialTab="inventory" /></ProtectedRoute>} />
            <Route path="manage-orders" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><MerchandisePage initialTab="orders" /></ProtectedRoute>} />
            <Route path="claim-tokens" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "STUDENT"]}><MerchandisePage initialTab="tokens" /></ProtectedRoute>} />
            <Route path="order-merchandise" element={<ProtectedRoute allowedRoles={["STUDENT"]}><MerchandisePage initialTab="order" /></ProtectedRoute>} />
            <Route path="my-orders" element={<ProtectedRoute allowedRoles={["STUDENT"]}><MerchandisePage initialTab="my-orders" /></ProtectedRoute>} />
          </Route>

          <Route path="tasks">
            <Route index element={<TasksIndexRedirect />} />
            <Route path="task-board" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><TasksPage initialTab="board" /></ProtectedRoute>} />
            <Route path="create-task" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><TasksPage initialTab="board" /></ProtectedRoute>} />
            <Route path="task-progress" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><TasksPage initialTab="progress" /></ProtectedRoute>} />
          </Route>

          {/* Account and Organization */}
          <Route path="organization" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><SettingsPage initialSection="organization" /></ProtectedRoute>} />
          <Route path="profile" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT", "DEPARTMENT_HEAD"]}><SettingsPage initialSection="profile" /></ProtectedRoute>} />
          <Route path="settings" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT", "DEPARTMENT_HEAD"]}><SettingsPage /></ProtectedRoute>} />

          {/* Election module — nested routes */}
          <Route path="elections" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN", "STUDENT"]}><ElectionsHub /></ProtectedRoute>}>
            <Route index element={<ElectionsIndexRedirect />} />
            <Route path="manage-elections" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><ElectionDetailPage /></ProtectedRoute>} />
            <Route path="manage-candidates" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><ManageCandidatesPage /></ProtectedRoute>} />
            <Route path="manage-partylists" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><ManagePartylistsPage /></ProtectedRoute>} />
            <Route path="manage-voters" element={<ProtectedRoute allowedRoles={["SBO_OFFICER"]}><ManageVotersPage /></ProtectedRoute>} />
            <Route path="cast-vote" element={<ProtectedRoute allowedRoles={["STUDENT"]}><CastVotePage /></ProtectedRoute>} />
            <Route path="election-results" element={<ProtectedRoute allowedRoles={["SBO_OFFICER", "ADMIN"]}><ElectionResultsPage /></ProtectedRoute>} />

            {/* Legacy election links redirected to REFERENCE view IDs */}
            <Route path="manage" element={<Navigate to="../manage-elections" replace />} />
            <Route path="candidates" element={<Navigate to="../manage-candidates" replace />} />
            <Route path="partylists" element={<Navigate to="../manage-partylists" replace />} />
            <Route path="voters" element={<Navigate to="../manage-voters" replace />} />
            <Route path="results" element={<Navigate to="../election-results" replace />} />
          </Route>

        </Route>
      </Route>
    </Routes>
  );
}

export default App;
