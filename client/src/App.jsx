import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/auth/LoginPage';
import DashboardLayout from './components/layout/DashboardLayout';
import DashboardPage from './pages/roles/officer/DashboardPage';
import AdminHomePage from './pages/roles/admin/AdminHomePage';
import AdviserHomePage from './pages/roles/adviser/AdviserHomePage';
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
  const allowedRoles = ['admin', 'officer', 'adviser', 'student'];

  if (role && allowedRoles.includes(role)) {
    return <Navigate to={`/dashboard/${role}`} replace />;
  }

  return <Navigate to="/dashboard/officer" replace />;
}

function ElectionsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'adviser') {
    return <Navigate to="election-results" replace />;
  }

  if (role === 'student') {
    return <Navigate to="cast-vote" replace />;
  }

  return <Navigate to="manage-elections" replace />;
}

function EventsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'student') {
    return <Navigate to="activity-calendar" replace />;
  }

  if (role === 'adviser') {
    return <Navigate to="event-operations" replace />;
  }

  return <Navigate to="manage-events" replace />;
}

function FinanceIndexRedirect() {
  const role = getStoredRole();

  if (role === 'adviser') {
    return <Navigate to="financial-insights" replace />;
  }

  return <Navigate to="financial-ledger" replace />;
}

function TasksIndexRedirect() {
  const role = getStoredRole();

  if (role === 'adviser') {
    return <Navigate to="task-progress" replace />;
  }

  return <Navigate to="task-board" replace />;
}

function MerchandiseIndexRedirect() {
  const role = getStoredRole();

  if (role === 'student') {
    return <Navigate to="order-merchandise" replace />;
  }

  return <Navigate to="manage-inventory" replace />;
}

function AnnouncementsIndexRedirect() {
  const role = getStoredRole();

  if (role === 'student') {
    return <Navigate to="view-announcements" replace />;
  }

  return <Navigate to="manage-announcements" replace />;
}

