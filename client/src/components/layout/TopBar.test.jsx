import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('anchors the cart panel to the mobile viewport', async () => {
    localStorage.setItem('hiusa_student_cart', JSON.stringify([{ item: { id: 1, name: 'HIUSA Shirt', price: 250 }, quantity: 1 }]));

    render(
      <MemoryRouter>
        <TopBar title="Dashboard" pathname="/dashboard/student" onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cart' }));

    const panel = await screen.findByRole('region', { name: 'Cart summary' });
    expect(panel).toHaveClass('fixed', 'left-3', 'right-3', 'sm:absolute');
    expect(screen.getByRole('button', { name: 'Cart' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('anchors the notifications panel to the mobile viewport', async () => {
    render(
      <MemoryRouter>
        <TopBar title="Dashboard" pathname="/dashboard/student" onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    const panel = await screen.findByRole('region', { name: 'Notifications panel' });
    expect(panel).toHaveClass('fixed', 'left-3', 'right-3', 'sm:absolute');
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute('aria-expanded', 'true');
  });
});
