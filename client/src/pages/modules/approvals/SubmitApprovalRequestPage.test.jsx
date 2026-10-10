import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SubmitApprovalRequestPage from './SubmitApprovalRequestPage';

function Destination() {
  return <><p>Destination request form</p><p data-testid="where">{useLocation().pathname}</p></>;
}

function renderPage(role) {
  localStorage.setItem('user', JSON.stringify({ role }));
  render(
    <MemoryRouter initialEntries={['/dashboard/approval-requests/new']}>
      <Routes>
        <Route path="/dashboard/approval-requests/new" element={<SubmitApprovalRequestPage />} />
        <Route path="/dashboard/approval-requests/new/:type" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SubmitApprovalRequestPage', () => {
  beforeEach(() => localStorage.clear());

  it('shows every authorized request type to an admin and continues to the selected form', () => {
    renderPage('ADMIN');

    expect(screen.getByText('Announcement')).toBeInTheDocument();
    expect(screen.getByText('Budget proposal')).toBeInTheDocument();
    expect(screen.getByText('Event proposal')).toBeInTheDocument();
    expect(screen.getByText('Election')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Election/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue to request form/ }));
    expect(screen.getByText('Destination request form')).toBeInTheDocument();
  });

  it('titles the page New request and says who approves each request type', () => {
    renderPage('ADMIN');

    expect(screen.getByRole('heading', { level: 1, name: 'New request' })).toBeInTheDocument();
    const approver = (name) => within(screen.getByRole('radio', { name: new RegExp(name) }).closest('label'));
    expect(approver('Event proposal').getByText('Approved by the Department Head, then by the SAO when SAO requirements apply to the event.')).toBeInTheDocument();
    expect(approver('Budget proposal').getByText('Approved by the Department Head.')).toBeInTheDocument();
    expect(approver('Election').getByText('Approved by the Department Head.')).toBeInTheDocument();
    expect(approver('Announcement').getByText(/Announcements from officers are approved by the Admin/)).toBeInTheDocument();
  });

  it('sends each request type to its real creation form', () => {
    const paths = { Announcement: 'announcement', 'Budget proposal': 'budget', 'Event proposal': 'event', Election: 'election' };
    Object.entries(paths).forEach(([name, type]) => {
      cleanup();
      renderPage('ADMIN');
      fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));
      fireEvent.click(screen.getByRole('button', { name: /Continue to request form/ }));
      expect(screen.getByText('Destination request form')).toBeInTheDocument();
      expect(screen.getByTestId('where')).toHaveTextContent(`/dashboard/approval-requests/new/${type}`);
    });
  });

  it('links an Admin to what they already submitted', () => {
    renderPage('ADMIN');

    expect(screen.getByRole('link', { name: 'See what I already submitted' })).toHaveAttribute('href', '/dashboard/approvals?tab=submitted');
  });

  it('tells an officer the Admin approves the announcement and offers no link to the Admin tabs', () => {
    renderPage('SBO_OFFICER');

    expect(screen.getByText('Approved by the Admin before it is published.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See what I already submitted' })).not.toBeInTheDocument();
  });

  it('limits an SBO officer to announcement requests', () => {
    renderPage('SBO_OFFICER');

    expect(screen.getByText('Announcement')).toBeInTheDocument();
    expect(screen.queryByText('Budget proposal')).not.toBeInTheDocument();
    expect(screen.queryByText('Event proposal')).not.toBeInTheDocument();
    expect(screen.queryByText('Election')).not.toBeInTheDocument();
  });
});
