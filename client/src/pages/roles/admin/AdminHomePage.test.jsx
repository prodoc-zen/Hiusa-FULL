import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHomePage from './AdminHomePage';

const dashboardMock = vi.hoisted(() => ({ getAdminDashboard: vi.fn() }));
vi.mock('../../../services/adminDashboardService', () => dashboardMock);

const payload = {
  counts: { pending_orders: 4, approval_requests: 2, pending_tasks: 7, new_announcements: 1 },
  movement: [{ month: '2026-09', income: 12000, expense: 3000 }],
  announcements: [{ id: 1, title: 'Enrollment notice', body: 'Please review enrollment dates.', published_at: '2026-09-28T00:00:00Z', creator: { first_name: 'Jane', last_name: 'Doe' }, source_organization: { name: 'HIUSA' } }],
};

describe('AdminHomePage', () => {
  beforeEach(() => { vi.clearAllMocks(); dashboardMock.getAdminDashboard.mockResolvedValue({ data: payload }); });

  it('shows live operational counts, ledger movement, announcement preview, and destinations', async () => {
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);
    expect(await screen.findByText('Enrollment Notice')).toBeInTheDocument();
    expect(screen.getByText('Pending Orders').closest('a')).toHaveTextContent('4');
    expect(screen.getByText('Approval Requests').closest('a')).toHaveTextContent('2');
    expect(screen.getByRole('img', { name: /monthly ledger income and expenses/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'People' })).toHaveAttribute('href', '/dashboard/admin/users');
    expect(screen.getByRole('link', { name: 'Officer positions' })).toHaveAttribute('href', '/dashboard/admin/positions');
    expect(screen.getByRole('link', { name: 'New announcement' })).toHaveAttribute('href', '/dashboard/announcements/create-announcement');
    fireEvent.change(screen.getByLabelText('Financial status period'), { target: { value: '3' } });
    await waitFor(() => expect(dashboardMock.getAdminDashboard).toHaveBeenLastCalledWith(3));
  });

  it('handles empty financial data and request failure with retry', async () => {
    dashboardMock.getAdminDashboard.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { ...payload, movement: [] } });
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('No ledger transactions in this period.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Propose a budget/ })).toHaveAttribute('href', '/dashboard/finance/budget-allocation');
  });

  it('names the first action instead of four zeros when the organization has no data yet', async () => {
    dashboardMock.getAdminDashboard.mockResolvedValue({ data: { counts: { pending_orders: 0, approval_requests: 0, pending_tasks: 0, new_announcements: 0 }, movement: [], announcements: [] } });
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    expect(await screen.findByText('Nothing has happened here yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plan your first event' })).toHaveAttribute('href', '/dashboard/events/manage-events');
    expect(screen.queryByText('Pending Orders')).not.toBeInTheDocument();
  });

  it('keeps the count tiles once there is anything to count', async () => {
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);
    expect(await screen.findByText('Pending Orders')).toBeInTheDocument();
    expect(screen.queryByText('Nothing has happened here yet')).not.toBeInTheDocument();
  });
});
