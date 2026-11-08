import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Coins,
  Megaphone,
  Package,
} from 'lucide-react';
import { getTasks } from '../../../services/taskService';
import { getEvents } from '../../../services/eventService';
import { getOrders } from '../../../services/orderService';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import { RoleBriefing } from '../../../components/dashboard';
import { Button, EmptyState } from '../../../components/ui';

const STATUS_BADGE = {
  pending:     'bg-amber-50 text-amber-800',
  in_progress: 'bg-brand-600/10 text-brand-800',
  completed:   'bg-green-50 text-green-800',
  overdue:     'bg-red-50 text-red-800',
};

const TASK_STATUS_BAR = {
  pending:     'bg-warning',
  in_progress: 'bg-brand-600',
  completed:   'bg-success',
  overdue:     'bg-danger',
};

const TASK_STATUS_ORDER = ['pending', 'in_progress', 'completed', 'overdue'];

function capitalize(s) {
  const words = (s || '').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ openTasks: 0, completedTasks: 0, upcomingEvents: 0, pendingOrders: 0 });
  const [urgentTasks, setUrgentTasks] = useState([]);
  const [taskStatusTotals, setTaskStatusTotals] = useState({ pending: 0, in_progress: 0, completed: 0, overdue: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // /tasks and /events are paginated (default 20/page). Task status has a
        // server-side filter, so each status total is read from its own filtered
        // response rather than counting a loaded page; "urgent tasks" only needs
        // the nearest few deadlines, so pending/in_progress are fetched with a
        // small per_page (already deadline-ascending) and merged. Events has no
        // status filter at all, so the full org event list is walked once via
        // fetchAllPages so the upcoming-event count is not limited to one page.
        const [
          pendingRes, inProgressRes, completedRes, overdueRes,
          events, pendingOrdersRes,
        ] = await Promise.all([
          getTasks({ status: 'pending', per_page: 10 }),
          getTasks({ status: 'in_progress', per_page: 10 }),
          getTasks({ status: 'completed', per_page: 1 }),
          getTasks({ status: 'overdue', per_page: 1 }),
          fetchAllPages((p) => getEvents(p).then((r) => r.data)),
          // /orders only accepts per_page=10 (its validation rejects any other
          // value with a 422); the true pending count still comes from
          // pendingOrdersMeta.total regardless of the page size requested.
          getOrders({ status: 'pending', per_page: 10 }),
        ]);

        if (cancelled) return;

        const pendingMeta = listMeta(pendingRes?.data);
        const inProgressMeta = listMeta(inProgressRes?.data);
        const completedMeta = listMeta(completedRes?.data);
        const overdueMeta = listMeta(overdueRes?.data);
        const pendingOrdersMeta = listMeta(pendingOrdersRes?.data);

        setStats({
          openTasks: pendingMeta.total + inProgressMeta.total,
          completedTasks: completedMeta.total,
          upcomingEvents: events.filter((e) => e.status === 'upcoming' || e.status === 'approved').length,
          pendingOrders: pendingOrdersMeta.total,
        });

        setUrgentTasks(
          [...unwrapList(pendingRes?.data), ...unwrapList(inProgressRes?.data)]
            .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
            .slice(0, 4)
        );
        setTaskStatusTotals({
          pending: pendingMeta.total,
          in_progress: inProgressMeta.total,
          completed: completedMeta.total,
          overdue: overdueMeta.total,
        });

      } catch {
        if (!cancelled) {
          setStats({ openTasks: 0, completedTasks: 0, upcomingEvents: 0, pendingOrders: 0 });
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const taskStatusCounts = TASK_STATUS_ORDER.map((status) => ({
    status,
    count: taskStatusTotals[status] ?? 0,
  }));
  const totalTasksCount = TASK_STATUS_ORDER.reduce((sum, status) => sum + (taskStatusTotals[status] ?? 0), 0);

  const statCards = [
    { label: 'Open tasks', value: loading ? '-' : stats.openTasks, helper: 'Pending and in progress', icon: ClipboardList },
    { label: 'Upcoming events', value: loading ? '-' : stats.upcomingEvents, helper: 'Scheduled and approved', icon: CalendarDays },
    { label: 'Completed tasks', value: loading ? '-' : stats.completedTasks, helper: 'Finished assignments', icon: ClipboardList },
    { label: 'Pending orders', value: loading ? '-' : stats.pendingOrders, helper: 'Merchandise awaiting action', icon: Package },
  ];

  const quickActions = [
    { label: 'My tasks', path: '/dashboard/tasks/assigned-tasks', icon: ClipboardList },
    { label: 'Check-in', path: '/dashboard/events/check-in', icon: CalendarDays },
    { label: 'My receipts', path: '/dashboard/finance/personal-receipts', icon: Coins },
    { label: 'New announcement', path: '/dashboard/announcements/create-announcement', icon: Megaphone },
  ];

  const quickActionsSection = (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="mb-3 text-base font-semibold text-ink">Quick actions</h2>
      <div className="grid grid-cols-2 gap-2">
        {quickActions.map((a) => (
          <NavLink
            key={a.path}
            to={a.path}
            className="flex min-h-11 items-center gap-2 rounded-control border border-line bg-subtle p-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface hover:text-brand-700"
          >
            <a.icon size={16} className="shrink-0 text-brand-700" aria-hidden="true" />
            {a.label}
          </NavLink>
        ))}
      </div>
    </section>
  );

  // Nothing assigned yet: name the first action instead of a wall of zeros.
  const firstRun = !loading && !failed && totalTasksCount === 0 && Object.values(stats).every((value) => value === 0);

  if (firstRun) {
    return (
      <div className="w-full space-y-6">
        <RoleBriefing />
        <section className="rounded-card border border-line bg-surface px-4" aria-label="Work queue">
          <EmptyState
            kind="first-run"
            icon={ClipboardList}
            title="No work has been assigned to you yet"
            description="Tasks, orders to verify and events appear here once your Admin assigns them."
            action={<Button to="/dashboard/tasks/assigned-tasks">Open My tasks</Button>}
          />
        </section>
        {quickActionsSection}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6">
      <RoleBriefing />
      <section className="overflow-hidden rounded-card border border-line bg-surface">
        <div className="border-b border-line px-5 py-4"><h2 className="text-base font-semibold text-ink">Operations snapshot</h2></div>
        <dl className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map((stat) => (
            <div key={stat.label} className="bg-surface px-4 py-3">
              <dt className="flex items-center gap-2 text-sm font-medium text-ink-muted"><stat.icon size={17} className="text-brand-700" aria-hidden="true" />{stat.label}</dt>
              <dd className="mt-2 text-xl font-semibold tabular-nums text-ink">{stat.value}</dd>
              <p className="mt-1 text-xs text-ink-muted">{stat.helper}</p>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Urgent Tasks Table */}
        <section className="rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Urgent tasks</h2>
              <p className="text-xs text-ink-muted">Next 4 open tasks by deadline</p>
            </div>
            <NavLink to="/dashboard/tasks" className="flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              View all <ChevronRight size={13} aria-hidden="true" />
            </NavLink>
          </div>
          {loading ? (
            <div className="space-y-3 p-5">
              {[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-control bg-line" />)}
            </div>
          ) : urgentTasks.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink-muted">No open tasks.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <caption className="sr-only">Urgent tasks by deadline</caption>
                <thead className="bg-subtle text-xs font-semibold text-ink-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2.5">Task</th>
                    <th scope="col" className="px-5 py-2.5">Assignee</th>
                    <th scope="col" className="px-5 py-2.5">Deadline</th>
                    <th scope="col" className="px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft text-sm">
                  {urgentTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-subtle">
                      <td className="max-w-[220px] truncate px-5 py-2.5 font-medium text-ink">{formatDisplayText(t.title)}</td>
                      <td className="max-w-[160px] truncate px-5 py-2.5 text-ink-muted">
                        {t.assignee ? `${formatDisplayText(t.assignee.first_name)} ${formatDisplayText(t.assignee.last_name)}` : '-'}
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted tabular-nums">
                        {t.deadline ? new Date(t.deadline).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '-'}
                      </td>
                      <td className="px-5 py-2.5">
                        <span className={`inline-flex h-6 items-center rounded px-2 text-xs font-medium ${STATUS_BADGE[t.status] || 'bg-slate-100 text-slate-700'}`}>
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

        {/* Task status and quick actions */}
        <div className="space-y-6">
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-4 text-base font-semibold text-ink">Task status</h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => <div key={i} className="h-8 rounded-control bg-line" />)}
              </div>
            ) : totalTasksCount === 0 ? (
              <p className="py-6 text-sm text-ink-muted">No tasks recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {taskStatusCounts.map((item) => {
                  const pct = totalTasksCount ? Math.round((item.count / totalTasksCount) * 100) : 0;
                  return (
                    <div key={item.status}>
                      <div className="mb-1 flex items-center justify-between text-xs font-medium">
                        <span className="text-ink">{capitalize(item.status)}</span>
                        <span className="tabular-nums text-ink-muted">{item.count} ({pct}%)</span>
                      </div>
                      <div className="h-2 w-full rounded-control bg-page">
                        <div className={`h-2 rounded-control ${TASK_STATUS_BAR[item.status]}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {quickActionsSection}
        </div>
      </div>

    </div>
  );
}
