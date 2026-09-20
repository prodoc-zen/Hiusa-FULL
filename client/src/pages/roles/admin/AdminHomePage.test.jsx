import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHomePage from './AdminHomePage';

const userMocks = vi.hoisted(() => ({ getUsers: vi.fn() }));
const announcementMocks = vi.hoisted(() => ({ getAnnouncements: vi.fn() }));
const financeMocks = vi.hoisted(() => ({ getForecasts: vi.fn() }));

vi.mock('../../../services/userService', () => userMocks);
vi.mock('../../../services/announcementService', () => announcementMocks);
vi.mock('../../../services/financeService', () => financeMocks);

function summaryValue(label) {
  return screen.getByText(label).parentElement?.querySelector('.tabular-nums')?.textContent;
}

describe('AdminHomePage dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Regression guard for bug class (b): /users is paginated and only returns
    // ONE row on this page, far short of the org's real 214 accounts. If the
    // pills counted the loaded page instead of reading summary.by_role, every
    // pill below would render 0 or 1 instead of the true per-role total.
    userMocks.getUsers.mockResolvedValue({
      data: [{ id: 1, role: 'STUDENT' }],
      current_page: 1,
      last_page: 214,
      per_page: 1,
      total: 214,
      summary: { by_role: { STUDENT: 180, SBO_OFFICER: 20, ADMIN: 4, DEPARTMENT_HEAD: 10 } },
    });

    announcementMocks.getAnnouncements.mockImplementation((params) => {
      if (params?.publication_status === 'published') {
        return Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 30 } });
      }
      if (params?.publication_status === 'draft') {
        return Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 12 } });
      }
      return Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 42 } });
    });
    financeMocks.getForecasts.mockResolvedValue({ data: { data: [
      { id: 1, forecast_period: '2026-10', predicted_income: 12000, predicted_expense: 8000, predicted_balance: 4000 },
      { id: 2, forecast_period: '2026-11', predicted_income: 13000, predicted_expense: 8500, predicted_balance: 4500 },
    ] } });
  });

  it('reads user counts from the server total and summary.by_role, not the loaded page', async () => {
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    await waitFor(() => expect(summaryValue('Total Accounts')).toBe('214'));
    expect(summaryValue('Officers')).toBe('20');
    expect(screen.queryByRole('heading', { name: 'Account distribution' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /line graph comparing predicted income/i })).toBeInTheDocument();
  });

  it('derives published/draft announcement counts from server totals, not a loaded page', async () => {
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    await waitFor(() => expect(summaryValue('Published Announcements')).toBe('30'));
    expect(summaryValue('Draft Announcements')).toBe('12');
    expect(summaryValue('Total Announcements')).toBe('42');
  });

  it('keeps every existing administration destination available', async () => {
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    await waitFor(() => expect(summaryValue('Total Accounts')).toBe('214'));
    expect(screen.getByRole('link', { name: /manage user accounts/i })).toHaveAttribute('href', '/dashboard/admin/users');
    expect(screen.getByRole('link', { name: /create announcement/i })).toHaveAttribute('href', '/dashboard/announcements/create-announcement');
    expect(screen.getByRole('link', { name: /manage announcements/i })).toHaveAttribute('href', '/dashboard/announcements/manage-announcements');
    expect(screen.getByRole('link', { name: /view feed/i })).toHaveAttribute('href', '/dashboard/announcements/view-announcements');
  });

  it('keeps administration tools available and retries when totals fail to load', async () => {
    userMocks.getUsers.mockRejectedValueOnce(new Error('network unavailable'));

    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard totals could not be loaded');
    expect(screen.getByRole('link', { name: /manage user accounts/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(userMocks.getUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(summaryValue('Total Accounts')).toBe('214'));
  });
});
