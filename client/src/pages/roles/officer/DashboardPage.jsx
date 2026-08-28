import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Coins,
  Megaphone,
  Package,
  Plus,
  TrendingUp,
  Vote,
} from 'lucide-react';
import { getTasks } from '../../../services/taskService';
import { getEvents } from '../../../services/eventService';
import { getTransactionSummary, getBudgets } from '../../../services/financeService';
import { getOrders } from '../../../services/orderService';

const STATUS_BADGE = {
  pending:     'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  completed:   'bg-emerald-50 text-emerald-700',
  overdue:     'bg-red-50 text-red-700',
};

const TASK_STATUS_COLOR = {
  pending:     '#F59E0B',
  in_progress: '#0B8ED0',
  completed:   '#16A34A',
  overdue:     '#DC2626',
};

const TASK_STATUS_ORDER = ['pending', 'in_progress', 'completed', 'overdue'];

function fmt(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function capitalize(s) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ openTasks: 0, upcomingEvents: 0, budgetBalance: 0, pendingOrders: 0 });
  const [urgentTasks, setUrgentTasks] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [expensesByCategory, setExpensesByCategory] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [tasksRes, eventsRes, summaryRes, ordersRes, budgetsRes] = await Promise.all([
          getTasks(),
          getEvents(),
          getTransactionSummary(),
          getOrders(),
          getBudgets(),
        ]);

        if (cancelled) return;

        const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : (Array.isArray(tasksRes) ? tasksRes : []);
        const events = Array.isArray(eventsRes?.data) ? eventsRes.data : (Array.isArray(eventsRes) ? eventsRes : []);
        const summary = summaryRes?.data ?? summaryRes ?? {};
        const ordersRaw = ordersRes?.data;
        const orders = Array.isArray(ordersRaw?.data) ? ordersRaw.data : (Array.isArray(ordersRaw) ? ordersRaw : []);
        const budgetsList = Array.isArray(budgetsRes?.data) ? budgetsRes.data : (Array.isArray(budgetsRes) ? budgetsRes : []);

        const openTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');

        setStats({
          openTasks: openTasks.length,
          upcomingEvents: events.filter((e) => e.status === 'upcoming' || e.status === 'approved').length,
          budgetBalance: Number(summary.net_balance ?? 0),
          pendingOrders: orders.filter((o) => o.status === 'pending').length,
        });

        setUrgentTasks(
          openTasks
            .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
            .slice(0, 4)
        );
        setAllTasks(tasks);

        const byCategory = Array.isArray(summary.by_category) ? summary.by_category : [];
        setExpensesByCategory(
          byCategory.filter((c) => c.type === 'expense').slice(0, 5)
        );
        setBudgets(budgetsList);
      } catch {
        if (!cancelled) setStats({ openTasks: 0, upcomingEvents: 0, budgetBalance: 0, pendingOrders: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const maxExpense = Math.max(...expensesByCategory.map((c) => Number(c.total)), 1);

  const budgetUtilization = budgets
    .filter((b) => b.approval_status === 'approved')
    .map((b) => {
      const allocated = Number(b.allocated_amount || 0);
      const remaining = b.remaining_amount != null ? Number(b.remaining_amount) : allocated;
      const transacted = Number(b.transactions_sum_amount || 0);
      // remaining = allocated + income - expense, transacted = income + expense,
      // so (allocated + transacted - remaining) / 2 isolates expense (actual spend).
      const spent = Math.max(0, (allocated + transacted - remaining) / 2);
      return {
        id: b.id,
        title: b.title,
        allocated,
        spent,
        warning: Number(b.warning_threshold || 0),
      };
    })
    .sort((a, b) => b.allocated - a.allocated)
    .slice(0, 6);

  const taskStatusCounts = TASK_STATUS_ORDER.map((status) => ({
    status,
    count: allTasks.filter((t) => t.status === status).length,
  }));
  const totalTasksCount = allTasks.length;

  const statCards = [
    { label: 'Open Tasks', value: loading ? '-' : stats.openTasks, helper: 'Pending & in-progress', icon: ClipboardList, trend: 'Active' },
    { label: 'Upcoming Events', value: loading ? '-' : stats.upcomingEvents, helper: 'Scheduled & approved', icon: CalendarDays, trend: 'Soon' },
    { label: 'Budget Balance', value: loading ? '-' : fmt(stats.budgetBalance), helper: 'Net income minus expenses', icon: Coins, trend: 'Balance' },
    { label: 'Pending Orders', value: loading ? '-' : stats.pendingOrders, helper: 'Merch awaiting action', icon: Package, trend: 'Queue' },
  ];

  const modules = [
    { label: 'Finance', desc: 'Budgets, insights, and reports', path: '/dashboard/finance', icon: Coins },
    { label: 'Events', desc: 'Attendance and event operations', path: '/dashboard/events', icon: CalendarDays },
    { label: 'Tasks', desc: 'View and update assigned tasks', path: '/dashboard/tasks', icon: ClipboardList },
    { label: 'Elections', desc: 'Candidates, voters, ballots, and results', path: '/dashboard/elections', icon: Vote },
    { label: 'Merchandise', desc: 'Orders, claims, and personal shopping', path: '/dashboard/merchandise', icon: Package },
    { label: 'Announcements', desc: 'Draft, submit, and view notices', path: '/dashboard/announcements', icon: Megaphone },
  ];

  const quickActions = [
    { label: 'Assigned Tasks', path: '/dashboard/tasks/assigned-tasks', icon: ClipboardList },
    { label: 'Event Operations', path: '/dashboard/events/event-operations', icon: CalendarDays },
    { label: 'Financial Insights', path: '/dashboard/finance/financial-insights', icon: Coins },
    { label: 'Post Announcement', path: '/dashboard/announcements/create-announcement', icon: Megaphone },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Operations Hub</p>
        <h2 className="mt-1 text-2xl sm:text-3xl font-black text-[#0F172A]">Officer Dashboard</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Live overview of tasks, events, finances, and merchandise.</p>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCards.map((stat) => (
          <article
            key={stat.label}
            className="group rounded-xl border border-[#DDE7EF] bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-md hover:border-[#0B8ED0]/20 sm:p-5"
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

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        {/* Urgent Tasks Table */}
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#DDE7EF] px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">Urgent Tasks</h2>
              <p className="text-xs font-medium text-slate-400">Next 4 open tasks by deadline</p>
            </div>
            <NavLink to="/dashboard/tasks" className="flex items-center gap-1 text-xs font-bold text-[#0B8ED0] hover:underline">
              View all <ChevronRight size={13} />
            </NavLink>
          </div>
          {loading ? (
            <div className="space-y-3 p-5">
              {[...Array(4)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : urgentTasks.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">No open tasks. You're all caught up!</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Task</th>
                    <th className="px-5 py-3">Assignee</th>
                    <th className="px-5 py-3">Deadline</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {urgentTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-[#F8FBFD]">
                      <td className="max-w-[220px] truncate px-5 py-3.5 font-semibold text-[#0F172A]">{t.title}</td>
                      <td className="max-w-[160px] truncate px-5 py-3.5 text-slate-500">
                        {t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : '-'}
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 tabular-nums">
                        {t.deadline ? new Date(t.deadline).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '-'}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${STATUS_BADGE[t.status] || 'bg-slate-100 text-slate-500'}`}>
                          {capitalize(t.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Budget Utilization + Task Status + Quick Actions */}
        <div className="space-y-6">
          <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[#0F172A]">Budget Utilization</h2>
              <NavLink to="/dashboard/finance/budget-allocation" className="text-xs font-bold text-[#0B8ED0] hover:underline">View</NavLink>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : budgetUtilization.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No approved budgets yet.</p>
            ) : (
              <div className="space-y-3">
                {budgetUtilization.map((b) => {
                  const pct = b.allocated > 0 ? Math.min(100, Math.round((b.spent / b.allocated) * 100)) : 0;
                  const barColor = b.spent >= b.allocated ? '#DC2626' : (b.warning > 0 && b.spent >= b.warning) ? '#F59E0B' : '#0B8ED0';
                  return (
                    <div key={b.id}>
                      <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                        <span className="truncate text-[#0F172A]">{b.title}</span>
                        <span className="ml-2 shrink-0 tabular-nums text-slate-500">{fmt(b.spent)} / {fmt(b.allocated)} ({pct}%)</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#EEF6FB]">
                        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-[#0F172A]">Task Status Distribution</h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : totalTasksCount === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No tasks recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {taskStatusCounts.map((item) => {
                  const pct = totalTasksCount ? Math.round((item.count / totalTasksCount) * 100) : 0;
                  return (
                    <div key={item.status}>
                      <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                        <span className="text-[#0F172A]">{capitalize(item.status)}</span>
                        <span className="tabular-nums text-slate-500">{item.count} ({pct}%)</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#EEF6FB]">
                        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: TASK_STATUS_COLOR[item.status] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[#0F172A]">Expenses by Category</h2>
              <NavLink to="/dashboard/finance" className="text-xs font-bold text-[#0B8ED0] hover:underline">View</NavLink>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : expensesByCategory.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No expense data yet.</p>
            ) : (
              <div className="space-y-3">
                {expensesByCategory.map((c) => (
                  <div key={c.category}>
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                      <span className="truncate text-[#0F172A]">{c.category}</span>
                      <span className="ml-2 shrink-0 tabular-nums text-slate-500">{fmt(c.total)}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[#EEF6FB]">
                      <div
                        className="h-2 rounded-full bg-[#0B8ED0] transition-all"
                        style={{ width: `${Math.round((Number(c.total) / maxExpense) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-bold text-[#0F172A]">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              {quickActions.map((a) => (
                <NavLink
                  key={a.path}
                  to={a.path}
                  className="flex items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3 text-xs font-bold text-[#0F172A] transition hover:border-[#0B8ED0]/30 hover:bg-white hover:text-[#0B8ED0] sm:text-sm"
                >
                  <Plus size={13} className="shrink-0 text-[#0B8ED0]" />
                  {a.label}
                </NavLink>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Module Grid */}
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#0F172A]">Quick Access</h2>
            <p className="text-sm font-medium text-slate-500">All modules for this role</p>
          </div>
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
