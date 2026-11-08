import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OfficeStaffHomePage from './OfficeStaffHomePage';

const mocks = vi.hoisted(() => ({ getOrganizationApplications: vi.fn() }));
vi.mock('../../../services/organizationApplicationService', () => ({ getOrganizationApplications: mocks.getOrganizationApplications }));

function renderPage() {
  return render(<MemoryRouter><OfficeStaffHomePage /></MemoryRouter>);
}

describe('OfficeStaffHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', organization: { id: 9, name: 'Rehearsal College', college: 'Rehearsal College', college_id: 5, organization_type: 'COLLEGE' } }));
  });

  it('says how many applications wait and links to the queue, with no organization setup', async () => {
    mocks.getOrganizationApplications.mockResolvedValue({ data: { data: [], counts: { pending_dean: 2 } } });
    renderPage();

    expect(await screen.findByText('2 applications are waiting for your review.')).toBeInTheDocument();
    expect(mocks.getOrganizationApplications).toHaveBeenCalledWith({ status: 'pending_dean', per_page: 1 });
    expect(screen.getByRole('heading', { name: 'Applications for Rehearsal College' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review applications' })).toHaveAttribute('href', '/dashboard/organization-applications');
    expect(screen.queryByText(/Getting started|officer positions|Financial status/i)).not.toBeInTheDocument();
  });

  it('says plainly when nothing is waiting', async () => {
    mocks.getOrganizationApplications.mockResolvedValue({ data: { data: [], counts: { pending_dean: 0 } } });
    renderPage();

    expect(await screen.findByText(/Nothing is waiting for review/)).toBeInTheDocument();
  });

  it('offers a retry when the count cannot load', async () => {
    mocks.getOrganizationApplications.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByText('Applications could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });
});
