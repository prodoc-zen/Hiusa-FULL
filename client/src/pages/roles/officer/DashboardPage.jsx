import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Coins,
  Megaphone,
  Package,
  TrendingUp,
  Vote,
} from 'lucide-react';
import { getTasks } from '../../../services/taskService';
import { getEvents } from '../../../services/eventService';
import { getTransactionSummary } from '../../../services/financeService';
import { getOrders } from '../../../services/orderService';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    openTasks: 0,
    upcomingEvents: 0,
    budgetBalance: 0,
    pendingOrders: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [tasksRes, eventsRes, summaryRes, ordersRes] = await Promise.all([
          getTasks(),
          getEvents(),
          getTransactionSummary(),
          getOrders(),
        ]);

        if (cancelled) return;

        const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : (Array.isArray(tasksRes) ? tasksRes : []);
        const events = Array.isArray(eventsRes?.data) ? eventsRes.data : (Array.isArray(eventsRes) ? eventsRes : []);
        const summary = summaryRes?.data ?? summaryRes ?? {};
        const orders = Array.isArray(ordersRes?.data) ? ordersRes.data : (Array.isArray(ordersRes) ? ordersRes : []);

        setStats({
          openTasks: tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
          upcomingEvents: events.filter((e) => e.status === 'upcoming' || e.status === 'approved').length,
          budgetBalance: Number(summary.net_balance ?? 0),
          pendingOrders: orders.filter((o) => o.status === 'pending').length,
        });
      } catch {
        if (!cancelled) setStats({ openTasks: 0, upcomingEvents: 0, budgetBalance: 0, pendingOrders: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const fmt = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const statCards = [
    { label: 'Open Tasks', value: loading ? '—' : stats.openTasks, helper: 'Pending & in-progress', icon: ClipboardList, trend: 'Active' },
    { label: 'Upcoming Events', value: loading ? '—' : stats.upcomingEvents, helper: 'Scheduled & approved', icon: CalendarDays, trend: 'Scheduled' },
    { label: 'Budget Balance', value: loading ? '—' : fmt(stats.budgetBalance), helper: 'Net income minus expenses', icon: Coins, trend: 'Balance' },
    { label: 'Pending Orders', value: loading ? '—' : stats.pendingOrders, helper: 'Merch orders awaiting action', icon: Package, trend: 'Queue' },
  ];

  const modules = [
    { label: 'Finance', desc: 'Transactions, forecasting, reports', path: '/dashboard/finance', icon: Coins },
    { label: 'Events', desc: 'Create events and track attendance', path: '/dashboard/events', icon: CalendarDays },
    { label: 'Tasks', desc: 'Create tasks and monitor progress', path: '/dashboard/tasks', icon: ClipboardList },
    { label: 'Elections', desc: 'Manage ballots and results', path: '/dashboard/elections', icon: Vote },
    { label: 'Merchandise', desc: 'Inventory and orders', path: '/dashboard/merchandise', icon: Package },
    { label: 'Announcements', desc: 'Post updates and notices', path: '/dashboard/announcements', icon: Megaphone },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Operations Hub</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Officer Dashboard</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Live overview of tasks, events, finances, and merchandise.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => (
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
            <p className="mt-1 text-2xl font-black text-[#0F172A] tabular-nums">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#0F172A]">Quick Access</h2>
            <p className="text-sm font-medium text-slate-500">Frequently used modules</p>
          </div>
          <span className="rounded-full bg-[#E6F6FD] px-3 py-1 text-xs font-bold text-[#0878B7]">{modules.length} Modules</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((mod) => (
            <NavLink
              key={mod.path}
              to={mod.path}
              className="group flex items-start gap-4 rounded-xl border border-[#DDE7EF] bg-[#F8FBFD] p-4 transition-all duration-200 hover:border-[#0B8ED0]/30 hover:bg-white hover:shadow-md"
            >
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
    </div>
  );
}
