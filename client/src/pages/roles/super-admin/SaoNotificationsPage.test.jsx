import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoNotificationsPage from './SaoNotificationsPage';

const notificationMocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markAllRead: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock('../../../services/notificationService', () => notificationMocks);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/super-admin/notifications']}>
      <Routes>
        <Route path="/dashboard/super-admin/notifications" element={<SaoNotificationsPage />} />
        <Route path="/dashboard/super-admin/approvals" element={<p>SAO approval destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SaoNotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.getNotifications.mockResolvedValue({ data: { data: [{
      id: 44,
      title: 'New SAO Approval Request',
      message: 'A budget requires review.',
      reference_type: 'approval_request',
      reference_id: 90,
      is_read: false,
      created_at: '2026-09-14T08:00:00Z',
    }] } });
    notificationMocks.markRead.mockResolvedValue({});
    notificationMocks.markAllRead.mockResolvedValue({});
  });

  it('marks an approval notification read and opens the SAO approval queue', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New SAO Approval Request/i }));

    await waitFor(() => expect(notificationMocks.markRead).toHaveBeenCalledWith(44));
    expect(await screen.findByText('SAO approval destination')).toBeInTheDocument();
  });

  it('marks every SAO notification as read', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(notificationMocks.markAllRead).toHaveBeenCalledOnce());
  });
});
