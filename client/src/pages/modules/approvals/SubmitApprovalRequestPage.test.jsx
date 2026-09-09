import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SubmitApprovalRequestPage from './SubmitApprovalRequestPage';

function renderPage(role) {
  localStorage.setItem('user', JSON.stringify({ role }));
  render(
    <MemoryRouter initialEntries={['/dashboard/approval-requests/new']}>
      <Routes>
        <Route path="/dashboard/approval-requests/new" element={<SubmitApprovalRequestPage />} />
        <Route path="/dashboard/approval-requests/new/:type" element={<p>Destination request form</p>} />
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

  it('limits an SBO officer to announcement and budget requests', () => {
    renderPage('SBO_OFFICER');

    expect(screen.getByText('Announcement')).toBeInTheDocument();
    expect(screen.getByText('Budget proposal')).toBeInTheDocument();
    expect(screen.queryByText('Event proposal')).not.toBeInTheDocument();
    expect(screen.queryByText('Election')).not.toBeInTheDocument();
  });
});
