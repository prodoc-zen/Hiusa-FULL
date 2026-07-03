import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const pageTitles = {
  '/dashboard': 'Officer Dashboard',
  '/dashboard/admin': 'Admin Dashboard',
  '/dashboard/admin/users': 'User Management',
  '/dashboard/officer': 'Officer Dashboard',
  '/dashboard/adviser': 'Adviser Dashboard',
  '/dashboard/student': 'Student Dashboard',
  '/dashboard/finance': 'Financial Management',
  '/dashboard/finance/financial-ledger': 'Digital Ledger',
  '/dashboard/finance/budget-allocation': 'Budget Allocation',
  '/dashboard/finance/financial-insights': 'Financial Insights',
  '/dashboard/finance/transaction-history': 'Transaction History',
  '/dashboard/events': 'Events',
  '/dashboard/events/manage-events': 'Manage Events',
  '/dashboard/events/event-planner': 'Event Planner',
  '/dashboard/events/event-operations': 'Event Operations',
  '/dashboard/events/activity-calendar': 'Activity Calendar',
  '/dashboard/tasks': 'Task Management',
  '/dashboard/tasks/task-board': 'Task Board',
  '/dashboard/tasks/create-task': 'Create Task',
  '/dashboard/tasks/task-progress': 'Monitor Task Progress',
  '/dashboard/elections': 'Elections',
  '/dashboard/elections/manage-elections': 'Manage Elections',
  '/dashboard/elections/manage-candidates': 'Manage Candidates',
  '/dashboard/elections/manage-voters': 'Manage Voters',
  '/dashboard/elections/manage-partylists': 'Manage Party Lists',
  '/dashboard/elections/cast-vote': 'Cast Vote',
  '/dashboard/elections/election-results': 'Election Results',
  '/dashboard/merchandise': 'Merchandise',
  '/dashboard/merchandise/manage-inventory': 'Inventory',
  '/dashboard/merchandise/manage-orders': 'Manage Orders',
  '/dashboard/merchandise/claim-tokens': 'Claim Tokens',
  '/dashboard/merchandise/order-merchandise': 'Order Merchandise',
  '/dashboard/merchandise/my-orders': 'My Orders',
  '/dashboard/announcements': 'Announcements',
  '/dashboard/announcements/manage-announcements': 'Manage Announcements',
  '/dashboard/announcements/create-announcement': 'Create Announcement',
  '/dashboard/announcements/view-announcements': 'Announcements Feed',
  '/dashboard/organization': 'Organization',
  '/dashboard/profile': 'Profile',
  '/dashboard/settings': 'Settings',
};

function getTitle(pathname) {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith('/dashboard/announcements/')) return 'Announcements';
  if (pathname.startsWith('/dashboard/elections/')) return 'Elections';
  if (pathname.startsWith('/dashboard/events/')) return 'Events';
  if (pathname.startsWith('/dashboard/finance/')) return 'Financial';
  if (pathname.startsWith('/dashboard/tasks/')) return 'Tasks';
  if (pathname.startsWith('/dashboard/merchandise/')) return 'Merchandise';
  return 'Dashboard';
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const title = getTitle(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-[#EEF6FB] font-sans text-[#0F172A]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          title={title}
          pathname={location.pathname}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
        />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
