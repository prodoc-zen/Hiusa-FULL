import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const pageTitles = {
  '/dashboard': 'Officer Dashboard',
  '/dashboard/finance': 'Financial Management',
  '/dashboard/events': 'Event & Activity Management',
  '/dashboard/tasks': 'Task Management',
  '/dashboard/elections': 'Digital Voting',
  '/dashboard/merchandise': 'Merchandise',
  '/dashboard/announcements': 'Announcements',
  '/dashboard/settings': 'Settings',
};

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const title = pageTitles[location.pathname] || 'Dashboard';

  return (
    <main className="min-h-screen bg-[#EEF6FB] font-sans text-[#0F172A]">
      <div className="flex min-h-screen">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="min-w-0 flex-1 flex flex-col">
          <TopBar
            title={title}
            onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          />
          <div className="flex-1 p-4 sm:p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </main>
  );
}
