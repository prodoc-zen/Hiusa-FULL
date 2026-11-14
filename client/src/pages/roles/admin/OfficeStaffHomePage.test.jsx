import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OfficeStaffHomePage from './OfficeStaffHomePage';

const mocks = vi.hoisted(() => ({ getOrganizationApplications: vi.fn(), getBriefing: vi.fn() }));
vi.mock('../../../services/organizationApplicationService', () => ({ getOrganizationApplications: mocks.getOrganizationApplications }));
vi.mock('../../../services/dashboardService', () => ({ getBriefing: mocks.getBriefing }));

const checklist = {
  completed: 0,
  total: 2,
  steps: [
    { key: 'endorse', label: 'Review organization applications', detail: '1 application awaiting your review before SAO.', done: false, href: '/dashboard/organization-applications' },
    { key: 'contact', label: 'Add your contact number', detail: 'The dean and students can reach you about applications.', done: false, href: '/dashboard/profile' },
  ],
};

function renderPage() {
  return render(<MemoryRouter><OfficeStaffHomePage /></MemoryRouter>);
}

describe('OfficeStaffHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getBriefing.mockResolvedValue({ data: { setup: checklist } });
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

  it('names the dean as the one who allows students to apply, since staff cannot', async () => {
    mocks.getOrganizationApplications.mockResolvedValue({ data: { data: [], counts: { pending_dean: 0 } } });
    renderPage();

    expect(await screen.findByText('Nothing is waiting for review. Applications show here once a student the dean allowed to apply sends one.')).toBeInTheDocument();
    expect(screen.queryByText(/a student you allowed/)).not.toBeInTheDocument();
  });

  it('lists the first-run steps in order, each one linking to its page', async () => {
    mocks.getOrganizationApplications.mockResolvedValue({ data: { data: [], counts: { pending_dean: 1 } } });
    renderPage();

    const list = await screen.findByRole('region', { name: 'Your first steps' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Add your contact number'),
      expect.stringContaining('Review organization applications'),
    ]);
    expect(within(list).getByRole('link', { name: 'Add contact number' })).toHaveAttribute('href', '/dashboard/profile');
    expect(within(list).getByRole('link', { name: 'See applications' })).toHaveAttribute('href', '/dashboard/organization-applications');
  });

  it('shows no checklist once every step is done', async () => {
    mocks.getBriefing.mockResolvedValue({ data: { setup: { ...checklist, completed: 2, steps: checklist.steps.map((step) => ({ ...step, done: true, href: null })) } } });
    mocks.getOrganizationApplications.mockResolvedValue({ data: { data: [], counts: { pending_dean: 0 } } });
    renderPage();

    await screen.findByText(/Nothing is waiting for review/);
    expect(screen.queryByRole('region', { name: 'Your first steps' })).not.toBeInTheDocument();
  });

  it('keeps the page working and offers a retry when the checklist cannot load', async () => {
    mocks.getBriefing.mockRejectedValue(new Error('offline'));
    mocks.getOrganizationApplications.mockResolvedValue({ data: { data: [], counts: { pending_dean: 0 } } });
    renderPage();

    expect(await screen.findByText('Your checklist could not load.')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is waiting for review/)).toBeInTheDocument();
    mocks.getBriefing.mockResolvedValue({ data: { setup: checklist } });
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByRole('region', { name: 'Your first steps' })).toBeInTheDocument();
  });

  it('hides the checklist for good when the person asks', async () => {
    mocks.getOrganizationApplications.mockResolvedValue({ data: { data: [], counts: { pending_dean: 0 } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Hide checklist' }));
    expect(screen.queryByRole('region', { name: 'Your first steps' })).not.toBeInTheDocument();
  });

  it('offers a retry when the count cannot load', async () => {
    mocks.getOrganizationApplications.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByText('Applications could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });
});
