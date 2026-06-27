import { NavLink } from 'react-router-dom';
import { CalendarDays, ChevronRight, ClipboardList, Coins, Megaphone, Package, Shield, TrendingUp, Users, Vote } from 'lucide-react';

const configs = {
  admin: {
    title: 'Admin Dashboard',
    subtitle: 'System control overview',
    stats: [
      { label: 'Users', value: '1,248', helper: 'Active accounts', icon: Users, trend: '+2.4%' },
      { label: 'Elections', value: '2', helper: 'Running / scheduled', icon: Vote, trend: 'Live' },
      { label: 'Announcements', value: '36', helper: 'Published updates', icon: Megaphone, trend: '4 drafts' },
      { label: 'Security Alerts', value: '1', helper: 'Needs review', icon: Shield, trend: 'Attention' },
    ],
    modules: [
      { label: 'Elections', desc: 'Ballots, candidates, results', path: '/dashboard/elections', icon: Vote },
      { label: 'Reports', desc: 'Audit trail and exports', path: '/dashboard/finance', icon: Coins },
      { label: 'Announcements', desc: 'Content and visibility', path: '/dashboard/announcements', icon: Megaphone },
    ],
    activity: [
      { action: 'Admin verified election settings', detail: 'SSC General Elections 2026', time: '2 hours ago' },
      { action: 'New officer account approved', detail: 'Carlo Mendoza', time: '4 hours ago' },
      { action: 'System announcement published', detail: 'Voting starts tomorrow', time: '1 day ago' },
    ],
  },
  officer: {
    title: 'Officer Dashboard',
    subtitle: 'Operations hub',
    stats: [
      { label: 'Active Members', value: '1,248', helper: '+12 this month', icon: Users, trend: '+2.4%' },
      { label: 'Active Elections', value: '2', helper: 'Currently accepting votes', icon: Vote, trend: 'Live' },
      { label: 'Upcoming Events', value: '5', helper: 'Next 30 days', icon: CalendarDays, trend: 'Scheduled' },
      { label: 'Pending Tasks', value: '14', helper: 'Across all officers', icon: ClipboardList, trend: '3 overdue' },
    ],
    modules: [
      { label: 'Finance', desc: 'Transactions, forecasting, reports', path: '/dashboard/finance', icon: Coins },
      { label: 'Events', desc: 'Create events and track attendance', path: '/dashboard/events', icon: CalendarDays },
      { label: 'Tasks', desc: 'Create tasks and monitor progress', path: '/dashboard/tasks', icon: ClipboardList },
      { label: 'Elections', desc: 'Manage ballots and results', path: '/dashboard/elections', icon: Vote },
      { label: 'Merchandise', desc: 'Inventory and orders', path: '/dashboard/merchandise', icon: Package },
      { label: 'Announcements', desc: 'Post updates and notices', path: '/dashboard/announcements', icon: Megaphone },
    ],
    activity: [
      { action: 'New election created', detail: 'SSC General Elections 2026', time: '2 hours ago' },
      { action: 'Transaction recorded', detail: '₱12,500 — Event supplies', time: '4 hours ago' },
      { action: 'Task completed', detail: 'Prepare election ballots', time: '1 day ago' },
    ],
  },
  adviser: {
    title: 'Adviser Dashboard',
    subtitle: 'Oversight and review',
    stats: [
      { label: 'Reviews Pending', value: '7', helper: 'Awaiting approval', icon: Shield, trend: 'Action' },
      { label: 'Open Events', value: '5', helper: 'Under supervision', icon: CalendarDays, trend: 'Live' },
      { label: 'Elections', value: '2', helper: 'Observe and audit', icon: Vote, trend: 'Watch' },
      { label: 'Tasks', value: '14', helper: 'Officer workload', icon: ClipboardList, trend: 'Track' },
    ],
    modules: [
      { label: 'Elections', desc: 'Oversight and results', path: '/dashboard/elections', icon: Vote },
      { label: 'Events', desc: 'Monitor planning and attendance', path: '/dashboard/events', icon: CalendarDays },
      { label: 'Finance', desc: 'Review budgets and reports', path: '/dashboard/finance', icon: Coins },
    ],
    activity: [
      { action: 'Candidate slate reviewed', detail: 'Officer election workflow', time: '2 hours ago' },
      { action: 'Budget request approved', detail: 'Annual General Assembly', time: '1 day ago' },
      { action: 'Announcement flagged', detail: 'Requires wording revision', time: '1 day ago' },
    ],
  },
  student: {
    title: 'Student Dashboard',
    subtitle: 'Member access',
    stats: [
      { label: 'Active Elections', value: '1', helper: 'Ready to vote', icon: Vote, trend: 'Live' },
      { label: 'Events', value: '5', helper: 'Upcoming activities', icon: CalendarDays, trend: 'Soon' },
      { label: 'Merch Orders', value: '3', helper: 'Pending fulfillment', icon: Package, trend: 'Pending' },
      { label: 'Announcements', value: '12', helper: 'Recent updates', icon: Megaphone, trend: 'New' },
    ],
    modules: [
      { label: 'Elections', desc: 'Cast votes and view results', path: '/dashboard/elections', icon: Vote },
      { label: 'Events', desc: 'Browse organization events', path: '/dashboard/events', icon: CalendarDays },
      { label: 'Merchandise', desc: 'Order official merch', path: '/dashboard/merchandise', icon: Package },
      { label: 'Announcements', desc: 'Read news and reminders', path: '/dashboard/announcements', icon: Megaphone },
    ],
    activity: [
      { action: 'Voting opened', detail: 'SSC General Elections 2026', time: 'Just now' },
      { action: 'Event reminder sent', detail: 'Annual General Assembly', time: '3 hours ago' },
      { action: 'Merchandise order ready', detail: 'HIUSA T-Shirt', time: '1 day ago' },
    ],
  },
};

