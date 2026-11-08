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
    expect(approver('Event proposal').getByText('The Department Head approves it, then the SAO if the event has SAO requirements.')).toBeInTheDocument();
    expect(approver('Budget proposal').getByText('The Department Head approves it.')).toBeInTheDocument();
    expect(approver('Election').getByText('The Department Head approves it.')).toBeInTheDocument();
    expect(approver('Announcement').getByText('You publish it yourself.')).toBeInTheDocument();
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

  it('sends an officer straight to the announcement form, since there is nothing to choose', () => {
    renderPage('SBO_OFFICER');

    expect(screen.getByText('Destination request form')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/approval-requests/new/announcement');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See what I already submitted' })).not.toBeInTheDocument();
  });

  it('shows an empty state to a role that cannot send requests', () => {
    renderPage('STUDENT');

    expect(screen.getByText('No request types available')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue to request form/ })).not.toBeInTheDocument();
  });
});
