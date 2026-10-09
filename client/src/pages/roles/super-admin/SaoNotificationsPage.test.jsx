import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoNotificationsPage from './SaoNotificationsPage';

const notificationMocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markAllRead: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock('../../../services/notificationService', () => notificationMocks);

function ComplianceDestination() {
  const [params] = useSearchParams();
  return <p>Compliance tab {params.get('tab')}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/super-admin/notifications']}>
      <Routes>
        <Route path="/dashboard/super-admin/notifications" element={<SaoNotificationsPage />} />
        <Route path="/dashboard/super-admin/compliance" element={<ComplianceDestination />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SaoNotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.getNotifications.mockResolvedValue({ data: { data: [{
      id: 44,
      title: 'Financial Report Ready for Review',
      message: 'A financial report requires final review.',
      reference_type: 'approval_request',
      reference_id: 90,
      is_read: false,
      created_at: '2026-09-14T08:00:00Z',
    }] } });
    notificationMocks.markRead.mockResolvedValue({});
    notificationMocks.markAllRead.mockResolvedValue({});
  });

  it('marks a report notification read and opens the financial tab of the compliance home', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Financial Report Ready for Review/i }));

    await waitFor(() => expect(notificationMocks.markRead).toHaveBeenCalledWith(44));
    expect(await screen.findByText('Compliance tab financial')).toBeInTheDocument();
  });

  it('marks every SAO notification as read', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(notificationMocks.markAllRead).toHaveBeenCalledOnce());
  });
});
