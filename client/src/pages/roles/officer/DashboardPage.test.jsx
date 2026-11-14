import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const taskMocks = vi.hoisted(() => ({ getTasks: vi.fn() }));
const eventMocks = vi.hoisted(() => ({ getEvents: vi.fn() }));
const financeMocks = vi.hoisted(() => ({ getTransactionSummary: vi.fn(), getBudgets: vi.fn() }));
const orderMocks = vi.hoisted(() => ({ getOrders: vi.fn() }));

vi.mock('../../../services/taskService', () => taskMocks);
vi.mock('../../../services/eventService', () => eventMocks);
vi.mock('../../../services/financeService', () => financeMocks);
vi.mock('../../../services/orderService', () => orderMocks);

function statValue(label) {
  return screen.getByText(label).parentElement?.querySelector('.tabular-nums')?.textContent;
}

describe('Officer DashboardPage stat cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Regression guard for bug class (b): /tasks is paginated, so each status
    // total below intentionally loads far FEWER rows than its true total - if
    // the page were counted with .length instead of reading `total`, Open
    // Tasks would render 1 instead of 42.
    taskMocks.getTasks.mockImplementation(({ status, waiting }) => {
      if (waiting) return Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 0 } });
      const byStatus = {
        pending: { data: [{ id: 1, deadline: '2026-09-01', status: 'pending' }], current_page: 1, last_page: 4, per_page: 10, total: 37 },
        in_progress: { data: [], current_page: 1, last_page: 1, per_page: 10, total: 5 },
        completed: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 12 },
        overdue: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 3 },
      };
      return Promise.resolve({ data: byStatus[status] });
    });

    eventMocks.getEvents.mockResolvedValue({
      data: { data: [{ id: 1, status: 'approved' }], current_page: 1, last_page: 1, per_page: 100, total: 1 },
    });

    financeMocks.getTransactionSummary.mockResolvedValue({ data: { net_balance: 1500, by_category: [] } });
    financeMocks.getBudgets.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, per_page: 100, total: 0 } });

    orderMocks.getOrders.mockResolvedValue({
      data: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 8 },
    });
  });

  it('reads Open tasks from the pending+in_progress totals, not the loaded page length', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    await waitFor(() => expect(statValue('Open tasks')).toBe('42'));
  });

  it('reads Pending orders from the server total, not the loaded page length', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    await waitFor(() => expect(statValue('Pending orders')).toBe('8'));
  });

  it('makes each tile a link to the list behind its number', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    await waitFor(() => expect(statValue('Open tasks')).toBe('42'));
    expect(screen.getByText('Open tasks').closest('a')).toHaveAttribute('href', '/dashboard/tasks/assigned-tasks');
    expect(screen.getByText('Pending orders').closest('a')).toHaveAttribute('href', '/dashboard/merchandise/manage-orders');
    expect(screen.getByText('Upcoming events').closest('a')).toHaveAttribute('href', '/dashboard/events/activity-calendar');
    expect(screen.queryByText('Completed tasks')).not.toBeInTheDocument();
  });

  const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const page = (rows, total = rows.length) => ({ data: { data: rows, current_page: 1, last_page: 1, per_page: 10, total } });
  const serve = ({ pending = [], overdue = [], waiting = 0, pendingTotal = pending.length }) => taskMocks.getTasks.mockImplementation(({ status, waiting: onlyWaiting }) => Promise.resolve(
    onlyWaiting ? page([], waiting) : page({ pending, overdue }[status] ?? [], status === 'pending' ? pendingTotal : (status === 'overdue' ? overdue.length : 0)),
  ));

  it('says a task is waiting on another task instead of leaving its status blank', async () => {
    serve({ pending: [{ id: 9, title: 'Settle expenses', deadline: inDays(2), status: 'pending', workflow_status: 'blocked', dependency: { id: 4, title: 'Run the event' } }], waiting: 1 });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect((await screen.findAllByText('Waiting on Run the event')).length).toBeGreaterThanOrEqual(2);
  });

  it('counts a task waiting on another in its own Waiting row, not under Pending', async () => {
    serve({ pending: [{ id: 1, title: 'Ready task', deadline: inDays(1), status: 'pending' }], pendingTotal: 2, waiting: 1 });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    const row = (label) => screen.getByText(label, { selector: 'span' }).closest('li');
    await waitFor(() => expect(row('Waiting')).toHaveTextContent('1 (50%)'));
    expect(row('Pending')).toHaveTextContent('1 (50%)');
    expect(taskMocks.getTasks).toHaveBeenCalledWith({ status: 'pending', waiting: 1, per_page: 1 });
  });

  it('lists only tasks that are overdue or due within three days as urgent', async () => {
    serve({
      pending: [
        { id: 1, title: 'soon task', deadline: inDays(2), status: 'pending' },
        { id: 2, title: 'distant task', deadline: inDays(23), status: 'pending' },
      ],
      overdue: [{ id: 3, title: 'late task', deadline: inDays(-2), status: 'overdue' }],
    });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect((await screen.findAllByText('Soon Task')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Late Task').length).toBeGreaterThan(0);
    expect(screen.queryByText('Distant Task')).not.toBeInTheDocument();
  });

  it('says Nothing urgent when every open task is further off than that', async () => {
    serve({ pending: [{ id: 2, title: 'distant task', deadline: inDays(23), status: 'pending' }] });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect((await screen.findAllByText('Nothing urgent')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Distant Task')).not.toBeInTheDocument();
  });

  it('names the first action when nothing has been assigned yet, instead of showing zeros', async () => {
    const none = { data: { data: [], current_page: 1, last_page: 1, per_page: 10, total: 0 } };
    taskMocks.getTasks.mockResolvedValue(none);
    eventMocks.getEvents.mockResolvedValue(none);
    orderMocks.getOrders.mockResolvedValue(none);
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect(await screen.findByText('No work has been assigned to you yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open My tasks' })).toHaveAttribute('href', '/dashboard/tasks/assigned-tasks');
    expect(screen.queryByText('Open tasks')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open My tasks' })).not.toHaveClass('bg-brand-700');
  });

  describe('an officer given only some areas', () => {
    afterEach(() => localStorage.removeItem('user'));

    it('does not ask for orders or show the tile when Merchandise was not given', async () => {
      localStorage.setItem('user', JSON.stringify({ modules: ['events', 'tasks'] }));
      orderMocks.getOrders.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
      render(<MemoryRouter><DashboardPage /></MemoryRouter>);

      await waitFor(() => expect(statValue('Open tasks')).toBe('42'));
      expect(orderMocks.getOrders).not.toHaveBeenCalled();
      expect(screen.queryByText('Pending orders')).not.toBeInTheDocument();
      expect(screen.queryByText('Your work summary could not load')).not.toBeInTheDocument();
      expect(statValue('Upcoming events')).toBe('1');
    });

    it('does not ask for events or tasks that were not given', async () => {
      localStorage.setItem('user', JSON.stringify({ modules: ['merchandise'] }));
      render(<MemoryRouter><DashboardPage /></MemoryRouter>);

      await waitFor(() => expect(statValue('Pending orders')).toBe('8'));
      expect(taskMocks.getTasks).not.toHaveBeenCalled();
      expect(eventMocks.getEvents).not.toHaveBeenCalled();
      expect(screen.queryByText('Open tasks')).not.toBeInTheDocument();
      expect(screen.queryByText('Urgent tasks')).not.toBeInTheDocument();
    });
  });

  it('does not call a failed load an empty queue', async () => {
    taskMocks.getTasks.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    await waitFor(() => expect(statValue('Open tasks')).toBe('0'));
    expect(screen.queryByText('No work has been assigned to you yet')).not.toBeInTheDocument();
  });
});