function App() {
  return (
    <Routes>
      {/* Authentication */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route element={<LoggedInRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      

      {/* Dashboard Pages */}
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          {/* Role Home Pages */}
          <Route index element={<DashboardIndexRedirect />} />
          <Route path="admin" element={<ProtectedRoute allowedRoles={["admin"]}><AdminHomePage /></ProtectedRoute>} />
          <Route path="officer" element={<ProtectedRoute allowedRoles={["officer"]}><DashboardPage /></ProtectedRoute>} />
          <Route path="adviser" element={<ProtectedRoute allowedRoles={["adviser"]}><AdviserHomePage /></ProtectedRoute>} />
          <Route path="student" element={<ProtectedRoute allowedRoles={["student"]}><StudentHomePage /></ProtectedRoute>} />
          <Route path="admin/users" element={<ProtectedRoute allowedRoles={["admin"]}><AdminUsersPage /></ProtectedRoute>} />

          {/* Shared Modules */}
          <Route path="announcements">
            <Route index element={<AnnouncementsIndexRedirect />} />
            <Route path="manage-announcements" element={<ProtectedRoute allowedRoles={["admin", "officer", "adviser"]}><ManageAnnouncementsPage /></ProtectedRoute>} />
            <Route path="create-announcement" element={<ProtectedRoute allowedRoles={["admin", "officer", "adviser"]}><CreateAnnouncementPage /></ProtectedRoute>} />
            <Route path="view-announcements" element={<ProtectedRoute allowedRoles={["admin", "officer", "adviser", "student"]}><AnnouncementsFeedPage /></ProtectedRoute>} />
          </Route>

          <Route path="events">
            <Route index element={<EventsIndexRedirect />} />
            <Route path="manage-events" element={<ProtectedRoute allowedRoles={["officer"]}><EventsPage initialTab="events" /></ProtectedRoute>} />
            <Route path="event-planner" element={<ProtectedRoute allowedRoles={["officer"]}><EventsPage initialTab="tasks" /></ProtectedRoute>} />
            <Route path="event-operations" element={<ProtectedRoute allowedRoles={["officer", "adviser"]}><EventsPage initialTab="attendance" /></ProtectedRoute>} />
            <Route path="activity-calendar" element={<ProtectedRoute allowedRoles={["officer", "adviser", "student"]}><EventsPage initialTab="events" /></ProtectedRoute>} />
          </Route>

          <Route path="finance">
            <Route index element={<FinanceIndexRedirect />} />
            <Route path="financial-ledger" element={<ProtectedRoute allowedRoles={["officer"]}><FinancePage initialTab="transactions" /></ProtectedRoute>} />
            <Route path="budget-allocation" element={<ProtectedRoute allowedRoles={["officer"]}><FinancePage initialTab="forecasting" /></ProtectedRoute>} />
            <Route path="financial-insights" element={<ProtectedRoute allowedRoles={["officer", "adviser"]}><FinancePage initialTab="forecasting" /></ProtectedRoute>} />
            <Route path="transaction-history" element={<ProtectedRoute allowedRoles={["officer", "adviser"]}><FinancePage initialTab="reports" /></ProtectedRoute>} />
          </Route>

          <Route path="merchandise">
            <Route index element={<MerchandiseIndexRedirect />} />
            <Route path="manage-inventory" element={<ProtectedRoute allowedRoles={["officer"]}><MerchandisePage initialTab="inventory" /></ProtectedRoute>} />
            <Route path="manage-orders" element={<ProtectedRoute allowedRoles={["officer"]}><MerchandisePage initialTab="orders" /></ProtectedRoute>} />
            <Route path="claim-tokens" element={<ProtectedRoute allowedRoles={["officer", "student"]}><MerchandisePage initialTab="tokens" /></ProtectedRoute>} />
            <Route path="order-merchandise" element={<ProtectedRoute allowedRoles={["student"]}><MerchandisePage initialTab="order" /></ProtectedRoute>} />
            <Route path="my-orders" element={<ProtectedRoute allowedRoles={["student"]}><MerchandisePage initialTab="my-orders" /></ProtectedRoute>} />
          </Route>

          <Route path="tasks">
            <Route index element={<TasksIndexRedirect />} />
            <Route path="task-board" element={<ProtectedRoute allowedRoles={["officer"]}><TasksPage initialTab="board" /></ProtectedRoute>} />
            <Route path="create-task" element={<ProtectedRoute allowedRoles={["officer"]}><TasksPage initialTab="board" /></ProtectedRoute>} />
            <Route path="task-progress" element={<ProtectedRoute allowedRoles={["officer", "adviser"]}><TasksPage initialTab="progress" /></ProtectedRoute>} />
          </Route>

          {/* Account and Organization */}
          <Route path="organization" element={<ProtectedRoute allowedRoles={["officer"]}><SettingsPage initialSection="organization" /></ProtectedRoute>} />
          <Route path="profile" element={<ProtectedRoute allowedRoles={["admin", "officer", "adviser", "student"]}><SettingsPage initialSection="profile" /></ProtectedRoute>} />
          <Route path="settings" element={<ProtectedRoute allowedRoles={["admin", "officer", "adviser", "student"]}><SettingsPage /></ProtectedRoute>} />

          {/* Election module — nested routes */}
          <Route path="elections" element={<ProtectedRoute allowedRoles={["officer", "adviser", "student"]}><ElectionsHub /></ProtectedRoute>}>
            <Route index element={<ElectionsIndexRedirect />} />
            <Route path="manage-elections" element={<ProtectedRoute allowedRoles={["officer"]}><ElectionDetailPage /></ProtectedRoute>} />
            <Route path="manage-candidates" element={<ProtectedRoute allowedRoles={["officer"]}><ManageCandidatesPage /></ProtectedRoute>} />
            <Route path="manage-partylists" element={<ProtectedRoute allowedRoles={["officer"]}><ManagePartylistsPage /></ProtectedRoute>} />
            <Route path="manage-voters" element={<ProtectedRoute allowedRoles={["officer"]}><ManageVotersPage /></ProtectedRoute>} />
            <Route path="cast-vote" element={<ProtectedRoute allowedRoles={["student"]}><CastVotePage /></ProtectedRoute>} />
            <Route path="election-results" element={<ProtectedRoute allowedRoles={["officer", "adviser"]}><ElectionResultsPage /></ProtectedRoute>} />

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
