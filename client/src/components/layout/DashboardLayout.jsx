import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const pageTitles = {
  '/dashboard': 'Officer Dashboard',
  '/dashboard/admin': 'Admin Dashboard',
  '/dashboard/super-admin': 'Super Admin Dashboard',
  '/dashboard/super-admin/approvals': 'Received Reports',
  '/dashboard/super-admin/financial-reports': 'Received Financial Reports',
  '/dashboard/super-admin/organizations': 'Organizations',
  '/dashboard/super-admin/colleges': 'Colleges',
  '/dashboard/super-admin/compliance': 'Compliance and Accreditation',
  '/dashboard/super-admin/venues': 'Venues and Bookings',
  '/dashboard/super-admin/grievances': 'Grievances',
  '/dashboard/super-admin/clearances': 'Digital Clearances',
  '/dashboard/super-admin/evaluation': 'System Evaluation',
  '/dashboard/compliance': 'Compliance',
  '/dashboard/venues': 'Venue Booking',
  '/dashboard/grievances': 'Grievances',
  '/dashboard/my-grievances': 'My Grievances',
  '/dashboard/clearances': 'Clearance Signing',
  '/dashboard/my-clearance': 'My Clearance',
  '/dashboard/evaluation': 'System Evaluation',
  '/dashboard/objectives': 'Study Objectives in Action',
  '/dashboard/super-admin/event-requirements': 'Event Requirements',
  '/dashboard/super-admin/admins': 'Administrators',
  '/dashboard/super-admin/announcements': 'Official SAO Announcements',
  '/dashboard/super-admin/notifications': 'SAO Notifications',
  '/dashboard/admin/users': 'User Management',
  '/dashboard/admin/sbo-positions': 'Manage Positions',
  '/dashboard/admin/positions': 'Manage Positions',
  '/dashboard/admin/programs-sections': 'Programs & Sections',
  '/dashboard/approvals': 'Approvals',
  '/dashboard/approval-requests/new': 'Submit Request',
  '/dashboard/approval-requests/new/announcement': 'Announcement Request',
  '/dashboard/approval-requests/new/budget': 'Budget Request',
  '/dashboard/approval-requests/new/event': 'Event Request',
  '/dashboard/approval-requests/new/election': 'Election Request',
  '/dashboard/officer': 'Officer Dashboard',
  '/dashboard/department-head': 'Department Head Dashboard',
  '/dashboard/department-head/approvals': 'Approvals',
  '/dashboard/adviser': 'Adviser Dashboard',
  '/dashboard/student': 'Student Dashboard',
  '/dashboard/finance': 'Financial Management',
  '/dashboard/finance/financial-ledger': 'Digital Ledger',
  '/dashboard/finance/collections': 'Collections & Remittances',
  '/dashboard/finance/student-accounts': 'Student Financial Accounts',
  '/dashboard/finance/budget-allocation': 'Budget Allocation',
  '/dashboard/finance/financial-insights': 'Financial Insights',
  '/dashboard/finance/transaction-history': 'Transaction History',
  '/dashboard/finance/personal-receipts': 'My Receipts',
  '/dashboard/finance/statement-of-account': 'Statement of Account',
  '/dashboard/audit-logs': 'General Audit Log',
  '/dashboard/events': 'Events',
  '/dashboard/events/manage-events': 'Manage Events',
  '/dashboard/events/event-planner': 'Event Planner',
  '/dashboard/events/activity-calendar': 'Activity Calendar',
  '/dashboard/events/check-in': 'Event Check-In',
  '/dashboard/tasks': 'Task Management',
  '/dashboard/tasks/task-board': 'Task Board',
  '/dashboard/tasks/create-task': 'Create Task',
  '/dashboard/tasks/task-progress': 'Monitor Task Progress',
  '/dashboard/tasks/assigned-tasks': 'Assigned Tasks',
  '/dashboard/tasks/ai-delegation': 'AI Delegation',
  '/dashboard/elections': 'Elections',
  '/dashboard/elections/manage-elections': 'Manage Elections',
  '/dashboard/elections/manage-candidates': 'Manage Candidates',
  '/dashboard/elections/manage-voters': 'Manage Voters',
  '/dashboard/elections/manage-partylists': 'Manage Party Lists',
  '/dashboard/elections/cast-vote': 'Cast Vote',
  '/dashboard/elections/election-results': 'Election Results',
  '/dashboard/merchandise': 'Merchandise',
  '/dashboard/merchandise/manage-inventory': 'Inventory',
  '/dashboard/merchandise/gcash-payment': 'Manage Orders',
  '/dashboard/merchandise/manage-orders': 'Manage Orders',
  '/dashboard/merchandise/claim-tokens': 'Claim Tokens',
  '/dashboard/merchandise/order-merchandise': 'Order Merchandise',
  '/dashboard/merchandise/my-orders': 'My Orders',
  '/dashboard/announcements': 'Announcements',
  '/dashboard/announcements/manage-announcements': 'Manage Announcements',
  '/dashboard/announcements/create-announcement': 'Create Announcement',
  '/dashboard/announcements/view-announcements': 'Announcements Feed',
  '/dashboard/profile': 'Manage Profile',
  '/dashboard/organization': 'Manage Profile',
  '/dashboard/settings': 'Manage Profile',
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
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    try {
      return localStorage.getItem('hiusa_desktop_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const location = useLocation();
  const title = getTitle(location.pathname);

  function toggleDesktopSidebar() {
    setDesktopCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem('hiusa_desktop_sidebar_collapsed', String(next));
      } catch {
        // The rail still works when browser storage is unavailable.
      }
      return next;
    });
  }

  return (
    <div className="flex h-[100dvh] min-h-screen max-w-full overflow-hidden bg-[#EEF6FB] font-sans text-[#0F172A]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} desktopCollapsed={desktopCollapsed} onToggleDesktop={toggleDesktopSidebar} />
      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden transition-[padding] duration-300 motion-reduce:transition-none ${desktopCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[260px]'}`}>
        <TopBar
          title={title}
          pathname={location.pathname}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-6">
          <div key={location.pathname} className="route-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
