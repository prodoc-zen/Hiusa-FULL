import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TopBar from './TopBar';

const notificationMocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

vi.mock('../../services/notificationService', () => notificationMocks);
vi.mock('../../services/authService', () => ({ logout: vi.fn() }));

describe('TopBar notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'Test', last_name: 'User' }));
    notificationMocks.getNotifications.mockResolvedValue({ data: { data: [], unread_count: 0 } });
  });

  it('loads once and does not refetch whenever the window regains focus', async () => {
    render(
      <MemoryRouter>
        <TopBar title="Dashboard" pathname="/dashboard/student" onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(notificationMocks.getNotifications).toHaveBeenCalledOnce());

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    expect(notificationMocks.getNotifications).toHaveBeenCalledOnce();
  });
});
