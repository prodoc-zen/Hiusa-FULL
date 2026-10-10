import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    taskMocks.getTasks.mockImplementation(({ status }) => {
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

  it('reads Open Tasks from the pending+in_progress totals, not the loaded page length', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    await waitFor(() => expect(statValue('Open Tasks')).toBe('42'));
  });

  it('reads Pending Orders from the server total, not the loaded page length', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    await waitFor(() => expect(statValue('Pending Orders')).toBe('8'));
  });

  it('names the first action when nothing has been assigned yet, instead of showing zeros', async () => {
    const none = { data: { data: [], current_page: 1, last_page: 1, per_page: 10, total: 0 } };
    taskMocks.getTasks.mockResolvedValue(none);
    eventMocks.getEvents.mockResolvedValue(none);
    orderMocks.getOrders.mockResolvedValue(none);
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect(await screen.findByText('No work has been assigned to you yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open My tasks' })).toHaveAttribute('href', '/dashboard/tasks/assigned-tasks');
    expect(screen.queryByText('Open Tasks')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check-in' })).toBeInTheDocument();
  });

  it('does not call a failed load an empty queue', async () => {
    taskMocks.getTasks.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    await waitFor(() => expect(statValue('Open Tasks')).toBe('0'));
    expect(screen.queryByText('No work has been assigned to you yet')).not.toBeInTheDocument();
  });
});
