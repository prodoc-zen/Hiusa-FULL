import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { getTasks } from '../../../services/taskService';
import { getEvents } from '../../../services/eventService';
import { getOrders } from '../../../services/orderService';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import { RoleBriefing } from '../../../components/dashboard';
import { readUserModules } from '../../../utils/userModules';
import { Button, DataTable, EmptyState, ErrorState, Skeleton, Stat, StatusBadge } from '../../../components/ui';

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

const TASK_COLUMNS = [
  { key: 'title', header: 'Task', className: 'max-w-[220px] font-medium', render: (task) => formatDisplayText(task.title) },
  {
    key: 'assignee',
    header: 'Assignee',
    className: 'max-w-[160px] text-ink-muted-strong',
    render: (task) => (task.assignee ? `${formatDisplayText(task.assignee.first_name)} ${formatDisplayText(task.assignee.last_name)}` : null),
  },
  {
    key: 'deadline',
    header: 'Deadline',
    className: 'whitespace-nowrap text-ink-muted-strong',
    render: (task) => (task.deadline ? new Date(task.deadline).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : null),
  },
  // Pending is the default state and carries no badge.
  { key: 'status', header: 'Status', render: (task) => (task.status === 'pending' ? null : <StatusBadge tone={task.status === 'overdue' ? 'danger' : 'active'} label={capitalize(task.status)} />) },
];

const EMPTY_PAGE = { data: { data: [], total: 0 } };

export default function DashboardPage() {
  // An officer only reaches the areas the Admin ticked (null means all). Each request below is
  // one area's list and answers 403 outside it, so an area that was not given is never asked for.
  const [modules] = useState(readUserModules);
  const hasModule = (name) => !Array.isArray(modules) || modules.includes(name);
  const canTasks = hasModule('tasks');
  const canEvents = hasModule('events');
  const canOrders = hasModule('merchandise');

  const [stats, setStats] = useState({ openTasks: 0, completedTasks: 0, upcomingEvents: 0, pendingOrders: 0 });
  const [urgentTasks, setUrgentTasks] = useState([]);
  const [taskStatusTotals, setTaskStatusTotals] = useState({ pending: 0, in_progress: 0, completed: 0, overdue: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
          canTasks ? getTasks({ status: 'pending', per_page: 10 }) : EMPTY_PAGE,
          canTasks ? getTasks({ status: 'in_progress', per_page: 10 }) : EMPTY_PAGE,
          canTasks ? getTasks({ status: 'completed', per_page: 1 }) : EMPTY_PAGE,
          canTasks ? getTasks({ status: 'overdue', per_page: 1 }) : EMPTY_PAGE,
          canEvents ? fetchAllPages((p) => getEvents(p).then((r) => r.data)) : [],
          // /orders only accepts per_page=10 (its validation rejects any other
          // value with a 422); the true pending count still comes from
          // pendingOrdersMeta.total regardless of the page size requested.
          canOrders ? getOrders({ status: 'pending', per_page: 10 }) : EMPTY_PAGE,
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
  }, [reloadKey, canTasks, canEvents, canOrders]);

  const retry = () => {
    setFailed(false);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const taskStatusCounts = TASK_STATUS_ORDER.map((status) => ({
    status,
    count: taskStatusTotals[status] ?? 0,
  }));
  const totalTasksCount = TASK_STATUS_ORDER.reduce((sum, status) => sum + (taskStatusTotals[status] ?? 0), 0);

  // Three tiles, each a link to the list behind the number.
  const statCards = [
    canTasks && { label: 'Open tasks', value: stats.openTasks, to: '/dashboard/tasks/assigned-tasks' },
    canEvents && { label: 'Upcoming events', value: stats.upcomingEvents, to: '/dashboard/events/activity-calendar' },
    canOrders && { label: 'Pending orders', value: stats.pendingOrders, to: '/dashboard/merchandise/manage-orders' },
  ].filter(Boolean);

  // Nothing assigned yet: name the first action instead of a wall of zeros.
  const firstRun = !loading && !failed && totalTasksCount === 0 && Object.values(stats).every((value) => value === 0);

  if (firstRun) {
    return (
      <div className="w-full space-y-6">
        <RoleBriefing />
        <section className="rounded-card border border-line bg-surface px-4" aria-label="Work queue">
          <EmptyState
            kind="first-run"
            title="No work has been assigned to you yet"
            description="Tasks, orders to verify and events show here once your Admin assigns them."
            action={canTasks ? <Button to="/dashboard/tasks/assigned-tasks" variant="secondary">Open My tasks</Button> : undefined}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6">
      <RoleBriefing />
      {failed && (
        <div role="alert" className="rounded-card border border-line bg-surface px-4">
          <ErrorState title="Your work summary could not load" description="Check your connection and try again." onRetry={retry} />
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Work summary">
        {statCards.map((stat) => (
          <Stat key={stat.label} label={stat.label} to={stat.to} value={loading ? '-' : stat.value} />
        ))}
      </section>

      {canTasks && <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-card border border-line bg-surface p-4 sm:p-5" aria-labelledby="urgent-tasks-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 id="urgent-tasks-title" className="text-base font-semibold text-ink">Urgent tasks</h2>
              <p className="text-sm text-ink-muted">The next 4 open tasks by deadline.</p>
            </div>
            <NavLink to="/dashboard/tasks" className="inline-flex min-h-11 items-center gap-1 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
              View all <ChevronRight size={13} aria-hidden="true" />
            </NavLink>
          </div>
          <DataTable
            caption="Urgent tasks by deadline"
            columns={TASK_COLUMNS}
            rows={urgentTasks}
            rowKey={(task) => task.id}
            loading={loading}
            emptyState={<EmptyState title="No open tasks" description="Tasks assigned to you show here." />}
          />
        </section>

        <section className="self-start rounded-card border border-line bg-surface p-5" aria-labelledby="task-status-title">
          <h2 id="task-status-title" className="mb-4 text-base font-semibold text-ink">Task status</h2>
          {loading ? (
            <div role="status" className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              <span className="sr-only">Loading task status</span>
            </div>
          ) : totalTasksCount === 0 ? (
            <p className="text-sm text-ink-muted">No tasks recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {taskStatusCounts.map((item) => {
                const pct = totalTasksCount ? Math.round((item.count / totalTasksCount) * 100) : 0;
                return (
                  <li key={item.status}>
                    <div className="mb-1 flex items-center justify-between text-xs font-medium">
                      <span className="text-ink">{capitalize(item.status)}</span>
                      <span className="tabular-nums text-ink-muted">{item.count} ({pct}%)</span>
                    </div>
                    <div className="h-2 w-full rounded-control bg-page">
                      <div className={`h-2 rounded-control ${TASK_STATUS_BAR[item.status]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>}
    </div>
  );
}