function getRole() {
  const stored = localStorage.getItem('user');
  const user = stored ? JSON.parse(stored) : null;
  return user?.role || 'officer';
}

export default function DashboardPage() {
  const role = getRole();
  const config = configs[role] || configs.officer;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">{config.subtitle}</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">{config.title}</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Live overview tailored to the current account role.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {config.stats.map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-4 flex items-center justify-between">
              <div className="grid h-11 w-11 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0] transition-colors group-hover:bg-[#0B8ED0] group-hover:text-white">
                <stat.icon size={20} />
              </div>
              <span className="flex items-center gap-1 rounded-full bg-[#F8FBFD] px-2.5 py-1 text-[11px] font-bold text-[#0B8ED0]">
                <TrendingUp size={12} />
                {stat.trend}
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#0F172A]">Quick Access</h2>
            <p className="text-sm font-medium text-slate-500">Frequently used modules for this role</p>
          </div>
          <span className="rounded-full bg-[#E6F6FD] px-3 py-1 text-xs font-bold text-[#0878B7]">{config.modules.length} Modules</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {config.modules.map((mod) => (
            <NavLink key={mod.path} to={mod.path} className="group flex items-start gap-4 rounded-xl border border-[#DDE7EF] bg-[#F8FBFD] p-4 transition-all duration-200 hover:border-[#0B8ED0]/30 hover:bg-white hover:shadow-md">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0] transition-all group-hover:bg-[#0B8ED0] group-hover:text-white">
                <mod.icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-[#0F172A]">{mod.label}</p>
                  <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#0B8ED0]" />
                </div>
                <p className="mt-1 text-xs font-medium text-slate-500">{mod.desc}</p>
              </div>
            </NavLink>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-[#0F172A]">Recent Activity</h2>
        <div className="space-y-3">
          {config.activity.map((item, index) => (
            <div key={index} className="flex items-center gap-4 rounded-lg bg-[#F8FBFD] p-3.5 transition hover:bg-[#EEF6FB]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0B8ED0]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0F172A]">{item.action}</p>
                <p className="text-xs font-medium text-slate-500">{item.detail}</p>
              </div>
              <span className="shrink-0 text-xs font-medium text-slate-400">{item.time}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
