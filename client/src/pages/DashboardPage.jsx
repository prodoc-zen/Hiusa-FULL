import { NavLink } from 'react-router-dom';
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Coins,
  Megaphone,
  Package,
  TrendingUp,
  Users,
  Vote,
} from 'lucide-react';

import { getCurrentUser } from '../services/authService';

const user = getCurrentUser();


const stats = [
  { label: 'Active Members', value: '1,248', helper: '+12 this month', icon: Users, trend: '+2.4%' },
  { label: 'Active Elections', value: '2', helper: 'Currently accepting votes', icon: Vote, trend: 'Live' },
  { label: 'Upcoming Events', value: '5', helper: 'Next 30 days', icon: CalendarDays, trend: 'Scheduled' },
  { label: 'Pending Tasks', value: '14', helper: 'Across all officers', icon: ClipboardList, trend: '3 overdue' },
];

const modules = [
  {
    label: 'Finance',
    desc: 'Record Transactions, AI Forecasting, Reports',
    path: '/dashboard/finance',
    icon: Coins,
    color: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
  },
  {
    label: 'Events',
    desc: 'Create Events, Assign Tasks, Track Attendance',
    path: '/dashboard/events',
    icon: CalendarDays,
    color: 'from-violet-500 to-violet-600',
    bg: 'bg-violet-50',
    text: 'text-violet-600',
  },
  {
    label: 'Tasks',
    desc: 'Create Tasks, AI Delegation, Track Progress',
    path: '/dashboard/tasks',
    icon: ClipboardList,
    color: 'from-amber-500 to-amber-600',
    bg: 'bg-amber-50',
    text: 'text-amber-600',
  },
  {
    label: 'Elections',
    desc: 'Set Up Elections, Manage Candidates, View Results',
    path: '/dashboard/elections',
    icon: Vote,
    color: 'from-[#0B8ED0] to-[#0878B7]',
    bg: 'bg-[#E6F6FD]',
    text: 'text-[#0B8ED0]',
  },
  {
    label: 'Merchandise',
    desc: 'Manage Inventory, Process Orders, Issue Tokens',
    path: '/dashboard/merchandise',
    icon: Package,
    color: 'from-rose-500 to-rose-600',
    bg: 'bg-rose-50',
    text: 'text-rose-600',
  },
  {
    label: 'Announcements',
    desc: 'Post Updates, Target Audience, Manage Feed',
    path: '/dashboard/announcements',
    icon: Megaphone,
    color: 'from-sky-500 to-sky-600',
    bg: 'bg-sky-50',
    text: 'text-sky-600',
  },
];

const recentActivity = [
  { action: 'New election created', detail: 'SSC General Elections 2026', time: '2 hours ago', type: 'election' },
  { action: 'Transaction recorded', detail: '₱12,500 — Event supplies', time: '4 hours ago', type: 'finance' },
  { action: 'Event published', detail: 'Annual General Assembly', time: '6 hours ago', type: 'event' },
  { action: 'Task completed', detail: 'Prepare election ballots', time: '1 day ago', type: 'task' },
  { action: 'Announcement posted', detail: 'Voting starts tomorrow', time: '1 day ago', type: 'announce' },
];

const activityColors = {
  election: 'bg-[#E6F6FD] text-[#0B8ED0]',
  finance: 'bg-emerald-50 text-emerald-600',
  event: 'bg-violet-50 text-violet-600',
  task: 'bg-amber-50 text-amber-600',
  announce: 'bg-sky-50 text-sky-600',
};

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <article
            key={stat.label}
            className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-[#0B8ED0]/20"
          >
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

      {/* Module quick access */}
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#0F172A]">Select Module</h2>
            <p className="text-sm font-medium text-slate-500">Quick access to all officer modules</p>
          </div>
          <span className="rounded-full bg-[#E6F6FD] px-3 py-1 text-xs font-bold text-[#0878B7]">
            {modules.length} Modules
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((mod) => (
            <NavLink
              key={mod.path}
              to={mod.path}
              className="group flex items-start gap-4 rounded-xl border border-[#DDE7EF] bg-[#F8FBFD] p-4 transition-all duration-200 hover:border-[#0B8ED0]/30 hover:bg-white hover:shadow-md"
            >
              <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${mod.bg} ${mod.text} transition-all group-hover:bg-gradient-to-br group-hover:${mod.color} group-hover:text-white`}>
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

      {/* Recent activity */}
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-[#0F172A]">Recent Activity</h2>
        <div className="space-y-3">
          {recentActivity.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-lg bg-[#F8FBFD] p-3.5 transition hover:bg-[#EEF6FB]"
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${activityColors[item.type]?.split(' ')[0] || 'bg-slate-200'}`} />
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
