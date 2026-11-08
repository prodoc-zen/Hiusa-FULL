import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OrganizationApplicationsPage from './OrganizationApplicationsPage';

const mocks = vi.hoisted(() => ({
  getOrganizationApplications: vi.fn(),
  getOrganizationApplication: vi.fn(),
  reviewOrganizationApplication: vi.fn(),
  attachReviewFile: vi.fn(),
  removeReviewFile: vi.fn(),
}));
vi.mock('../../../services/organizationApplicationService', () => mocks);
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile: vi.fn() }));

const row = (extra = {}) => ({
  id: 8,
  name: 'Chess Club',
  acronym: 'CHESS',
  status: 'pending_dean',
  position_title: 'President',
  submitted_at: '2026-10-01T08:00:00+08:00',
  college: { id: 5, name: 'College of Engineering' },
  applicant: { school_id: 20260042, name: 'Ana Cruz', email: 'ana.cruz@example.test' },
  ...extra,
});

const page = (rows, counts = {}) => ({ data: { data: rows, current_page: 1, last_page: 1, per_page: 10, total: rows.length, counts: { pending_dean: 1, pending_sao: 2, returned: 0, approved: 3, rejected: 0, ...counts } } });

const detail = (extra = {}) => ({
  ...row(),
  round: 1,
  description: null,
  endorsement_note: null,
  remarks: null,
  review_files: [],
  requirements: [{ id: 1, name: 'Constitution', document: { id: 11, name: 'constitution.pdf', open_url: '/organization-applications/8/documents/11' }, reviews: [], review_files: [] }],
  ...extra,
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(role = 'DEPARTMENT_HEAD', entry = '/dashboard/organization-applications') {
  localStorage.setItem('user', JSON.stringify({ role }));
  return render(<MemoryRouter initialEntries={[entry]}><OrganizationApplicationsPage /><LocationProbe /></MemoryRouter>);
}

describe('OrganizationApplicationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrganizationApplications.mockResolvedValue(page([row()]));
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail() });
  });

  afterEach(() => localStorage.clear());

  it('opens the dean on what is waiting for them, with a count on every tab', async () => {
    renderPage('DEPARTMENT_HEAD');

    expect((await screen.findAllByText('Chess Club')).length).toBeGreaterThan(0);
    expect(mocks.getOrganizationApplications).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending_dean', page: 1 }));
    expect(screen.getByRole('tab', { name: 'To review (1)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'With the SAO (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Approved (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Not approved (0)' })).toBeInTheDocument();
  });

  it('opens the SAO on the applications the dean endorsed', async () => {
    mocks.getOrganizationApplications.mockResolvedValue(page([row({ status: 'pending_sao' })]));
    renderPage('SUPER_ADMIN');

    await screen.findAllByText('Chess Club');
    expect(mocks.getOrganizationApplications).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending_sao' }));
    expect(screen.getByRole('tab', { name: 'To review (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'With the Department Head (1)' })).toBeInTheDocument();
  });

  it('shows the applicant by name with the school ID only as small text', async () => {
    renderPage();

    const table = (await screen.findAllByRole('table'))[0];
    expect(within(table).getByText('Ana Cruz')).toBeInTheDocument();
    expect(within(table).getByText('President · ID 20260042')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /school id/i })).not.toBeInTheDocument();
    expect(within(table).getByText('With the Department Head')).toBeInTheDocument();
  });

  it('switches status with the tabs and asks for that status', async () => {
    renderPage();
    await screen.findAllByText('Chess Club');

    fireEvent.click(screen.getByRole('tab', { name: 'Approved (3)' }));

    await waitFor(() => expect(mocks.getOrganizationApplications).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'approved', page: 1 })));
  });

  it('searches by organization or student after a short pause', async () => {
    renderPage();
    await screen.findAllByText('Chess Club');

    fireEvent.change(screen.getByLabelText('Find an application'), { target: { value: 'ana' } });

    await waitFor(() => expect(mocks.getOrganizationApplications).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana' })));
  });

  it('shows an error with a retry and then the rows', async () => {
    mocks.getOrganizationApplications.mockRejectedValueOnce({ response: { status: 500 } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Chess Club')).length).toBeGreaterThan(0);
  });

  it('explains an empty queue for the dean', async () => {
    mocks.getOrganizationApplications.mockResolvedValue(page([], { pending_dean: 0 }));
    renderPage();

    expect(await screen.findByText('Nothing waiting for you')).toBeInTheDocument();
    expect(screen.getByText('Applications show here once a student you allowed to apply sends one.')).toBeInTheDocument();
  });

  it('opens an application in the review drawer and keeps it addressable with ?record', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open application of Chess Club' }))[0]);

    expect(await screen.findByRole('button', { name: 'Endorse to SAO' })).toBeInTheDocument();
    expect(mocks.getOrganizationApplication).toHaveBeenCalledWith('8');
    expect(screen.getByTestId('location')).toHaveTextContent('?record=8');
  });

  it('opens straight to the drawer from a notification link', async () => {
    mocks.getOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao' }) });
    renderPage('SUPER_ADMIN', '/dashboard/organization-applications?record=8');

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('closes the drawer and refreshes the list after a decision', async () => {
    mocks.reviewOrganizationApplication.mockResolvedValue({ data: detail({ status: 'pending_sao' }) });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open application of Chess Club' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Endorse to SAO' }));

    await waitFor(() => expect(mocks.reviewOrganizationApplication).toHaveBeenCalledWith(8, expect.objectContaining({ action: 'endorse' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Endorse to SAO' })).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.getOrganizationApplications).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('location')).not.toHaveTextContent('record=');
  });
});
