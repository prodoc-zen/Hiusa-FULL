import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardLayout from './components/layout/DashboardLayout';
import DashboardPage from './pages/DashboardPage';
import FinancePage from './pages/FinancePage';
import EventsPage from './pages/EventsPage';
import TasksPage from './pages/TasksPage';
import ElectionsPage from './pages/ElectionsPage';
import MerchandisePage from './pages/MerchandisePage';
import AnnouncementsPage from './pages/AnnouncementsPage';
import SettingsPage from './pages/SettingsPage';
import ProtectedRoute from './ProtectedRoute';
import LoggedInRoute from './LoggedInRoute';


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
          <Route index element={<DashboardPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="elections" element={<ElectionsPage />} />
          <Route path="merchandise" element={<MerchandisePage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
